import crypto from "crypto"
import { createComponentLogger } from "../../utils/logger.js"
import { MongoDBStorage } from "./mongodb.js"
import { PostgreSQLStorage } from "./postgres.js"
import { FileManager } from "./file.js"

const logger = createComponentLogger("SESSION_STORAGE")

const SESSION_CACHE_MAX_SIZE = 200
const SESSION_CACHE_TTL = 300000 // 5 minutes for normal operation
const SESSION_CACHE_EXTENDED_TTL = 7200000 // ✅ 2 hours when MongoDB is down
const WRITE_BUFFER_FLUSH_INTERVAL = 500
const FILE_SYNC_INTERVAL = 30000 // ✅ Sync cache to files every 30 seconds when DB is down

export class SessionStorage {
  constructor() {
    this.mongoStorage = new MongoDBStorage()
    this.postgresStorage = new PostgreSQLStorage()
    this.fileManager = new FileManager()

    this.sessionCache = new Map()
    this.writeBuffer = new Map()

    this.encryptionKey = this._getEncryptionKey()
    this.healthCheckInterval = null
    this.orphanCleanupInterval = null
    this.cacheCleanupInterval = null
    this.fileSyncInterval = null // ✅ NEW: Sync cache to files periodically

    // ✅ Track storage health
    this.storageHealth = {
      mongodb: { available: false, lastCheck: null, consecutiveFailures: 0, lastSuccessfulOperation: null },
      postgres: { available: false, lastCheck: null, consecutiveFailures: 0, lastSuccessfulOperation: null },
      files: { available: true, lastCheck: Date.now(), consecutiveFailures: 0, lastSuccessfulOperation: Date.now() }
    }

    // ✅ NEW: Track if we're in emergency file-only mode
    this.emergencyMode = false
    this.lastDatabaseSuccess = Date.now()

    this._startHealthCheck()
    this._startOrphanCleanup()
    this._startAggressiveCacheCleanup()
    this._startFileSyncMonitor() // ✅ NEW: Monitor and sync to files when DB is down

    logger.info("Session storage coordinator initialized (cache: 200 max, 5min TTL, auto file sync)")
  }

  get isConnected() {
    return this.mongoStorage.isConnected || this.postgresStorage.isConnected || this.fileManager !== null
  }

  get isMongoConnected() {
    return this.mongoStorage.isConnected
  }

  get isPostgresConnected() {
    return this.postgresStorage.isConnected
  }

  get client() {
    return this.mongoStorage.client
  }

  get sessions() {
    return this.mongoStorage.sessions
  }

  get postgresPool() {
    return this.postgresStorage.pool
  }

  /**
   * ✅ NEW: Smart storage selection based on health
   */
  _getAvailableStorage() {
    // Priority: MongoDB > PostgreSQL > Files
    if (this.mongoStorage.isConnected && this.storageHealth.mongodb.consecutiveFailures < 3) {
      return { type: 'mongodb', storage: this.mongoStorage }
    }
    
    if (this.postgresStorage.isConnected && this.storageHealth.postgres.consecutiveFailures < 3) {
      return { type: 'postgres', storage: this.postgresStorage }
    }
    
    return { type: 'files', storage: this.fileManager }
  }

  /**
   * ✅ NEW: Check if databases are operational
   */
  _isDatabaseAvailable() {
    return (this.mongoStorage.isConnected && this.storageHealth.mongodb.consecutiveFailures < 3) ||
           (this.postgresStorage.isConnected && this.storageHealth.postgres.consecutiveFailures < 3)
  }

  /**
   * ✅ NEW: Record storage operation result for health tracking
   */
  _recordStorageHealth(storageType, success) {
  if (!this.storageHealth[storageType]) return

  const health = this.storageHealth[storageType]
  health.lastCheck = Date.now()

  if (success) {
    health.consecutiveFailures = 0
    health.available = true
    health.lastSuccessfulOperation = Date.now()
    
    // Exit emergency mode when database is back
    if (storageType !== 'files' && this.emergencyMode) {
      const dbAvailable = this._isDatabaseAvailable()
      if (dbAvailable) {
        this.emergencyMode = false
        this.lastDatabaseSuccess = Date.now()
        logger.info(`✅ [RECOVERY] ${storageType} restored, exiting emergency mode`)
      }
    }
  } else {
    health.consecutiveFailures++
    
    if (health.consecutiveFailures >= 3) {
      health.available = false
      if (health.consecutiveFailures === 3) {
        logger.warn(`⚠️ Storage '${storageType}' marked unavailable after 3 failures`)
      }
    }
    
    // Enter emergency mode if all databases are down
    if (!this._isDatabaseAvailable() && !this.emergencyMode) {
      this.emergencyMode = true
      logger.error(`❌ [EMERGENCY] All databases down, entering file-only mode`)
      logger.info(`📁 [EMERGENCY] Cache extended to 2 hours, syncing to files every ${FILE_SYNC_INTERVAL/1000}s`)
    }
  }
}

  /**
   * ✅ NEW: Monitor and sync cache to files when DB is down
   */
  _startFileSyncMonitor() {
  this.fileSyncInterval = setInterval(async () => {
    const timeSinceDbSuccess = Date.now() - this.lastDatabaseSuccess
    const shouldSync = this.emergencyMode || timeSinceDbSuccess > 300000
    
    if (!shouldSync || this.sessionCache.size === 0) {
      return
    }

    // Check if we should exit emergency mode
    if (this.emergencyMode) {
      const hasDb = await this._checkStorageHealth()
      if (hasDb) {
        this.emergencyMode = false
        this.lastDatabaseSuccess = Date.now()
        logger.info(`✅ [RECOVERY] Database restored, exiting emergency mode`)
        return // Don't sync if database is back
      }
    }

    let syncedCount = 0
    let failedCount = 0

    // Sync cached sessions to files
    for (const [sessionId, sessionData] of this.sessionCache.entries()) {
      try {
        await this.fileManager.saveSession(sessionId, sessionData)
        syncedCount++
      } catch (error) {
        failedCount++
        if (failedCount <= 3) { // Only log first 3 errors
          logger.error(`Failed to sync ${sessionId} to file: ${error.message}`)
        }
      }
    }

    if (syncedCount > 0) {
      const mode = this.emergencyMode ? '[EMERGENCY]' : '[BACKUP]'
      logger.info(`${mode} Synced ${syncedCount} sessions to file storage${failedCount > 0 ? ` (${failedCount} failed)` : ''}`)
    }
  }, FILE_SYNC_INTERVAL)
}

  _startAggressiveCacheCleanup() {
    this.cacheCleanupInterval = setInterval(() => {
      this._cleanupStaleCache()
    }, 15000)
  }

 _cleanupStaleCache() {
  const now = Date.now()
  let removed = 0

  try {
    // Use extended TTL in emergency mode (2 hours vs 5 minutes)
    const effectiveTTL = this.emergencyMode ? SESSION_CACHE_EXTENDED_TTL : SESSION_CACHE_TTL
    
    for (const [key, value] of this.sessionCache.entries()) {
      if (value.lastCached && now - value.lastCached > effectiveTTL) {
        // In emergency mode, don't delete if no database available
        if (this.emergencyMode && !this._isDatabaseAvailable()) {
          continue // Keep cache entries
        }
        this.sessionCache.delete(key)
        removed++
      }
    }

    // More aggressive cleanup when not in emergency
    if (this.sessionCache.size > SESSION_CACHE_MAX_SIZE && !this.emergencyMode) {
      const entries = Array.from(this.sessionCache.entries())
        .sort((a, b) => a[1].lastCached - b[1].lastCached)

      const toRemove = entries.slice(0, this.sessionCache.size - SESSION_CACHE_MAX_SIZE / 2)
      toRemove.forEach(([key]) => {
        this.sessionCache.delete(key)
        removed++
      })
    }

    if (this.writeBuffer.size > 50) {
      this._flushWriteBuffer()
    }

    if (removed > 0) {
      const mode = this.emergencyMode ? '[EMERGENCY MODE]' : ''
      const ttl = effectiveTTL / 60000
      logger.debug(`${mode} Cleaned ${removed} cache entries (TTL: ${ttl}min, size: ${this.sessionCache.size}/${SESSION_CACHE_MAX_SIZE})`)
    }
  } catch (error) {
    logger.error("Cache cleanup error:", error.message)
  }
}

  async _flushWriteBuffer() {
    if (this.writeBuffer.size === 0) return

    const entries = Array.from(this.writeBuffer.entries())
    this.writeBuffer.clear()

    for (const [sessionId, data] of entries) {
      try {
        await this._writeToStorage(sessionId, data)
      } catch (error) {
        logger.error(`Failed to flush buffer for ${sessionId}:`, error.message)
      }
    }
  }

  /**
   * ✅ ENHANCED: Smart write with immediate file backup in emergency mode
   */
  async _writeToStorage(sessionId, sessionData) {
    const storages = [
      { type: 'mongodb', storage: this.mongoStorage, condition: () => this.mongoStorage.isConnected },
      { type: 'postgres', storage: this.postgresStorage, condition: () => this.postgresStorage.isConnected },
      { type: 'files', storage: this.fileManager, condition: () => true }
    ]

    let dbWriteSucceeded = false

    for (const { type, storage, condition } of storages) {
      if (!condition()) continue

      try {
        const result = await storage.saveSession(sessionId, sessionData)
        if (result) {
          this._recordStorageHealth(type, true)
          if (type !== 'files') {
            dbWriteSucceeded = true
            this.lastDatabaseSuccess = Date.now()
          }
          return true
        }
      } catch (error) {
        this._recordStorageHealth(type, false)
        logger.debug(`${type} write failed for ${sessionId}, trying next storage`)
      }
    }

    // ✅ If no database write succeeded and we have file storage, ensure it's there
    if (!dbWriteSucceeded) {
      try {
        await this.fileManager.saveSession(sessionId, sessionData)
        this._recordStorageHealth('files', true)
        return true
      } catch (error) {
        this._recordStorageHealth('files', false)
        logger.error(`All storages failed for ${sessionId}`)
      }
    }

    return false
  }

  /**
   * ✅ ULTRA-RESILIENT: Save with guaranteed cache update + immediate file backup in emergency
   */
  async saveSession(sessionId, sessionData, credentials = null) {
    // ✅ ALWAYS update cache first (never fails)
    try {
      if (this.sessionCache.size < SESSION_CACHE_MAX_SIZE) {
        this.sessionCache.set(sessionId, {
          ...sessionData,
          credentials,
          lastCached: Date.now(),
        })
      }
    } catch (cacheError) {
      logger.error(`Cache update failed for ${sessionId}:`, cacheError.message)
    }

    // ✅ In emergency mode, write to files immediately
    if (this.emergencyMode) {
      try {
        await this.fileManager.saveSession(sessionId, sessionData)
        this._recordStorageHealth('files', true)
        logger.debug(`[EMERGENCY] Saved ${sessionId} to file storage`)
        return true
      } catch (error) {
        this._recordStorageHealth('files', false)
        logger.error(`[EMERGENCY] File save failed for ${sessionId}: ${error.message}`)
      }
    }

    // ✅ Try all available storages
    try {
      let saved = false

      // Try MongoDB
      if (this.mongoStorage.isConnected) {
        try {
          saved = await this.mongoStorage.saveSession(sessionId, sessionData)
          this._recordStorageHealth('mongodb', saved)
          if (saved) this.lastDatabaseSuccess = Date.now()
        } catch (error) {
          this._recordStorageHealth('mongodb', false)
          logger.debug(`MongoDB save failed: ${error.message}`)
        }
      }

      // Try PostgreSQL
      if (this.postgresStorage.isConnected) {
        try {
          const pgSaved = await this.postgresStorage.saveSession(sessionId, sessionData)
          this._recordStorageHealth('postgres', pgSaved)
          if (pgSaved) this.lastDatabaseSuccess = Date.now()
          saved = saved || pgSaved
        } catch (error) {
          this._recordStorageHealth('postgres', false)
          logger.debug(`PostgreSQL save failed: ${error.message}`)
        }
      }

      // Fallback to files (always available)
      if (!saved) {
        try {
          saved = await this.fileManager.saveSession(sessionId, sessionData)
          this._recordStorageHealth('files', saved)
          if (saved) {
            logger.debug(`Saved ${sessionId} to file storage (DB unavailable)`)
          }
        } catch (error) {
          this._recordStorageHealth('files', false)
          logger.error(`File storage save failed: ${error.message}`)
        }
      }

      return saved
    } catch (error) {
      logger.error(`Error saving session ${sessionId}:`, error.message)
      // ✅ Even if all storage fails, cache was updated
      return false
    }
  }

  /**
   * ✅ ULTRA-RESILIENT: Get with guaranteed cache fallback (extended TTL in emergency)
   */
  async getSession(sessionId) {
    try {
      // ✅ ALWAYS check cache first
      const cached = this.sessionCache.get(sessionId)
      const effectiveTTL = this.emergencyMode ? SESSION_CACHE_EXTENDED_TTL : SESSION_CACHE_TTL
      
      if (cached && Date.now() - cached.lastCached < effectiveTTL) {
        return this._formatSessionData(cached)
      }

      // ✅ Try storages in priority order
      let sessionData = null

      // Try MongoDB
      if (this.mongoStorage.isConnected) {
        try {
          sessionData = await this.mongoStorage.getSession(sessionId)
          this._recordStorageHealth('mongodb', true)
          if (sessionData) this.lastDatabaseSuccess = Date.now()
        } catch (error) {
          this._recordStorageHealth('mongodb', false)
          logger.debug(`MongoDB get failed: ${error.message}`)
        }
      }

      // Try PostgreSQL
      if (!sessionData && this.postgresStorage.isConnected) {
        try {
          sessionData = await this.postgresStorage.getSession(sessionId)
          this._recordStorageHealth('postgres', true)
          if (sessionData) this.lastDatabaseSuccess = Date.now()
        } catch (error) {
          this._recordStorageHealth('postgres', false)
          logger.debug(`PostgreSQL get failed: ${error.message}`)
        }
      }

      // Try files
      if (!sessionData) {
        try {
          sessionData = await this.fileManager.getSession(sessionId)
          this._recordStorageHealth('files', !!sessionData)
        } catch (error) {
          this._recordStorageHealth('files', false)
          logger.debug(`File storage get failed: ${error.message}`)
        }
      }

      // ✅ Update cache on successful read
      if (sessionData) {
        if (this.sessionCache.size < SESSION_CACHE_MAX_SIZE) {
          this.sessionCache.set(sessionId, {
            ...sessionData,
            lastCached: Date.now(),
          })
        }
        return this._formatSessionData(sessionData)
      }

      // ✅ LAST RESORT: Use stale/expired cache if available (in emergency mode)
      if (cached) {
        const age = Date.now() - cached.lastCached
        const ageMinutes = Math.round(age / 60000)
        logger.warn(`[EMERGENCY] Using ${ageMinutes}min old cache for ${sessionId}`)
        return this._formatSessionData(cached)
      }

      this.sessionCache.delete(sessionId)
      return null
    } catch (error) {
      logger.error(`Error retrieving session ${sessionId}:`, error.message)
      
      // ✅ Try cache as last resort
      const cached = this.sessionCache.get(sessionId)
      if (cached) {
        logger.warn(`[EMERGENCY] Using cache fallback for ${sessionId}`)
        return this._formatSessionData(cached)
      }
      
      return null
    }
  }

  /**
   * ✅ ULTRA-RESILIENT: Update with guaranteed execution
   */
  async updateSessionImmediate(sessionId, updates) {
    try {
      logger.info(`🚀 IMMEDIATE update for ${sessionId}:`, updates)

      this._clearWriteBuffer(sessionId)
      updates.updatedAt = new Date()

      // ✅ ALWAYS update cache first
      try {
        if (this.sessionCache.has(sessionId)) {
          const cachedSession = this.sessionCache.get(sessionId)
          Object.assign(cachedSession, updates)
          cachedSession.lastCached = Date.now()
        }
      } catch (cacheError) {
        logger.error(`Cache update failed: ${cacheError.message}`)
      }

      let updated = false

      // Try MongoDB
      if (this.mongoStorage.isConnected) {
        try {
          updated = await this.mongoStorage.updateSession(sessionId, updates)
          this._recordStorageHealth('mongodb', updated)
          if (updated) {
            logger.info(`✅ MongoDB updated immediately for ${sessionId}`)
          }
        } catch (error) {
          this._recordStorageHealth('mongodb', false)
          logger.debug(`MongoDB update failed: ${error.message}`)
        }
      }

      // Try PostgreSQL
      if (this.postgresStorage.isConnected) {
        try {
          const pgUpdated = await this.postgresStorage.updateSession(sessionId, updates)
          this._recordStorageHealth('postgres', pgUpdated)
          if (pgUpdated) {
            logger.info(`✅ PostgreSQL updated immediately for ${sessionId}`)
          }
          updated = updated || pgUpdated
        } catch (error) {
          this._recordStorageHealth('postgres', false)
          logger.debug(`PostgreSQL update failed: ${error.message}`)
        }
      }

      // Fallback to files
      if (!updated) {
        try {
          await this.fileManager.updateSession(sessionId, updates)
          this._recordStorageHealth('files', true)
          logger.info(`✅ File storage updated immediately for ${sessionId}`)
          updated = true
        } catch (error) {
          this._recordStorageHealth('files', false)
          logger.error(`File storage update failed: ${error.message}`)
        }
      }

      return updated
    } catch (error) {
      logger.error(`Error in immediate update for ${sessionId}:`, error.message)
      // ✅ Cache was updated, so not a complete failure
      return false
    }
  }

  /**
   * ✅ ULTRA-RESILIENT: Buffered update with guaranteed cache update
   */
  async updateSession(sessionId, updates) {
    try {
      // ✅ ALWAYS update cache immediately
      try {
        if (this.sessionCache.has(sessionId)) {
          const cachedSession = this.sessionCache.get(sessionId)
          Object.assign(cachedSession, updates)
          cachedSession.lastCached = Date.now()
        }
      } catch (cacheError) {
        logger.error(`Cache update failed: ${cacheError.message}`)
      }

      // ✅ Buffer database updates
      const bufferId = `${sessionId}_update`

      if (this.writeBuffer.has(bufferId)) {
        const existingBuffer = this.writeBuffer.get(bufferId)
        if (existingBuffer.timeout) {
          clearTimeout(existingBuffer.timeout)
        }
        Object.assign(existingBuffer.data, updates)
      } else {
        this.writeBuffer.set(bufferId, {
          data: { ...updates },
          timeout: null,
        })
      }

      const timeoutId = setTimeout(async () => {
        const bufferedData = this.writeBuffer.get(bufferId)?.data
        if (!bufferedData) return

        try {
          bufferedData.updatedAt = new Date()

          let updated = false
          
          // Try MongoDB
          if (this.mongoStorage.isConnected) {
            try {
              updated = await this.mongoStorage.updateSession(sessionId, bufferedData)
              this._recordStorageHealth('mongodb', updated)
            } catch (error) {
              this._recordStorageHealth('mongodb', false)
            }
          }

          // Try PostgreSQL
          if (this.postgresStorage.isConnected) {
            try {
              const pgUpdated = await this.postgresStorage.updateSession(sessionId, bufferedData)
              this._recordStorageHealth('postgres', pgUpdated)
              updated = updated || pgUpdated
            } catch (error) {
              this._recordStorageHealth('postgres', false)
            }
          }

          // Fallback to files
          if (!updated) {
            try {
              await this.fileManager.updateSession(sessionId, bufferedData)
              this._recordStorageHealth('files', true)
            } catch (error) {
              this._recordStorageHealth('files', false)
            }
          }

          this.writeBuffer.delete(bufferId)
        } catch (error) {
          logger.error(`Error in buffered update for ${sessionId}:`, error.message)
          this.writeBuffer.delete(bufferId)
        }
      }, WRITE_BUFFER_FLUSH_INTERVAL)

      this.writeBuffer.get(bufferId).timeout = timeoutId
      return true
    } catch (error) {
      logger.error(`Error buffering update for ${sessionId}:`, error.message)
      // ✅ Cache was updated, so not a complete failure
      return true
    }
  }

  /**
   * ✅ RESILIENT: Delete with multi-storage cleanup
   */
  async deleteSessionKeepUser(sessionId) {
    try {
      this.sessionCache.delete(sessionId)
      this._clearWriteBuffer(sessionId)

      const results = {
        mongoSessionDeleted: false,
        authBaileysDeleted: false,
        postgresUpdated: false,
        postgresDeleted: false,
        fileDeleted: false,
        hadWebAuth: false,
      }

      // Try MongoDB (don't fail if unavailable)
      if (this.mongoStorage.isConnected) {
        try {
          results.authBaileysDeleted = await this.mongoStorage.deleteAuthState(sessionId)
          results.mongoSessionDeleted = await this.mongoStorage.deleteSession(sessionId)
          this._recordStorageHealth('mongodb', true)
        } catch (error) {
          this._recordStorageHealth('mongodb', false)
          logger.debug(`MongoDB delete failed: ${error.message}`)
        }
      }

      // Try files
      try {
        results.fileDeleted = await this.fileManager.cleanupSessionFiles(sessionId)
        this._recordStorageHealth('files', true)
      } catch (error) {
        this._recordStorageHealth('files', false)
        logger.debug(`File delete failed: ${error.message}`)
      }

      // Try PostgreSQL
      if (this.postgresStorage.isConnected) {
        try {
          const pgResult = await this.postgresStorage.deleteSessionKeepUser(sessionId)
          results.postgresUpdated = pgResult.updated
          results.postgresDeleted = pgResult.deleted
          results.hadWebAuth = pgResult.hadWebAuth
          this._recordStorageHealth('postgres', true)
        } catch (error) {
          this._recordStorageHealth('postgres', false)
          logger.debug(`PostgreSQL delete failed: ${error.message}`)
        }
      }

      logger.info(`Logout cleanup for ${sessionId}:`, results)

      return (
        results.authBaileysDeleted || results.mongoSessionDeleted || results.postgresUpdated || results.postgresDeleted
      )
    } catch (error) {
      logger.error(`Error in deleteSessionKeepUser for ${sessionId}:`, error.message)
      return false
    }
  }

  async _checkStorageHealth() {
  // Check MongoDB
  if (this.mongoStorage.isConnected) {
    try {
      await Promise.race([
        this.mongoStorage.client.db("admin").command({ ping: 1 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout')), 2000))
      ])
      this._recordStorageHealth('mongodb', true)
      return true
    } catch (error) {
      this._recordStorageHealth('mongodb', false)
    }
  }

  // Check PostgreSQL
  if (this.postgresStorage.isConnected) {
    try {
      const client = await this.postgresStorage.pool.connect()
      await client.query("SELECT 1")
      client.release()
      this._recordStorageHealth('postgres', true)
      return true
    } catch (error) {
      this._recordStorageHealth('postgres', false)
    }
  }

  return false
}

  /**
   * All other methods follow the same pattern...
   */
  async deleteSession(sessionId) {
    try {
      this.sessionCache.delete(sessionId)
      this._clearWriteBuffer(sessionId)

      let deleted = false

      if (this.mongoStorage.isConnected) {
        try {
          deleted = await this.mongoStorage.deleteSession(sessionId)
          this._recordStorageHealth('mongodb', deleted)
        } catch (error) {
          this._recordStorageHealth('mongodb', false)
        }
      }

      if (this.postgresStorage.isConnected) {
        try {
          const pgDeleted = await this.postgresStorage.deleteSession(sessionId)
          this._recordStorageHealth('postgres', pgDeleted)
          deleted = deleted || pgDeleted
        } catch (error) {
          this._recordStorageHealth('postgres', false)
        }
      }

      try {
        await this.fileManager.cleanupSessionFiles(sessionId)
        this._recordStorageHealth('files', true)
      } catch (error) {
        this._recordStorageHealth('files', false)
      }

      return deleted
    } catch (error) {
      logger.error(`Error deleting session ${sessionId}:`, error.message)
      return false
    }
  }

  async completelyDeleteSession(sessionId) {
    try {
      this.sessionCache.delete(sessionId)
      this._clearWriteBuffer(sessionId)

      const deletePromises = []

      if (this.mongoStorage.isConnected) {
        deletePromises.push(
          this.mongoStorage.deleteSession(sessionId).catch(e => {
            this._recordStorageHealth('mongodb', false)
            return false
          })
        )
        deletePromises.push(
          this.mongoStorage.deleteAuthState(sessionId).catch(e => {
            this._recordStorageHealth('mongodb', false)
            return false
          })
        )
      }

      if (this.postgresStorage.isConnected) {
        deletePromises.push(
          this.postgresStorage.completelyDeleteSession(sessionId).catch(e => {
            this._recordStorageHealth('postgres', false)
            return false
          })
        )
      }

      deletePromises.push(
        this.fileManager.cleanupSessionFiles(sessionId).catch(e => {
          this._recordStorageHealth('files', false)
          return false
        })
      )

      const results = await Promise.allSettled(deletePromises)
      const success = results.some((r) => r.status === "fulfilled" && r.value)

      logger.info(`Complete deletion for ${sessionId}: ${success}`)
      return success
    } catch (error) {
      logger.error(`Error completely deleting session ${sessionId}:`, error.message)
      return false
    }
  }

  async cleanupOrphanedSessions() {
    if (!this.mongoStorage.isConnected) {
      logger.debug("MongoDB not connected - skipping orphan cleanup")
      return { cleaned: 0, errors: 0 }
    }

    try {
      logger.info("Starting orphaned sessions cleanup...")

      const allSessions = await this.mongoStorage.sessions.find({}).toArray()

      if (allSessions.length === 0) {
        return { cleaned: 0, errors: 0 }
      }

      const authCollection = this.mongoStorage.db.collection("auth_baileys")
      let cleanedCount = 0
      let errorCount = 0

      for (const session of allSessions) {
        try {
          const sessionId = session.sessionId

          const credsExists = await authCollection.findOne({
            sessionId: sessionId,
            filename: "creds.json",
          })

          if (!credsExists) {
            logger.warn(`Session ${sessionId} has no auth - cleaning up`)

            if (this.mongoStorage.isConnected) {
              await this.mongoStorage.deleteSession(sessionId)
            }

            await this.fileManager.cleanupSessionFiles(sessionId)

            if (this.postgresStorage.isConnected) {
              const source = session.source || "telegram"
              await this.postgresStorage.cleanupOrphanedSession(sessionId, source)
            }

            this.sessionCache.delete(sessionId)
            this._clearWriteBuffer(sessionId)

            cleanedCount++
          }
        } catch (error) {
          logger.error(`Error cleaning orphaned session ${session.sessionId}:`, error.message)
          errorCount++
        }
      }

      logger.info(`Orphaned cleanup: ${cleanedCount} cleaned, ${errorCount} errors`)
      return { cleaned: cleanedCount, errors: errorCount }
    } catch (error) {
      logger.error("Orphaned sessions cleanup failed:", error.message)
      return { cleaned: 0, errors: 1 }
    }
  }

  async getAllSessions() {
    try {
      let sessions = []

      // Try PostgreSQL first
      if (this.postgresStorage.isConnected) {
        try {
          sessions = await this.postgresStorage.getAllSessions()
          this._recordStorageHealth('postgres', true)
        } catch (error) {
          this._recordStorageHealth('postgres', false)
        }
      }
      
      // Try MongoDB
      if (sessions.length === 0 && this.mongoStorage.isConnected) {
        try {
          sessions = await this.mongoStorage.getAllSessions()
          this._recordStorageHealth('mongodb', true)
        } catch (error) {
          this._recordStorageHealth('mongodb', false)
        }
      }
      
      // Try files
      if (sessions.length === 0) {
        try {
          sessions = await this.fileManager.getAllSessions()
          this._recordStorageHealth('files', true)
        } catch (error) {
          this._recordStorageHealth('files', false)
        }
      }

      return sessions.map((session) => this._formatSessionData(session))
    } catch (error) {
      logger.error("Error retrieving all sessions:", error.message)
      return []
    }
  }

  async getUndetectedWebSessions() {
    try {
      let sessions = []

      if (this.mongoStorage.isConnected) {
        try {
          sessions = await this.mongoStorage.getUndetectedWebSessions()
          this._recordStorageHealth('mongodb', true)
        } catch (error) {
          this._recordStorageHealth('mongodb', false)
        }
      }
      
      if (sessions.length === 0 && this.postgresStorage.isConnected) {
        try {
          sessions = await this.postgresStorage.getUndetectedWebSessions()
          this._recordStorageHealth('postgres', true)
        } catch (error) {
          this._recordStorageHealth('postgres', false)
        }
      }

      return sessions.map((session) => this._formatSessionData(session))
    } catch (error) {
      logger.error("Error getting undetected web sessions:", error.message)
      return []
    }
  }

  async markSessionAsDetected(sessionId, detected = true) {
    try {
      const updateData = {
        detected,
        detectedAt: detected ? new Date() : null,
      }

      let updated = false

      if (this.mongoStorage.isConnected) {
        try {
          updated = await this.mongoStorage.updateSession(sessionId, updateData)
          this._recordStorageHealth('mongodb', updated)
        } catch (error) {
          this._recordStorageHealth('mongodb', false)
        }
      }

      if (this.postgresStorage.isConnected) {
        try {
          const pgUpdated = await this.postgresStorage.updateSession(sessionId, updateData)
          this._recordStorageHealth('postgres', pgUpdated)
          updated = updated || pgUpdated
        } catch (error) {
          this._recordStorageHealth('postgres', false)
        }
      }

      return updated
    } catch (error) {
      logger.error(`Error marking ${sessionId} as detected:`, error.message)
      return false
    }
  }

  _formatSessionData(sessionData) {
    if (!sessionData) return null

    return {
      sessionId: sessionData.sessionId,
      userId: sessionData.userId || sessionData.telegramId,
      telegramId: sessionData.telegramId || sessionData.userId,
      phoneNumber: sessionData.phoneNumber,
      isConnected: Boolean(sessionData.isConnected),
      connectionStatus: sessionData.connectionStatus || "disconnected",
      reconnectAttempts: sessionData.reconnectAttempts || 0,
      source: sessionData.source || "telegram",
      detected: sessionData.detected !== false,
      detectedAt: sessionData.detectedAt,
      credentials: sessionData.credentials || null,
      authState: sessionData.authState || null,
      createdAt: sessionData.createdAt,
      updatedAt: sessionData.updatedAt,
    }
  }

  _clearWriteBuffer(sessionId) {
    const bufferId = `${sessionId}_update`
    const bufferData = this.writeBuffer.get(bufferId)

    if (bufferData) {
      if (bufferData.timeout) {
        clearTimeout(bufferData.timeout)
      }
      this.writeBuffer.delete(bufferId)
    }
  }

  _getEncryptionKey() {
    const key = process.env.SESSION_ENCRYPTION_KEY || "default-key-change-in-production"
    return crypto.createHash("sha256").update(key).digest()
  }

  _startHealthCheck() {
    this.healthCheckInterval = setInterval(async () => {
      // Check MongoDB
      if (this.mongoStorage.isConnected) {
        try {
          await this.mongoStorage.client.db("admin").command({ ping: 1 })
          this._recordStorageHealth('mongodb', true)
        } catch (error) {
          this._recordStorageHealth('mongodb', false)
        }
      } else {
        this.storageHealth.mongodb.available = false
      }

      // Check PostgreSQL
      if (this.postgresStorage.isConnected) {
        try {
          const client = await this.postgresStorage.pool.connect()
          await client.query("SELECT 1")
          client.release()
          this._recordStorageHealth('postgres', true)
        } catch (error) {
          this._recordStorageHealth('postgres', false)
        }
      } else {
        this.storageHealth.postgres.available = false
      }
    }, 60000)
  }

  _startOrphanCleanup() {
    this.orphanCleanupInterval = setInterval(async () => {
      await this.cleanupOrphanedSessions().catch((error) => {
        logger.error("Periodic orphan cleanup error:", error.message)
      })
    }, 1800000)

    setTimeout(async () => {
      await this.cleanupOrphanedSessions().catch((error) => {
        logger.error("Initial orphan cleanup error:", error.message)
      })
    }, 120000)
  }

  getConnectionStatus() {
    return {
      mongodb: this.mongoStorage.isConnected,
      postgresql: this.postgresStorage.isConnected,
      fileManager: this.fileManager !== null,
      overall: this.isConnected,
      cacheSize: this.sessionCache.size,
      cacheMaxSize: SESSION_CACHE_MAX_SIZE,
      bufferSize: this.writeBuffer.size,
      health: {
        mongodb: {
          available: this.storageHealth.mongodb.available,
          failures: this.storageHealth.mongodb.consecutiveFailures
        },
        postgres: {
          available: this.storageHealth.postgres.available,
          failures: this.storageHealth.postgres.consecutiveFailures
        },
        files: {
          available: this.storageHealth.files.available,
          failures: this.storageHealth.files.consecutiveFailures
        }
      }
    }
  }

  async flushWriteBuffers() {
    const bufferKeys = Array.from(this.writeBuffer.keys())
    const flushPromises = []

    for (const bufferId of bufferKeys) {
      const bufferData = this.writeBuffer.get(bufferId)
      if (!bufferData) continue

      if (bufferData.timeout) {
        clearTimeout(bufferData.timeout)
      }

      const sessionId = bufferId.replace("_update", "")

      const flushPromise = (async () => {
        try {
          const updates = { ...bufferData.data, updatedAt: new Date() }

          if (this.mongoStorage.isConnected) {
            try {
              await this.mongoStorage.updateSession(sessionId, updates)
              this._recordStorageHealth('mongodb', true)
            } catch (error) {
              this._recordStorageHealth('mongodb', false)
            }
          }

          if (this.postgresStorage.isConnected) {
            try {
              await this.postgresStorage.updateSession(sessionId, updates)
              this._recordStorageHealth('postgres', true)
            } catch (error) {
              this._recordStorageHealth('postgres', false)
            }
          }

          this.writeBuffer.delete(bufferId)
        } catch (error) {
          logger.error(`Error flushing buffer for ${sessionId}:`, error.message)
        }
      })()

      flushPromises.push(flushPromise)
    }

    if (flushPromises.length > 0) {
      await Promise.allSettled(flushPromises)
      logger.info(`Flushed ${flushPromises.length} write buffers`)
    }
  }

  async close() {
    try {
      logger.info("Closing session storage...")

      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval)
      }

      if (this.orphanCleanupInterval) {
        clearInterval(this.orphanCleanupInterval)
      }

      if (this.cacheCleanupInterval) {
        clearInterval(this.cacheCleanupInterval)
      }

      if (this.fileSyncInterval) {
        clearInterval(this.fileSyncInterval)
      }

      await this.flushWriteBuffers()
      this.sessionCache.clear()

      await Promise.allSettled([this.mongoStorage.close(), this.postgresStorage.close()])

      logger.info("Session storage closed")
    } catch (error) {
      logger.error("Storage close error:", error.message)
    }
  }

 getStats() {
  const timeSinceDbSuccess = Date.now() - this.lastDatabaseSuccess
  
  return {
    connections: {
      mongodb: this.mongoStorage.isConnected,
      postgresql: this.postgresStorage.isConnected,
      fileManager: this.fileManager !== null,
      overall: this.isConnected,
    },
    emergencyMode: {
      active: this.emergencyMode,
      secondsSinceDbSuccess: Math.round(timeSinceDbSuccess / 1000),
      minutesSinceDbSuccess: Math.round(timeSinceDbSuccess / 60000),
      cacheTTL: this.emergencyMode ? '2 hours' : '5 minutes',
      fileSyncInterval: `${FILE_SYNC_INTERVAL / 1000}s`,
    },
    cache: {
      size: this.sessionCache.size,
      maxSize: SESSION_CACHE_MAX_SIZE,
      ttlMinutes: this.emergencyMode ? SESSION_CACHE_EXTENDED_TTL / 60000 : SESSION_CACHE_TTL / 60000,
      entries: Array.from(this.sessionCache.keys()).slice(0, 10),
    },
    writeBuffer: {
      size: this.writeBuffer.size,
      entries: Array.from(this.writeBuffer.keys()).slice(0, 10),
    },
    health: {
      mongodb: {
        available: this.storageHealth.mongodb.available,
        failures: this.storageHealth.mongodb.consecutiveFailures,
        lastSuccess: this.storageHealth.mongodb.lastSuccessfulOperation 
          ? new Date(this.storageHealth.mongodb.lastSuccessfulOperation).toISOString()
          : null
      },
      postgres: {
        available: this.storageHealth.postgres.available,
        failures: this.storageHealth.postgres.consecutiveFailures,
        lastSuccess: this.storageHealth.postgres.lastSuccessfulOperation
          ? new Date(this.storageHealth.postgres.lastSuccessfulOperation).toISOString()
          : null
      },
      files: {
        available: this.storageHealth.files.available,
        failures: this.storageHealth.files.consecutiveFailures
      }
    },
    fileManager: this.fileManager.getStats(),
  }
}
}

let storageInstance = null

export function initializeStorage() {
  if (!storageInstance) {
    storageInstance = new SessionStorage()
  }
  return storageInstance
}

export function getSessionStorage() {
  if (!storageInstance) {
    storageInstance = new SessionStorage()
  }
  return storageInstance
}