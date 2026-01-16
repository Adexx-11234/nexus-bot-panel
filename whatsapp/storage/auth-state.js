// ============================================================================
// auth-state.js - File-First Auth with Intelligent MongoDB Backup
// Always uses file storage for speed, MongoDB syncs based on mode & health
// ============================================================================

import { WAProto as proto, initAuthCreds } from "@nexustechpro/baileys"
import { createComponentLogger } from "../../utils/logger.js"
import fs from "fs/promises"
import path from "path"

const logger = createComponentLogger("AUTH_STATE")
const globalCollectionRefs = new Map()
const preKeyDebounceTimers = new Map()
const syncQueue = new Map()

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  MONGODB_TIMEOUT: 5000,
  INITIAL_SYNC_DELAY: 2000,
  BACKUP_INTERVAL: 30 * 60 * 1000, // 30 minutes
  PREKEY_WRITE_DEBOUNCE: 100,
  SYNC_BATCH_SIZE: 10,
  SYNC_BATCH_DELAY: 50,
  HEALTH_CHECK_INTERVAL: 30000, // Check MongoDB health every 30s
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
      const filePath = path.join(this.dir, sanitizeFileName(fileName))
      const content = await fs.readFile(filePath, "utf8")
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
}

// ============================================================================
// MONGODB BACKGROUND SYNC CLASS WITH INTELLIGENT BACKUP
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
    this.lastHealthCheck = Date.now()
    this.consecutiveFailures = 0
    
    // Start periodic health monitoring
    this._startHealthMonitoring()
  }

  _startHealthMonitoring() {
    this.healthTimer = setInterval(() => {
      this._checkHealth()
    }, CONFIG.HEALTH_CHECK_INTERVAL)
  }

  async _checkHealth() {
    if (!this.mongo?.isConnected) {
      if (this.isHealthy) {
        logger.warn(`[${this.sessionId}] MongoDB marked as unhealthy - not connected`)
      }
      this.isHealthy = false
      return
    }

    try {
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("health check timeout")), 5000)
      )
      
      await Promise.race([
        this.mongo.client?.db("admin").command({ ping: 1 }),
        timeout
      ])
      
      if (!this.isHealthy) {
        logger.info(`[${this.sessionId}] MongoDB connection restored`)
      }
      this.isHealthy = true
      this.consecutiveFailures = 0
      this.lastHealthCheck = Date.now()
    } catch (error) {
      this.consecutiveFailures++
      
      // Mark as unhealthy after 3 consecutive failures
      if (this.consecutiveFailures >= 3 && this.isHealthy) {
        logger.warn(`[${this.sessionId}] MongoDB marked as unhealthy after ${this.consecutiveFailures} failures`)
        this.isHealthy = false
      }
    }
  }

  // Determine what should be backed up based on mode and health
  shouldBackupFile(fileName) {
    const isPreKey = isPreKeyFile(fileName)
    const isCreds = fileName === "creds.json"
    
    // MongoDB mode: backup everything regardless of health
    if (isMongoDBMode()) {
      return true
    }
    
    // File mode with healthy MongoDB: backup everything
    if (isFileMode() && this.isHealthy) {
      return true
    }
    
    // File mode with unhealthy MongoDB: only backup creds.json
    if (isFileMode() && !this.isHealthy) {
      if (isPreKey) {
        return false // Skip pre-keys when unhealthy
      }
      return isCreds || !isPreKey // Backup creds and non-prekey files
    }
    
    return false
  }

  // Fire-and-forget write with intelligent backup logic
  fireWrite(fileName, data) {
    if (!this.mongo?.isConnected) return

    // Check if we should backup this file
    if (!this.shouldBackupFile(fileName)) {
      if (isPreKeyFile(fileName)) {
        logger.debug(`[${this.sessionId}] Skipping pre-key backup (unhealthy MongoDB in file mode)`)
      }
      return
    }

    // Queue the write
    this.pendingWrites.set(fileName, data)

    // Process queue asynchronously
    setImmediate(() => this._processQueue())
  }

  async _processQueue() {
    if (this.syncInProgress || this.pendingWrites.size === 0) return
    if (!this.mongo?.isConnected) return

    this.syncInProgress = true

    try {
      const entries = Array.from(this.pendingWrites.entries())
      this.pendingWrites.clear()

      // Filter entries based on backup policy
      const entriesToSync = entries.filter(([fileName]) => this.shouldBackupFile(fileName))
      
      if (entriesToSync.length === 0) {
        return
      }

      // Process in batches
      for (let i = 0; i < entriesToSync.length; i += CONFIG.SYNC_BATCH_SIZE) {
        const batch = entriesToSync.slice(i, i + CONFIG.SYNC_BATCH_SIZE)
        
        await Promise.allSettled(
          batch.map(([fileName, data]) => 
            this._safeWrite(fileName, data)
          )
        )

        if (i + CONFIG.SYNC_BATCH_SIZE < entriesToSync.length) {
          await new Promise(r => setTimeout(r, CONFIG.SYNC_BATCH_DELAY))
        }
      }
      
      // Log sync stats periodically
      if (this.syncStats.attempted > 0 && this.syncStats.attempted % 20 === 0) {
        const healthStatus = this.isHealthy ? "healthy" : "unhealthy"
        logger.info(`[${this.sessionId}] MongoDB sync (${healthStatus}): ${this.syncStats.succeeded}/${this.syncStats.attempted} succeeded`)
      }
    } catch (error) {
      logger.debug(`[${this.sessionId}] Background sync error: ${error.message}`)
    } finally {
      this.syncInProgress = false
      
      if (this.pendingWrites.size > 0) {
        setImmediate(() => this._processQueue())
      }
    }
  }

  async _safeWrite(fileName, data) {
    this.syncStats.attempted++
    try {
      const json = JSON.stringify(data, BufferJSON.replacer)
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("timeout")), CONFIG.MONGODB_TIMEOUT)
      )
      
      await Promise.race([
        this.mongo.writeAuthData(this.sessionId, fileName, json),
        timeout
      ])
      
      this.syncStats.succeeded++
      logger.debug(`[${this.sessionId}] ✅ MongoDB synced: ${fileName}`)
    } catch (error) {
      this.syncStats.failed++
      this.consecutiveFailures++
      
      // Update health status on write failures
      if (this.consecutiveFailures >= 5) {
        this.isHealthy = false
      }
      
      logger.debug(`[${this.sessionId}] ❌ MongoDB sync failed for ${fileName}: ${error.message}`)
    }
  }

  // Fire-and-forget delete
  fireDelete(fileName) {
    if (!this.mongo?.isConnected) return

    setImmediate(async () => {
      try {
        const timeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("timeout")), CONFIG.MONGODB_TIMEOUT)
        )
        
        await Promise.race([
          this.mongo.deleteAuthData(this.sessionId, fileName),
          timeout
        ])
        
        logger.debug(`[${this.sessionId}] ✅ MongoDB deleted: ${fileName}`)
      } catch (error) {
        logger.debug(`[${this.sessionId}] MongoDB delete failed for ${fileName}: ${error.message}`)
      }
    })
  }

  // Safe read with timeout - used only for initial sync
  async safeRead(fileName) {
    if (!this.mongo?.isConnected) return null

    try {
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("timeout")), CONFIG.MONGODB_TIMEOUT)
      )
      
      const data = await Promise.race([
        this.mongo.readAuthData(this.sessionId, fileName),
        timeout
      ])
      
      return data ? JSON.parse(data, BufferJSON.reviver) : null
    } catch (error) {
      logger.debug(`[${this.sessionId}] MongoDB read failed for ${fileName}: ${error.message}`)
      return null
    }
  }

  // Safe list with timeout - used only for initial sync
  async safeList() {
    if (!this.mongo?.isConnected) return []

    try {
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("timeout")), CONFIG.MONGODB_TIMEOUT)
      )
      
      return await Promise.race([
        this.mongo.getAllAuthFiles(this.sessionId),
        timeout
      ])
    } catch (error) {
      logger.debug(`[${this.sessionId}] MongoDB list failed: ${error.message}`)
      return []
    }
  }

  // Fire-and-forget cleanup
  fireCleanup() {
    if (!this.mongo?.isConnected) return

    setImmediate(async () => {
      try {
        await this.mongo.deleteAuthState(this.sessionId)
        logger.info(`[${this.sessionId}] ✅ MongoDB cleanup completed`)
      } catch (error) {
        logger.debug(`[${this.sessionId}] MongoDB cleanup failed: ${error.message}`)
      }
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

const validateCredsForWrite = (creds, sessionId) => {
  const missing = []

  if (!creds?.noiseKey) missing.push("noiseKey")
  if (!creds?.signedIdentityKey) missing.push("signedIdentityKey")
  if (!creds?.me) missing.push("me")
  if (!creds?.account) missing.push("account")
  if (creds?.registered !== true) missing.push("registered")

  if (missing.length > 0) {
    logger.warn(`[${sessionId}] Incomplete creds.json - Missing: ${missing.join(", ")}`)
    return false
  }

  return true
}

// ============================================================================
// INITIAL MONGODB SYNC
// ============================================================================

const performInitialSync = async (fileStore, mongoSync, sessionId) => {
  try {
    logger.info(`[${sessionId}] Checking MongoDB for existing auth data...`)

    const mongoFiles = await mongoSync.safeList()
    
    if (!mongoFiles || mongoFiles.length === 0) {
      logger.info(`[${sessionId}] No MongoDB data found, using file storage`)
      return { synced: 0, total: 0 }
    }

    const fileFiles = await fileStore.listFiles()
    const hasFileData = fileFiles.length > 0

    if (hasFileData) {
      logger.info(`[${sessionId}] File storage has data, skipping MongoDB pull`)
      return { synced: 0, total: mongoFiles.length, skipped: true }
    }

    logger.info(`[${sessionId}] Pulling ${mongoFiles.length} files from MongoDB...`)

    let synced = 0
    for (let i = 0; i < mongoFiles.length; i += CONFIG.SYNC_BATCH_SIZE) {
      const batch = mongoFiles.slice(i, i + CONFIG.SYNC_BATCH_SIZE)
      
      const results = await Promise.allSettled(
        batch.map(async (fileName) => {
          const data = await mongoSync.safeRead(fileName)
          if (data && await fileStore.write(fileName, data)) {
            synced++
            return true
          }
          return false
        })
      )

      if (i + CONFIG.SYNC_BATCH_SIZE < mongoFiles.length) {
        await new Promise(r => setTimeout(r, CONFIG.SYNC_BATCH_DELAY))
      }
    }

    logger.info(`[${sessionId}] ✅ Synced ${synced}/${mongoFiles.length} files from MongoDB to file storage`)
    return { synced, total: mongoFiles.length }
  } catch (error) {
    logger.error(`[${sessionId}] Initial sync failed: ${error.message}`)
    return { synced: 0, total: 0, error: error.message }
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
  
  logger.info(`[${sessionId}] Auth: FILE-FIRST | Mode: ${mode.toUpperCase()} | MongoDB: ${hasMongoDB ? "available" : "unavailable"} | Source: ${source} | Pairing: ${isPairing}`)

  // Always initialize file storage
  const fileStore = new FileStorage(sessionId)
  await fileStore.init()

  // Initialize MongoDB background sync if available
  const mongoSync = hasMongoDB 
    ? new MongoBackgroundSync(mongoStorage, sessionId, mode)
    : null

  if (mongoSync) {
    globalCollectionRefs.set(sessionId, mongoStorage)
    
    if (isMongoDBMode()) {
      logger.info(`[${sessionId}] 📦 MongoDB backup: FULL (all files including pre-keys)`)
    } else if (isFileMode()) {
      logger.info(`[${sessionId}] 📦 MongoDB backup: INTELLIGENT (creds always, pre-keys only when healthy)`)
    }
  } else if (hasMongoDBUri()) {
    logger.warn(`[${sessionId}] ⚠️ MongoDB URI configured but not connected - no backup available`)
  } else {
    logger.info(`[${sessionId}] 💾 File-only mode (no MongoDB URI configured)`)
  }

  // ============================================================================
  // INITIAL SYNC FROM MONGODB (MUST HAPPEN BEFORE LOADING CREDS)
  // ============================================================================

  if (mongoSync && isMongoDBMode()) {
    logger.info(`[${sessionId}] Checking for MongoDB auth data to restore...`)
    const result = await performInitialSync(fileStore, mongoSync, sessionId)
    if (result.synced > 0) {
      logger.info(`[${sessionId}] ✅ Restored ${result.synced}/${result.total} files from MongoDB`)
    } else if (result.total > 0 && result.skipped) {
      logger.info(`[${sessionId}] File storage exists, keeping local data`)
    } else if (result.total === 0) {
      logger.info(`[${sessionId}] No MongoDB data found, will create new credentials`)
    }
  } else if (mongoSync && isFileMode()) {
    const mongoFiles = await mongoSync.safeList()
    if (mongoFiles.length > 0) {
      logger.info(`[${sessionId}] 📊 MongoDB has ${mongoFiles.length} backup files available`)
    }
  }

  // ============================================================================
  // READ OPERATION - ALWAYS FROM FILE
  // ============================================================================

  const readData = async (fileName) => {
    return await fileStore.read(fileName)
  }

  // ============================================================================
  // WRITE OPERATION - FILE FIRST, MONGODB BACKGROUND
  // ============================================================================

  const writeData = async (data, fileName) => {
    await fs.mkdir(fileStore.dir, { recursive: true }).catch(() => {})

    // Special handling for creds.json
    if (fileName === "creds.json") {
      const isValid = validateCredsForWrite(data, sessionId)
      
      // If invalid and NOT pairing, block the write
      if (!isValid && !isPairing) {
        logger.error(`[${sessionId}] 🚫 BLOCKED incomplete creds.json write (not pairing)`)
        return false
      }
      
      // If invalid but pairing, allow it with warning
      if (!isValid && isPairing) {
        logger.warn(`[${sessionId}] ⚠️ Writing incomplete creds.json (pairing in progress)`)
      }

      // Write to file (primary storage)
      const fileSuccess = await fileStore.write(fileName, data)

      // MongoDB sync strategy based on mode
      if (mongoSync && isMongoDBMode()) {
        // MongoDB mode: always sync immediately
        mongoSync.fireWrite(fileName, data)
        
        if (fileSuccess) {
          logger.info(`[${sessionId}] ✅ creds.json written to file${mongoSync.isHealthy ? " (MongoDB syncing)" : " (MongoDB backup queued)"}`)
        }
      } else if (fileSuccess) {
        // File mode: only log file write (backup happens on schedule)
        logger.info(`[${sessionId}] ✅ creds.json written to file`)
      }

      return fileSuccess
    }

    // For all other files
    const isPreKey = isPreKeyFile(fileName)

    if (isPreKey) {
      // Pre-keys: debounced write to file
      debouncePreKeyWrite(sessionId, fileName, async () => {
        await fileStore.write(fileName, data)
        // MongoDB mode: sync pre-keys immediately
        if (mongoSync && isMongoDBMode()) {
          mongoSync.fireWrite(fileName, data)
        }
        // File mode: pre-keys only backed up on schedule
      })
      return true
    }

    // Regular files: write to file first
    const success = await fileStore.write(fileName, data)
    
    // MongoDB mode: sync immediately
    if (success && mongoSync && isMongoDBMode()) {
      mongoSync.fireWrite(fileName, data)
    }
    // File mode: regular files only backed up on schedule

    return success
  }

  // ============================================================================
  // DELETE OPERATION - FILE FIRST, MONGODB BACKGROUND
  // ============================================================================

  const removeData = async (fileName) => {
    await fileStore.delete(fileName)

    if (mongoSync) {
      mongoSync.fireDelete(fileName)
    }
  }

  // ============================================================================
  // LOAD OR CREATE CREDENTIALS
  // ============================================================================

  const existing = await readData("creds.json")
  const creds = hasBasicKeys(existing) ? existing : initAuthCreds()
  const isNew = !existing

  if (isNew) {
    logger.info(`[${sessionId}] Creating new credentials`)
    await writeData(creds, "creds.json")
  } else {
    logger.info(`[${sessionId}] Loaded credentials from file storage`)
  }

  // ============================================================================
  // PERIODIC BACKUP TO MONGODB (FILE MODE ONLY)
  // ============================================================================

  let backupTimer = null

  if (isFileMode() && mongoSync) {
    const backup = async () => {
      try {
        const files = await fileStore.listFiles()
        const stats = mongoSync.getStats()
        
        logger.info(`[${sessionId}] Starting backup of ${files.length} files to MongoDB (health: ${stats.isHealthy ? "good" : "poor"})`)

        let backedUp = 0
        for (const file of files) {
          // Check if file should be backed up based on current health
          if (!mongoSync.shouldBackupFile(file)) {
            continue
          }
          
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

    // Start backup after 1 hour, then repeat every BACKUP_INTERVAL
    setTimeout(() => {
      backup()
      backupTimer = setInterval(backup, CONFIG.BACKUP_INTERVAL)
    }, 30 * 60 * 1000) // Start first backup after 5 minutes
  }

  // ============================================================================
  // RETURN AUTH STATE OBJECT
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
              if (value) {
                await writeData(value, file)
              } else {
                await removeData(file)
              }
            }
          }
        },
      },
    },
    saveCreds: () => writeData(creds, "creds.json"),
    cleanup: async () => {
      if (backupTimer) clearInterval(backupTimer)

      // Log sync stats before cleanup
      if (mongoSync) {
        const stats = mongoSync.getStats()
        if (stats.attempted > 0) {
          logger.info(`[${sessionId}] MongoDB sync final: ${stats.succeeded}/${stats.attempted} succeeded, ${stats.failed} failed (health: ${stats.isHealthy ? "good" : "poor"})`)
        }
        mongoSync.cleanup()
      }

      // Cleanup file storage
      await fileStore.cleanup()

      // Background cleanup MongoDB
      if (mongoSync) {
        mongoSync.fireCleanup()
      }

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

  if (sessionTimers.has(fileName)) {
    clearTimeout(sessionTimers.get(fileName))
  }

  sessionTimers.set(
    fileName,
    setTimeout(async () => {
      sessionTimers.delete(fileName)
      try {
        await writeFn()
      } catch (error) {
        // Silent failure
      }
    }, CONFIG.PREKEY_WRITE_DEBOUNCE)
  )
}

// ============================================================================
// EXPORTED UTILITY FUNCTIONS
// ============================================================================

export const cleanupSessionAuthData = async (mongoStorage, sessionId) => {
  try {
    // Cleanup file storage
    const fileStore = new FileStorage(sessionId)
    await fileStore.init()
    await fileStore.cleanup()

    // Background cleanup MongoDB if available and connected
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
    // Always check file storage first
    const fileStore = new FileStorage(sessionId)
    await fileStore.init()

    const fileCreds = await fileStore.read("creds.json")
    if (hasBasicKeys(fileCreds)) return true

    // Fallback to MongoDB if file doesn't exist and MongoDB is available
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
    } catch {
      hasMongo = false
    }
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
    if (isMongoDBMode()) {
      backupStrategy = "full (all files including pre-keys)"
    } else if (isFileMode()) {
      backupStrategy = "intelligent (creds always, pre-keys when healthy)"
    }
  }
  
  return {
    storageMode: "FILE-FIRST",
    configuredMode: mode.toUpperCase(),
    mongodbAvailable: hasMongo,
    backupStrategy,
    initialSyncDelay: `${CONFIG.INITIAL_SYNC_DELAY / 1000}s`,
    backupInterval: `${CONFIG.BACKUP_INTERVAL / 60000}min`,
    syncBatchSize: CONFIG.SYNC_BATCH_SIZE,
    activeCollectionRefs: globalCollectionRefs.size,
    description: "Always uses file storage for reads/writes, MongoDB syncs intelligently based on mode and health"
  }
}