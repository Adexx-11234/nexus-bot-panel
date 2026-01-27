// ============================================================================
// auth-state.js - File-First Auth with Intelligent MongoDB Backup
// ============================================================================

import { WAProto as proto, initAuthCreds } from "@nexustechpro/baileys"
import { createComponentLogger } from "../../utils/logger.js"
import fs from "fs/promises"
import path from "path"

const logger = createComponentLogger("AUTH_STATE")
const globalCollectionRefs = new Map()
const preKeyDebounceTimers = new Map()

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  MONGODB_TIMEOUT: 5000,
  BACKUP_INTERVAL: 30 * 60 * 1000, // 30 minutes
  PREKEY_WRITE_DEBOUNCE: 100,
  SYNC_BATCH_SIZE: 10,
  SYNC_BATCH_DELAY: 50,
  HEALTH_CHECK_INTERVAL: 30000,
  LID_MAPPING_MAX: 200,
  LID_MAPPING_CLEANUP: 100,
}

// ============================================================================
// BUFFER SERIALIZATION
// ============================================================================

const BufferJSON = {
  replacer: (k, value) => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === "Buffer") {
      return { type: "Buffer", data: Buffer.from(value?.data || value).toString("base64") }
    }
    return value
  },
  reviver: (_, value) => {
    if (typeof value === "object" && value && (value.buffer === true || value.type === "Buffer")) {
      const val = value.data || value.value
      return typeof val === "string" ? Buffer.from(val, "base64") : Buffer.from(val || [])
    }
    return value
  },
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const getStorageMode = () => (process.env.STORAGE_MODE || "mongodb").toLowerCase()
const isMongoDBMode = () => getStorageMode() === "mongodb"
const isFileMode = () => getStorageMode() === "file"
const hasMongoDBUri = () => !!process.env.MONGODB_URI
const sanitizeFileName = (name) => name?.replace(/::/g, "__").replace(/:/g, "-").replace(/[/\\]/g, "_")
const isPreKeyFile = (name) => /^pre[-_]?key/i.test(name)
const isLidMappingFile = (name) => /^lid-mapping-/i.test(name)

// ============================================================================
// FILE STORAGE CLASS
// ============================================================================

class FileStorage {
  constructor(sessionId, baseDir = "./sessions") {
    this.sessionId = sessionId
    this.dir = path.join(baseDir, sessionId)
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true })
  }

  async read(fileName) {
    try {
      const content = await fs.readFile(path.join(this.dir, sanitizeFileName(fileName)), "utf8")
      return content ? JSON.parse(content, BufferJSON.reviver) : null
    } catch {
      return null
    }
  }

  async write(fileName, data) {
    try {
      const filePath = path.join(this.dir, sanitizeFileName(fileName))
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, JSON.stringify(data, BufferJSON.replacer, 2), "utf8")
      return true
    } catch (error) {
      logger.error(`[${this.sessionId}] File write failed ${fileName}: ${error.message}`)
      return false
    }
  }

  async delete(fileName) {
    try {
      await fs.unlink(path.join(this.dir, sanitizeFileName(fileName)))
      return true
    } catch {
      return false
    }
  }

  async cleanup() {
    try {
      await fs.rm(this.dir, { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  }

  async listFiles(filterFn = null) {
    try {
      const files = await fs.readdir(this.dir)
      const jsonFiles = files.filter((f) => f.endsWith(".json"))
      return filterFn ? jsonFiles.filter(filterFn) : jsonFiles
    } catch {
      return []
    }
  }

  async exists(fileName) {
    try {
      await fs.access(path.join(this.dir, sanitizeFileName(fileName)))
      return true
    } catch {
      return false
    }
  }

  // Cleanup old lid-mapping files
  async cleanupLidMapping() {
    try {
      const lidFiles = (await this.listFiles()).filter(isLidMappingFile)
      
      if (lidFiles.length <= CONFIG.LID_MAPPING_MAX) return

      // Sort by modification time (oldest first)
      const filesWithStats = await Promise.all(
        lidFiles.map(async (file) => {
          try {
            const stats = await fs.stat(path.join(this.dir, file))
            return { file, mtime: stats.mtime }
          } catch {
            return null
          }
        })
      )

      const validFiles = filesWithStats.filter(Boolean).sort((a, b) => a.mtime - b.mtime)
      const toDelete = validFiles.slice(0, CONFIG.LID_MAPPING_CLEANUP)

      for (const { file } of toDelete) {
        await this.delete(file)
      }

      logger.info(`[${this.sessionId}] Cleaned up ${toDelete.length} old lid-mapping files`)
    } catch (error) {
      logger.error(`[${this.sessionId}] lid-mapping cleanup failed: ${error.message}`)
    }
  }
}

// ============================================================================
// MONGODB BACKGROUND SYNC CLASS
// ============================================================================

class MongoBackgroundSync {
  constructor(mongoStorage, sessionId, storageMode) {
    this.mongo = mongoStorage
    this.sessionId = sessionId
    this.storageMode = storageMode
    this.syncInProgress = false
    this.pendingWrites = new Map()
    this.syncStats = { attempted: 0, succeeded: 0, failed: 0 }
    this.isHealthy = true
    this.consecutiveFailures = 0
    
    this._startHealthMonitoring()
  }

  _startHealthMonitoring() {
    this.healthTimer = setInterval(() => this._checkHealth(), CONFIG.HEALTH_CHECK_INTERVAL)
  }

  async _checkHealth() {
    if (!this.mongo?.isConnected) {
      if (this.isHealthy) logger.warn(`[${this.sessionId}] MongoDB unhealthy - not connected`)
      this.isHealthy = false
      return
    }

    try {
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("timeout")), 5000)
      )
      
      await Promise.race([
        this.mongo.client?.db("admin").command({ ping: 1 }),
        timeout
      ])
      
      if (!this.isHealthy) logger.info(`[${this.sessionId}] MongoDB connection restored`)
      this.isHealthy = true
      this.consecutiveFailures = 0
    } catch {
      this.consecutiveFailures++
      if (this.consecutiveFailures >= 3 && this.isHealthy) {
        logger.warn(`[${this.sessionId}] MongoDB unhealthy after ${this.consecutiveFailures} failures`)
        this.isHealthy = false
      }
    }
  }

  shouldBackupFile(fileName) {
    const isPreKey = isPreKeyFile(fileName)
    const isCreds = fileName === "creds.json"
    
    // MongoDB mode: backup everything
    if (isMongoDBMode()) return true
    
    // File mode with healthy MongoDB: backup everything
    if (isFileMode() && this.isHealthy) return true
    
    // File mode with unhealthy MongoDB: only creds and non-prekey files
    if (isFileMode() && !this.isHealthy) {
      return isCreds || !isPreKey
    }
    
    return false
  }

  fireWrite(fileName, data) {
    if (!this.mongo?.isConnected || !this.shouldBackupFile(fileName)) return

    this.pendingWrites.set(fileName, data)
    setImmediate(() => this._processQueue())
  }

  async _processQueue() {
    if (this.syncInProgress || this.pendingWrites.size === 0 || !this.mongo?.isConnected) return

    this.syncInProgress = true

    try {
      const entries = Array.from(this.pendingWrites.entries()).filter(([fn]) => this.shouldBackupFile(fn))
      this.pendingWrites.clear()
      
      if (entries.length === 0) return

      for (let i = 0; i < entries.length; i += CONFIG.SYNC_BATCH_SIZE) {
        const batch = entries.slice(i, i + CONFIG.SYNC_BATCH_SIZE)
        await Promise.allSettled(batch.map(([fn, data]) => this._safeWrite(fn, data)))
        
        if (i + CONFIG.SYNC_BATCH_SIZE < entries.length) {
          await new Promise(r => setTimeout(r, CONFIG.SYNC_BATCH_DELAY))
        }
      }
    } finally {
      this.syncInProgress = false
      if (this.pendingWrites.size > 0) setImmediate(() => this._processQueue())
    }
  }

  async _safeWrite(fileName, data) {
    this.syncStats.attempted++
    try {
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("timeout")), CONFIG.MONGODB_TIMEOUT)
      )
      
      await Promise.race([
        this.mongo.writeAuthData(this.sessionId, fileName, JSON.stringify(data, BufferJSON.replacer)),
        timeout
      ])
      
      this.syncStats.succeeded++
    } catch (error) {
      this.syncStats.failed++
      this.consecutiveFailures++
      if (this.consecutiveFailures >= 5) this.isHealthy = false
    }
  }

  fireDelete(fileName) {
    if (!this.mongo?.isConnected) return
    setImmediate(async () => {
      try {
        const timeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("timeout")), CONFIG.MONGODB_TIMEOUT)
        )
        await Promise.race([this.mongo.deleteAuthData(this.sessionId, fileName), timeout])
      } catch {}
    })
  }

  async safeRead(fileName) {
    if (!this.mongo?.isConnected) return null
    try {
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("timeout")), CONFIG.MONGODB_TIMEOUT)
      )
      const data = await Promise.race([this.mongo.readAuthData(this.sessionId, fileName), timeout])
      return data ? JSON.parse(data, BufferJSON.reviver) : null
    } catch {
      return null
    }
  }

  async safeList() {
    if (!this.mongo?.isConnected) return []
    try {
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("timeout")), CONFIG.MONGODB_TIMEOUT)
      )
      return await Promise.race([this.mongo.getAllAuthFiles(this.sessionId), timeout])
    } catch {
      return []
    }
  }

  fireCleanup() {
    if (!this.mongo?.isConnected) return
    setImmediate(async () => {
      try {
        await this.mongo.deleteAuthState(this.sessionId)
        logger.info(`[${this.sessionId}] MongoDB cleanup completed`)
      } catch {}
    })
  }

  cleanup() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
  }

  getStats() {
    return {
      ...this.syncStats,
      isHealthy: this.isHealthy,
      consecutiveFailures: this.consecutiveFailures,
      pendingWrites: this.pendingWrites.size,
      mode: this.storageMode,
    }
  }
}

// ============================================================================
// CREDENTIAL VALIDATION
// ============================================================================

const hasBasicKeys = (creds) => !!(creds?.noiseKey && creds?.signedIdentityKey)

const validateCredsForWrite = (creds, sessionId, isPairing) => {
  const missing = []
  if (!creds?.noiseKey) missing.push("noiseKey")
  if (!creds?.signedIdentityKey) missing.push("signedIdentityKey")
  if (!creds?.me) missing.push("me")
  if (!creds?.account) missing.push("account")
  if (creds?.registered !== true) missing.push("registered")

  if (missing.length > 0) {
    if (!isPairing) {
      logger.warn(`[${sessionId}] Incomplete creds.json blocked - Missing: ${missing.join(", ")}`)
      return false
    }
    logger.warn(`[${sessionId}] Incomplete creds.json allowed (pairing) - Missing: ${missing.join(", ")}`)
  }

  return true
}

// ============================================================================
// INITIAL SYNC & BACKUP
// ============================================================================

const performInitialSync = async (fileStore, mongoSync, sessionId) => {
  try {
    const mongoFiles = await mongoSync.safeList()
    if (!mongoFiles || mongoFiles.length === 0) {
      logger.info(`[${sessionId}] No MongoDB data found`)
      return { synced: 0, total: 0 }
    }

    const fileFiles = await fileStore.listFiles()
    if (fileFiles.length > 0) {
      logger.info(`[${sessionId}] File storage exists, skipping MongoDB pull`)
      return { synced: 0, total: mongoFiles.length, skipped: true }
    }

    logger.info(`[${sessionId}] Pulling ${mongoFiles.length} files from MongoDB...`)

    let synced = 0
    for (let i = 0; i < mongoFiles.length; i += CONFIG.SYNC_BATCH_SIZE) {
      const batch = mongoFiles.slice(i, i + CONFIG.SYNC_BATCH_SIZE)
      
      await Promise.allSettled(
        batch.map(async (fileName) => {
          const data = await mongoSync.safeRead(fileName)
          if (data && await fileStore.write(fileName, data)) synced++
        })
      )

      if (i + CONFIG.SYNC_BATCH_SIZE < mongoFiles.length) {
        await new Promise(r => setTimeout(r, CONFIG.SYNC_BATCH_DELAY))
      }
    }

    logger.info(`[${sessionId}] Synced ${synced}/${mongoFiles.length} files from MongoDB`)
    return { synced, total: mongoFiles.length }
  } catch (error) {
    logger.error(`[${sessionId}] Initial sync failed: ${error.message}`)
    return { synced: 0, total: 0 }
  }
}

const performImmediateBackup = async (fileStore, mongoSync, sessionId) => {
  try {
    const files = await fileStore.listFiles()
    if (files.length === 0) return

    logger.info(`[${sessionId}] Starting immediate backup of ${files.length} files to MongoDB`)

    // Separate metadata.json from auth files
    const metadataFile = files.find(f => f === 'metadata.json')
    const authFiles = files.filter(f => f !== 'metadata.json')

    let backedUp = 0

    // Handle metadata.json separately - save to sessions collection
    if (metadataFile) {
      try {
        const metadataData = await fileStore.read(metadataFile)
        if (metadataData && mongoSync.mongo?.isConnected && mongoSync.mongo.sessions) {
          await mongoSync.mongo.saveSession(sessionId, metadataData)
          logger.debug(`[${sessionId}] Backed up metadata.json to sessions collection`)
          backedUp++
        }
      } catch (error) {
        logger.error(`[${sessionId}] Failed to backup metadata.json: ${error.message}`)
      }
    }

    // Handle auth files - save to auth_baileys collection
    for (const file of authFiles) {
      if (!mongoSync.shouldBackupFile(file)) continue
      const data = await fileStore.read(file)
      if (data) {
        mongoSync.fireWrite(file, data)
        backedUp++
      }
    }

    logger.info(`[${sessionId}] Immediate backup queued: ${backedUp}/${files.length} files`)
  } catch (error) {
    logger.error(`[${sessionId}] Immediate backup failed: ${error.message}`)
  }
}

// ============================================================================
// SESSION VALIDATION & CLEANUP
// ============================================================================

const validateAndCleanupSession = async (fileStore, mongoSync, sessionId, isPairing) => {
  // Skip validation during pairing
  if (isPairing) {
    logger.debug(`[${sessionId}] Pairing in progress - skipping validation`)
    return true
  }

  try {
    // Check for required files
    const hasCreds = await fileStore.exists("creds.json")
    const hasMetadata = await fileStore.exists("metadata.json")

    // If both files exist, session is valid
    if (hasCreds && hasMetadata) {
      return true
    }

    // Missing required files - cleanup needed
    logger.warn(`[${sessionId}] Invalid session - Missing: ${!hasCreds ? 'creds.json ' : ''}${!hasMetadata ? 'metadata.json' : ''}`)
    logger.info(`[${sessionId}] Cleaning up invalid session...`)

    // Cleanup file storage
    await fileStore.cleanup()
    logger.info(`[${sessionId}] File storage cleaned`)

    // Cleanup MongoDB if available
    if (mongoSync) {
      mongoSync.fireCleanup()
      logger.info(`[${sessionId}] MongoDB cleanup queued`)
    }

    return false
  } catch (error) {
    logger.error(`[${sessionId}] Validation failed: ${error.message}`)
    return true // Don't cleanup on validation errors
  }
}

// ============================================================================
// MAIN AUTH STATE FUNCTION
// ============================================================================

export const useMongoDBAuthState = async (mongoStorage, sessionId, isPairing = false, source = "telegram") => {
  if (!sessionId?.startsWith("session_")) {
    throw new Error(`Invalid sessionId: ${sessionId}`)
  }

  const mode = getStorageMode()
  const hasMongoDB = hasMongoDBUri() && mongoStorage?.isConnected
  
  logger.info(`[${sessionId}] Auth: FILE-FIRST | Mode: ${mode.toUpperCase()} | MongoDB: ${hasMongoDB ? "available" : "unavailable"}`)

  const fileStore = new FileStorage(sessionId)
  await fileStore.init()

  const mongoSync = hasMongoDB ? new MongoBackgroundSync(mongoStorage, sessionId, mode) : null

  if (mongoSync) {
    globalCollectionRefs.set(sessionId, mongoStorage)
    const strategy = isMongoDBMode() ? "FULL" : "INTELLIGENT"
    logger.info(`[${sessionId}] MongoDB backup: ${strategy}`)
  }

  // ============================================================================
  // INITIAL SYNC FROM MONGODB
  // ============================================================================

  if (mongoSync && isMongoDBMode()) {
    const result = await performInitialSync(fileStore, mongoSync, sessionId)
    if (result.synced > 0) {
      logger.info(`[${sessionId}] Restored ${result.synced}/${result.total} files from MongoDB`)
    }
  }

  // ============================================================================
  // IMMEDIATE BACKUP IN FILE MODE (FIX FOR YOUR ISSUE)
  // ============================================================================

  if (mongoSync && isFileMode()) {
    // Immediately backup existing files to MongoDB when starting in FILE mode
    setTimeout(() => performImmediateBackup(fileStore, mongoSync, sessionId), 5000)
  }

  // ============================================================================
  // VALIDATE SESSION
  // ============================================================================

  const isValidSession = await validateAndCleanupSession(fileStore, mongoSync, sessionId, isPairing)
  
  if (!isValidSession) {
    throw new Error(`Session ${sessionId} is invalid and has been cleaned up`)
  }


  // ============================================================================
  // READ/WRITE/DELETE OPERATIONS
  // ============================================================================

  const readData = async (fileName) => await fileStore.read(fileName)

  const writeData = async (data, fileName) => {
    await fs.mkdir(fileStore.dir, { recursive: true }).catch(() => {})

    // Cleanup lid-mapping files if needed
    if (isLidMappingFile(fileName)) {
      await fileStore.cleanupLidMapping()
    }

    if (fileName === "creds.json") {
      if (!validateCredsForWrite(data, sessionId, isPairing)) return false

      const fileSuccess = await fileStore.write(fileName, data)
      if (mongoSync && isMongoDBMode()) mongoSync.fireWrite(fileName, data)
      if (fileSuccess) logger.info(`[${sessionId}] creds.json written`)
      return fileSuccess
    }

    const isPreKey = isPreKeyFile(fileName)

    if (isPreKey) {
      debouncePreKeyWrite(sessionId, fileName, async () => {
        await fileStore.write(fileName, data)
        if (mongoSync && isMongoDBMode()) mongoSync.fireWrite(fileName, data)
      })
      return true
    }

    const success = await fileStore.write(fileName, data)
    if (success && mongoSync && isMongoDBMode()) mongoSync.fireWrite(fileName, data)
    return success
  }

  const removeData = async (fileName) => {
    await fileStore.delete(fileName)
    if (mongoSync) mongoSync.fireDelete(fileName)
  }

  // ============================================================================
  // LOAD OR CREATE CREDENTIALS
  // ============================================================================

  const existing = await readData("creds.json")
  const creds = hasBasicKeys(existing) ? existing : initAuthCreds()

  if (!existing) {
    logger.info(`[${sessionId}] Creating new credentials`)
    await writeData(creds, "creds.json")
  } else {
    logger.info(`[${sessionId}] Loaded credentials from file`)
  }

  // ============================================================================
  // PERIODIC BACKUP (FILE MODE ONLY)
  // ============================================================================

  let backupTimer = null
  let validationTimer = null

  if (isFileMode() && mongoSync) {
    const backup = async () => {
      try {
        const files = await fileStore.listFiles()
        logger.info(`[${sessionId}] Backup cycle: ${files.length} files`)

        let backedUp = 0
        for (const file of files) {
          if (!mongoSync.shouldBackupFile(file)) continue
          const data = await fileStore.read(file)
          if (data) {
            mongoSync.fireWrite(file, data)
            backedUp++
          }
        }

        logger.info(`[${sessionId}] Backup queued: ${backedUp}/${files.length} files`)
      } catch (error) {
        logger.error(`[${sessionId}] Backup failed: ${error.message}`)
      }
    }

    backupTimer = setInterval(backup, CONFIG.BACKUP_INTERVAL)
    // Periodic validation (every 20 minutes)
    validationTimer = setInterval(async () => {
      const isValid = await validateAndCleanupSession(fileStore, mongoSync, sessionId, isPairing)
      if (!isValid) {
        logger.error(`[${sessionId}] Session became invalid - stopping validation`)
        clearInterval(validationTimer)
      }
    }, 20 * 60 * 1000) // 20 minutes
  }

  // ============================================================================
  // RETURN AUTH STATE
  // ============================================================================

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {}
          for (const id of ids) {
            const fileName = `${type}-${id}.json`
            let value = await readData(fileName)
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value)
            }
            if (value) data[id] = value
          }
          return data
        },
        set: async (data) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const file = `${category}-${id}.json`
              value ? await writeData(value, file) : await removeData(file)
            }
          }
        },
      },
    },
    saveCreds: () => writeData(creds, "creds.json"),
    cleanup: async () => {
      if (backupTimer) clearInterval(backupTimer)
      if (validationTimer) clearInterval(validationTimer)

      if (mongoSync) {
        const stats = mongoSync.getStats()
        if (stats.attempted > 0) {
          logger.info(`[${sessionId}] MongoDB sync: ${stats.succeeded}/${stats.attempted} succeeded`)
        }
        mongoSync.cleanup()
        mongoSync.fireCleanup()
      }

      await fileStore.cleanup()
      globalCollectionRefs.delete(sessionId)
      preKeyDebounceTimers.delete(sessionId)

      logger.info(`[${sessionId}] Cleanup complete`)
    },
  }
}

// ============================================================================
// DEBOUNCE HELPER
// ============================================================================

const debouncePreKeyWrite = (sessionId, fileName, writeFn) => {
  if (!preKeyDebounceTimers.has(sessionId)) {
    preKeyDebounceTimers.set(sessionId, new Map())
  }

  const sessionTimers = preKeyDebounceTimers.get(sessionId)
  if (sessionTimers.has(fileName)) clearTimeout(sessionTimers.get(fileName))

  sessionTimers.set(
    fileName,
    setTimeout(async () => {
      sessionTimers.delete(fileName)
      try {
        await writeFn()
      } catch {}
    }, CONFIG.PREKEY_WRITE_DEBOUNCE)
  )
}

// ============================================================================
// EXPORTED UTILITY FUNCTIONS
// ============================================================================

export const cleanupSessionAuthData = async (mongoStorage, sessionId) => {
  try {
    const fileStore = new FileStorage(sessionId)
    await fileStore.init()
    await fileStore.cleanup()

    if (hasMongoDBUri() && mongoStorage?.isConnected) {
      const mongoSync = new MongoBackgroundSync(mongoStorage, sessionId, getStorageMode())
      mongoSync.fireCleanup()
    }

    globalCollectionRefs.delete(sessionId)
    preKeyDebounceTimers.delete(sessionId)

    logger.info(`[${sessionId}] Session cleanup initiated`)
    return true
  } catch (error) {
    logger.error(`[${sessionId}] Cleanup failed: ${error.message}`)
    return false
  }
}

export const hasValidAuthData = async (mongoStorage, sessionId) => {
  try {
    const fileStore = new FileStorage(sessionId)
    await fileStore.init()

    const fileCreds = await fileStore.read("creds.json")
    if (hasBasicKeys(fileCreds)) return true

    if (hasMongoDBUri() && mongoStorage?.isConnected) {
      return await mongoStorage.hasValidAuthData(sessionId)
    }

    return false
  } catch {
    return false
  }
}

export const checkAuthAvailability = async (mongoStorage, sessionId) => {
  const fileStore = new FileStorage(sessionId)
  await fileStore.init()

  const hasFile = await fileStore.exists("creds.json")
  let hasMongo = false

  if (hasMongoDBUri() && mongoStorage?.isConnected) {
    try {
      hasMongo = await mongoStorage.hasValidAuthData(sessionId)
    } catch {}
  }

  return {
    hasFile,
    hasMongo,
    hasAuth: hasFile || hasMongo,
    preferred: "file",
    mode: "file-first-with-intelligent-backup",
    mongoAvailable: hasMongoDBUri() && mongoStorage?.isConnected,
  }
}

export const getAuthStorageStats = () => {
  const mode = getStorageMode()
  const hasMongo = hasMongoDBUri()
  
  let backupStrategy = "none"
  if (hasMongo) {
    backupStrategy = isMongoDBMode() 
      ? "full (all files)" 
      : "intelligent (creds always, pre-keys when healthy)"
  }
  
  return {
    storageMode: "FILE-FIRST",
    configuredMode: mode.toUpperCase(),
    mongodbAvailable: hasMongo,
    backupStrategy,
    backupInterval: `${CONFIG.BACKUP_INTERVAL / 60000}min`,
    syncBatchSize: CONFIG.SYNC_BATCH_SIZE,
    activeCollectionRefs: globalCollectionRefs.size,
    lidMappingMax: CONFIG.LID_MAPPING_MAX,
    lidMappingCleanup: CONFIG.LID_MAPPING_CLEANUP,
  }
}