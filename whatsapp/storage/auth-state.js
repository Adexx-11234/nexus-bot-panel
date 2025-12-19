import { WAProto as proto, initAuthCreds } from "@whiskeysockets/baileys"
import { createComponentLogger } from "../../utils/logger.js"
import fs from "fs/promises"
import path from "path"

const logger = createComponentLogger("AUTH_STATE")

// ==================== CONFIGURATION ====================
const CONFIG = {
  CACHE_DURATION: 2 * 60 * 60 * 1000, // 2 hours
  FILE_FALLBACK_DIR: "./auth_fallback",
  MAX_CACHE_SIZE: 50 * 1024 * 1024, // 50MB
  SYNC_INTERVAL: 60000, // 1 minute
}

// ==================== SERIALIZATION ====================
const BufferJSON = {
  replacer: (k, value) => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === "Buffer") {
      return { type: "Buffer", data: Buffer.from(value?.data || value).toString("base64") }
    }
    return value
  },
  reviver: (_, value) => {
    if (typeof value === "object" && !!value && (value.buffer === true || value.type === "Buffer")) {
      const val = value.data || value.value
      return typeof val === "string" ? Buffer.from(val, "base64") : Buffer.from(val || [])
    }
    return value
  },
}

// ==================== CACHE MANAGER ====================
class CacheManager {
  constructor(sessionId) {
    this.sessionId = sessionId
    this.cache = new Map() // fileName -> { data, timestamp, needsSync }
    this.size = 0
    this.startTime = Date.now()
    this.useFileFallback = false
    this.fallbackDir = path.join(CONFIG.FILE_FALLBACK_DIR, sessionId)
  }

  async init() {
    await fs.mkdir(this.fallbackDir, { recursive: true })
  }

  get(fileName) {
    return this.cache.get(fileName)?.data
  }

  set(fileName, data) {
    const oldSize = this.cache.has(fileName) ? JSON.stringify(this.cache.get(fileName).data).length : 0
    const newSize = JSON.stringify(data).length
    
    this.size = this.size - oldSize + newSize
    this.cache.set(fileName, { data, timestamp: Date.now(), needsSync: true })
  }

  has(fileName) {
    return this.cache.has(fileName)
  }

  delete(fileName) {
    if (this.cache.has(fileName)) {
      const size = JSON.stringify(this.cache.get(fileName).data).length
      this.size -= size
      this.cache.delete(fileName)
    }
  }

  // Get all files that need MongoDB sync
  getPendingSync() {
    const pending = []
    for (const [fileName, data] of this.cache.entries()) {
      if (data.needsSync) {
        pending.push({ fileName, data: data.data })
      }
    }
    return pending
  }

  // Mark file as synced to MongoDB
  markSynced(fileName) {
    const cached = this.cache.get(fileName)
    if (cached) cached.needsSync = false
  }

  // Check if we should switch to file fallback (2 hours cache-only)
  shouldUseFileFallback() {
    return Date.now() - this.startTime > CONFIG.CACHE_DURATION
  }

  // Save entire cache to file system
  async saveToFile() {
    try {
      for (const [fileName, data] of this.cache.entries()) {
        const filePath = path.join(this.fallbackDir, fileName)
        await fs.writeFile(filePath, JSON.stringify(data.data, BufferJSON.replacer), "utf8")
      }
      this.useFileFallback = true
      logger.info(`[${this.sessionId}] ✅ Cache saved to file fallback (${this.cache.size} files)`)
      return true
    } catch (error) {
      logger.error(`[${this.sessionId}] File fallback save failed: ${error.message}`)
      return false
    }
  }

  // Load from file system
  async loadFromFile(fileName) {
    try {
      const filePath = path.join(this.fallbackDir, fileName)
      const content = await fs.readFile(filePath, "utf8")
      return JSON.parse(content, BufferJSON.reviver)
    } catch (error) {
      return null
    }
  }

  // Save single file to fallback
  async saveFileToFallback(fileName, data) {
    try {
      const filePath = path.join(this.fallbackDir, fileName)
      await fs.writeFile(filePath, JSON.stringify(data, BufferJSON.replacer), "utf8")
      return true
    } catch (error) {
      logger.error(`[${this.sessionId}] Failed to save ${fileName} to fallback: ${error.message}`)
      return false
    }
  }
}

// ==================== GLOBAL CACHE STORAGE ====================
const sessionCaches = new Map() // sessionId -> CacheManager

// ==================== SYNC WORKER ====================
class SyncWorker {
  constructor(collection, sessionId, cacheManager) {
    this.collection = collection
    this.sessionId = sessionId
    this.cache = cacheManager
    this.interval = null
    this.isRunning = false
  }

  start() {
    if (this.interval) return
    
    this.interval = setInterval(() => this.sync(), CONFIG.SYNC_INTERVAL)
    logger.debug(`[${this.sessionId}] Sync worker started`)
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
      logger.debug(`[${this.sessionId}] Sync worker stopped`)
    }
  }

 async sync() {
  if (this.isRunning) return
  this.isRunning = true

  try {
    // REMOVED: Don't stop syncing after 2 hours
    // Keep trying to sync to MongoDB forever
    
    // If using file fallback, ALSO sync to MongoDB (not just files)
    const pending = this.cache.getPendingSync()
    if (pending.length === 0) return

    let synced = 0
    let failedCount = 0
    
    for (const { fileName, data } of pending) {
      try {
        await this.collection.updateOne(
          { filename: this.fixFileName(fileName), sessionId: this.sessionId },
          {
            $set: {
              filename: this.fixFileName(fileName),
              sessionId: this.sessionId,
              datajson: JSON.stringify(data, BufferJSON.replacer),
              updatedAt: new Date(),
            },
          },
          { upsert: true }
        )
        this.cache.markSynced(fileName)
        synced++
      } catch (error) {
        failedCount++
        // Save to file fallback on MongoDB failure
        await this.cache.saveFileToFallback(fileName, data)
      }
    }

    if (synced > 0) {
      logger.debug(`[${this.sessionId}] Synced ${synced}/${pending.length} files to MongoDB${failedCount > 0 ? ` (${failedCount} to file fallback)` : ''}`)
    }
  } catch (error) {
    logger.error(`[${this.sessionId}] Sync error: ${error.message}`)
  } finally {
    this.isRunning = false
  }
}
  fixFileName(file) {
    return file?.replace(/\//g, "__")?.replace(/:/g, "-") || ""
  }
}

// ==================== MAIN AUTH STATE ====================
export const useMongoDBAuthState = async (collection, sessionId, isPairing = false) => {
  if (!sessionId?.startsWith("session_")) {
    throw new Error(`Invalid sessionId: ${sessionId}`)
  }

  // Get or create cache manager
  let cacheManager = sessionCaches.get(sessionId)
  if (!cacheManager) {
    cacheManager = new CacheManager(sessionId)
    await cacheManager.init()
    sessionCaches.set(sessionId, cacheManager)
  }

  const fixFileName = (file) => file?.replace(/\//g, "__")?.replace(/:/g, "-") || ""

  // ==================== READ DATA ====================
  const readData = async (fileName) => {
    // 1. Check cache first
    if (cacheManager.has(fileName)) {
      return cacheManager.get(fileName)
    }

    // 2. If using file fallback, load from file
    if (cacheManager.useFileFallback) {
      const data = await cacheManager.loadFromFile(fileName)
      if (data) {
        cacheManager.set(fileName, data)
        cacheManager.markSynced(fileName) // Already in file
      }
      return data
    }

    // 3. Try MongoDB (always assume healthy as requested)
    try {
      const result = await collection.findOne(
        { filename: fixFileName(fileName), sessionId },
        { projection: { datajson: 1 } }
      )

      if (result) {
        const data = JSON.parse(result.datajson, BufferJSON.reviver)
        cacheManager.set(fileName, data)
        cacheManager.markSynced(fileName) // Already in MongoDB
        return data
      }
    } catch (error) {
      // MongoDB failed, try file fallback
      const data = await cacheManager.loadFromFile(fileName)
      if (data) {
        cacheManager.set(fileName, data)
        return data
      }
    }

    return null
  }

  // ==================== WRITE DATA ====================
  // ==================== WRITE DATA ====================
const writeData = async (data, fileName) => {
  // CRITICAL: Always write to cache immediately (NEVER fails)
  cacheManager.set(fileName, data)

  // CRITICAL: Always try MongoDB first, THEN file fallback
  let mongoWriteSuccess = false
  
  try {
    await collection.updateOne(
      { filename: fixFileName(fileName), sessionId },
      {
        $set: {
          filename: fixFileName(fileName),
          sessionId: sessionId,
          datajson: JSON.stringify(data, BufferJSON.replacer),
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    )
    mongoWriteSuccess = true
    cacheManager.markSynced(fileName)
    logger.debug(`[${sessionId}] ✅ Wrote ${fileName} to MongoDB`)
  } catch (error) {
    logger.warn(`[${sessionId}] MongoDB write failed for ${fileName}, using file fallback: ${error.message}`)
  }

  // Also save to file fallback as backup (don't wait)
  if (cacheManager.useFileFallback || !mongoWriteSuccess) {
    cacheManager.saveFileToFallback(fileName, data).catch(err => {
      logger.error(`[${sessionId}] File fallback failed for ${fileName}: ${err.message}`)
    })
  }
}

  // ==================== REMOVE DATA ====================
  const removeData = async (fileName) => {
    cacheManager.delete(fileName)

    if (cacheManager.useFileFallback) {
      try {
        const filePath = path.join(cacheManager.fallbackDir, fileName)
        await fs.unlink(filePath)
      } catch (error) {
        // File doesn't exist, ignore
      }
    }

    try {
      await collection.deleteOne({ filename: fixFileName(fileName), sessionId })
    } catch (error) {
      // MongoDB failed, ignore (already removed from cache/file)
    }
  }

  // ==================== LOAD CREDENTIALS ====================
  const existingCreds = await readData("creds.json")
  const creds = existingCreds?.noiseKey && existingCreds?.signedIdentityKey 
    ? existingCreds 
    : initAuthCreds()

  const isNewSession = !existingCreds

  if (isNewSession) {
    logger.info(`[${sessionId}] Creating new credentials`)
    await writeData(creds, "creds.json")
  } else {
    logger.info(`[${sessionId}] Loaded existing credentials`)
  }

  // Start sync worker
  const syncWorker = new SyncWorker(collection, sessionId, cacheManager)
  syncWorker.start()

  // ==================== RETURN AUTH STATE ====================
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
    cleanup: (force = false) => {
      syncWorker.stop()
      if (force) {
        sessionCaches.delete(sessionId)
      }
    },
  }
}

// ==================== CLEANUP ====================
export const cleanupSessionAuthData = async (collection, sessionId) => {
  try {
    await collection.deleteMany({ sessionId })
    
    const cacheManager = sessionCaches.get(sessionId)
    if (cacheManager) {
      // Remove fallback directory
      await fs.rm(cacheManager.fallbackDir, { recursive: true, force: true })
      sessionCaches.delete(sessionId)
    }
    
    logger.info(`[${sessionId}] Cleaned up auth data`)
    return true
  } catch (error) {
    logger.error(`[${sessionId}] Cleanup failed: ${error.message}`)
    return false
  }
}

// ==================== VALIDATION ====================
export const hasValidAuthData = async (collection, sessionId) => {
  const cacheManager = sessionCaches.get(sessionId)
  
  // Check cache
  if (cacheManager?.has('creds.json')) {
    const creds = cacheManager.get('creds.json')
    if (creds?.noiseKey && creds?.signedIdentityKey) {
      return true
    }
  }

  // Check file fallback
  if (cacheManager) {
    const creds = await cacheManager.loadFromFile('creds.json')
    if (creds?.noiseKey && creds?.signedIdentityKey) {
      return true
    }
  }

  // Check MongoDB
  try {
    const result = await collection.findOne(
      { filename: "creds.json", sessionId },
      { projection: { datajson: 1 } }
    )
    
    if (result) {
      const creds = JSON.parse(result.datajson, BufferJSON.reviver)
      return !!(creds?.noiseKey && creds?.signedIdentityKey)
    }
  } catch (error) {
    // MongoDB failed, already checked cache/file
  }

  return false
}

// ==================== STATS ====================
export const getAuthCacheStats = () => {
  let totalSize = 0
  let totalFiles = 0
  let usingFallback = 0
  
  for (const [sessionId, cache] of sessionCaches) {
    totalSize += cache.size
    totalFiles += cache.cache.size
    if (cache.useFileFallback) usingFallback++
  }

  return {
    sessions: sessionCaches.size,
    totalFiles,
    totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
    usingFileFallback,
  }
}