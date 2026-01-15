// ============================================================================
// auth-state.js - ULTRA-FAST File-First Auth with Intelligent MongoDB Backup
// ============================================================================

import { WAProto as proto, initAuthCreds } from "@nexustechpro/baileys"
import { createComponentLogger } from "../../utils/logger.js"
import fs from "fs/promises"
import path from "path"

const logger = createComponentLogger("AUTH_STATE")
const globalCollectionRefs = new Map()
const preKeyDebounceTimers = new Map()

// ============================================================================
// CONFIGURATION - OPTIMIZED FOR SPEED
// ============================================================================

const CONFIG = {
  MONGODB_TIMEOUT: 3000,
  BACKUP_INTERVAL: 30 * 60 * 1000,
  PREKEY_WRITE_DEBOUNCE: 50,
  SYNC_BATCH_SIZE: 90,
  SYNC_BATCH_DELAY: 20,
  HEALTH_CHECK_INTERVAL: 60000,
  FILE_CONCURRENCY: 90,
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
// FILE STORAGE CLASS - OPTIMIZED
// ============================================================================

class FileStorage {
  constructor(sessionId, baseDir = "./sessions") {
    this.sessionId = sessionId
    this.dir = path.join(baseDir, sessionId)
    this.writeCache = new Map()
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
      await fs.writeFile(filePath, JSON.stringify(data, BufferJSON.replacer), "utf8")
      return true
    } catch (error) {
      logger.error(`[${this.sessionId}] Write failed ${fileName}: ${error.message}`)
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
// MONGODB BACKGROUND SYNC - ULTRA FAST
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
      this.isHealthy = false
      return
    }
    try {
      await Promise.race([
        this.mongo.client?.db("admin").command({ ping: 1 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000))
      ])
      this.isHealthy = true
      this.consecutiveFailures = 0
    } catch (error) {
      this.consecutiveFailures++
      if (this.consecutiveFailures >= 3) this.isHealthy = false
    }
  }

  shouldBackupFile(fileName) {
    const isPreKey = isPreKeyFile(fileName)
    const isCreds = fileName === "creds.json"
    
    if (isMongoDBMode()) return true
    if (isFileMode() && this.isHealthy) return true
    if (isFileMode() && !this.isHealthy) return isPreKey ? false : (isCreds || !isPreKey)
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

      // Process in large batches with parallel writes
      for (let i = 0; i < entries.length; i += CONFIG.SYNC_BATCH_SIZE) {
        const batch = entries.slice(i, i + CONFIG.SYNC_BATCH_SIZE)
        await Promise.allSettled(batch.map(([fileName, data]) => this._safeWrite(fileName, data)))
        if (i + CONFIG.SYNC_BATCH_SIZE < entries.length) {
          await new Promise(r => setTimeout(r, CONFIG.SYNC_BATCH_DELAY))
        }
      }
    } catch (error) {
      logger.debug(`[${this.sessionId}] Sync error: ${error.message}`)
    } finally {
      this.syncInProgress = false
      if (this.pendingWrites.size > 0) setImmediate(() => this._processQueue())
    }
  }

  async _safeWrite(fileName, data) {
    this.syncStats.attempted++
    try {
      const json = JSON.stringify(data, BufferJSON.replacer)
      await Promise.race([
        this.mongo.writeAuthData(this.sessionId, fileName, json),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), CONFIG.MONGODB_TIMEOUT))
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
        await Promise.race([
          this.mongo.deleteAuthData(this.sessionId, fileName),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), CONFIG.MONGODB_TIMEOUT))
        ])
      } catch (error) {}
    })
  }

  async safeRead(fileName) {
    if (!this.mongo?.isConnected) return null
    try {
      const data = await Promise.race([
        this.mongo.readAuthData(this.sessionId, fileName),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), CONFIG.MONGODB_TIMEOUT))
      ])
      return data ? JSON.parse(data, BufferJSON.reviver) : null
    } catch (error) {
      return null
    }
  }

  async safeList() {
    if (!this.mongo?.isConnected) return []
    try {
      return await Promise.race([
        this.mongo.getAllAuthFiles(this.sessionId),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), CONFIG.MONGODB_TIMEOUT))
      ])
    } catch (error) {
      return []
    }
  }

  fireCleanup() {
    if (!this.mongo?.isConnected) return
    setImmediate(async () => {
      try {
        await this.mongo.deleteAuthState(this.sessionId)
        logger.info(`[${this.sessionId}] ✅ MongoDB cleanup completed`)
      } catch (error) {}
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
// INITIAL MONGODB SYNC - ULTRA FAST PARALLEL
// ============================================================================

const performInitialSync = async (fileStore, mongoSync, sessionId) => {
  try {
    const mongoFiles = await mongoSync.safeList()
    if (!mongoFiles || mongoFiles.length === 0) return { synced: 0, total: 0 }

    const fileFiles = await fileStore.listFiles()
    if (fileFiles.length > 0) return { synced: 0, total: mongoFiles.length, skipped: true }

    logger.info(`[${sessionId}] Pulling ${mongoFiles.length} files from MongoDB...`)

    let synced = 0
    // Process files in parallel batches
    for (let i = 0; i < mongoFiles.length; i += CONFIG.FILE_CONCURRENCY) {
      const batch = mongoFiles.slice(i, i + CONFIG.FILE_CONCURRENCY)
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
    }

    logger.info(`[${sessionId}] ✅ Synced ${synced}/${mongoFiles.length} files`)
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
  
  logger.info(`[${sessionId}] Auth: FILE-FIRST | Mode: ${mode.toUpperCase()} | MongoDB: ${hasMongoDB ? "✓" : "✗"}`)

  const fileStore = new FileStorage(sessionId)
  await fileStore.init()

  const mongoSync = hasMongoDB ? new MongoBackgroundSync(mongoStorage, sessionId, mode) : null

  if (mongoSync) {
    globalCollectionRefs.set(sessionId, mongoStorage)
    logger.info(`[${sessionId}] 📦 MongoDB backup: ${isMongoDBMode() ? "FULL" : "INTELLIGENT"}`)
  }

  // Initial sync from MongoDB
  if (mongoSync && isMongoDBMode()) {
    const result = await performInitialSync(fileStore, mongoSync, sessionId)
    if (result.synced > 0) {
      logger.info(`[${sessionId}] ✅ Restored ${result.synced}/${result.total} files`)
    }
  }

  // ============================================================================
  // READ/WRITE OPERATIONS
  // ============================================================================

  const readData = async (fileName) => await fileStore.read(fileName)

  const writeData = async (data, fileName) => {
    if (fileName === "creds.json") {
      const isValid = validateCredsForWrite(data, sessionId)
      if (!isValid && !isPairing) {
        logger.error(`[${sessionId}] 🚫 BLOCKED incomplete creds.json`)
        return false
      }
      const success = await fileStore.write(fileName, data)
      if (success && mongoSync && isMongoDBMode()) mongoSync.fireWrite(fileName, data)
      return success
    }

    if (isPreKeyFile(fileName)) {
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
  const isNew = !existing

  if (isNew) {
    logger.info(`[${sessionId}] Creating new credentials`)
    await writeData(creds, "creds.json")
  } else {
    logger.info(`[${sessionId}] Loaded credentials`)
  }

  // ============================================================================
  // PERIODIC BACKUP (FILE MODE ONLY)
  // ============================================================================

  let backupTimer = null
  if (isFileMode() && mongoSync) {
    const backup = async () => {
      try {
        const files = await fileStore.listFiles()
        let backedUp = 0
        // Parallel backup with batching
        for (let i = 0; i < files.length; i += CONFIG.FILE_CONCURRENCY) {
          const batch = files.slice(i, i + CONFIG.FILE_CONCURRENCY)
          await Promise.allSettled(batch.map(async (file) => {
            if (!mongoSync.shouldBackupFile(file)) return
            const data = await fileStore.read(file)
            if (data) {
              mongoSync.fireWrite(file, data)
              backedUp++
            }
          }))
        }
        logger.info(`[${sessionId}] Backup queued: ${backedUp}/${files.length} files`)
      } catch (error) {
        logger.error(`[${sessionId}] Backup failed: ${error.message}`)
      }
    }

    setTimeout(() => {
      backup()
      backupTimer = setInterval(backup, CONFIG.BACKUP_INTERVAL)
    }, 5 * 60 * 1000)
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
          // Parallel key reads
          const results = await Promise.allSettled(
            ids.map(async (id) => {
              const fileName = `${type}-${id}.json`
              let value = await readData(fileName)
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
              }
              return { id, value }
            })
          )
          results.forEach(r => {
            if (r.status === 'fulfilled' && r.value.value) {
              data[r.value.id] = r.value.value
            }
          })
          return data
        },
        set: async (data) => {
          const writes = []
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const file = `${category}-${id}.json`
              writes.push(value ? writeData(value, file) : removeData(file))
            }
          }
          // Parallel writes
          await Promise.allSettled(writes)
        },
      },
    },
    saveCreds: () => writeData(creds, "creds.json"),
    cleanup: async () => {
      if (backupTimer) clearInterval(backupTimer)
      if (mongoSync) {
        const stats = mongoSync.getStats()
        if (stats.attempted > 0) {
          logger.info(`[${sessionId}] MongoDB: ${stats.succeeded}/${stats.attempted} succeeded`)
        }
        mongoSync.cleanup()
      }
      await fileStore.cleanup()
      if (mongoSync) mongoSync.fireCleanup()
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
  sessionTimers.set(fileName, setTimeout(async () => {
    sessionTimers.delete(fileName)
    try { await writeFn() } catch (error) {}
  }, CONFIG.PREKEY_WRITE_DEBOUNCE))
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
    } catch {
      hasMongo = false
    }
  }
  return {
    hasFile,
    hasMongo,
    hasAuth: hasFile || hasMongo,
    preferred: "file",
    mode: "file-first-ultra-fast",
    mongoAvailable: hasMongoDBUri() && mongoStorage?.isConnected,
  }
}

export const getAuthStorageStats = () => {
  const mode = getStorageMode()
  const hasMongo = hasMongoDBUri()
  let backupStrategy = "none"
  if (hasMongo) {
    backupStrategy = isMongoDBMode() ? "full" : "intelligent"
  }
  return {
    storageMode: "FILE-FIRST-ULTRA-FAST",
    configuredMode: mode.toUpperCase(),
    mongodbAvailable: hasMongo,
    backupStrategy,
    syncBatchSize: CONFIG.SYNC_BATCH_SIZE,
    fileConcurrency: CONFIG.FILE_CONCURRENCY,
    activeCollectionRefs: globalCollectionRefs.size,
    description: "Ultra-fast file storage with parallel operations and intelligent MongoDB backup"
  }
}