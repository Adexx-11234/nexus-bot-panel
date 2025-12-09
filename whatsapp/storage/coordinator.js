import crypto from "crypto"
import { createComponentLogger } from "../../utils/logger.js"
import { MongoDBStorage } from "./mongodb.js"
import { PostgreSQLStorage } from "./postgres.js"
import { FileManager } from "./file.js"
import { STORAGE_CONFIG, isFileBasedStorage, isMongoBasedStorage } from "../../config/constant.js"
import path from "path" // Added for _cleanupOrphanedFileSessions

const logger = createComponentLogger("SESSION_STORAGE")

const SESSION_CACHE_MAX_SIZE = 200
const SESSION_CACHE_TTL = 30000
const WRITE_BUFFER_FLUSH_INTERVAL = 500

export class SessionStorage {
  constructor() {
    this.storageType = STORAGE_CONFIG.TYPE
    logger.info(`Session storage initializing with ${this.storageType} mode`)

    // Always initialize file manager as it's used for session metadata
    this.fileManager = new FileManager()

    // Only initialize MongoDB if we're using mongo storage
    if (isMongoBasedStorage()) {
      this.mongoStorage = new MongoDBStorage()
    } else {
      this.mongoStorage = { isConnected: false, sessions: null, client: null }
      logger.info("MongoDB storage disabled - using file-based storage")
    }

    this.postgresStorage = new PostgreSQLStorage()

    this.sessionCache = new Map()
    this.writeBuffer = new Map()

    this.encryptionKey = this._getEncryptionKey()
    this.healthCheckInterval = null
    this.orphanCleanupInterval = null
    this.cacheCleanupInterval = null

    this._startHealthCheck()
    this._startOrphanCleanup()
    this._startAggressiveCacheCleanup()

    logger.info(`Session storage coordinator initialized (mode: ${this.storageType}, cache: 200 max, 30s TTL)`)
  }

  get isConnected() {
    if (isFileBasedStorage()) {
      return this.fileManager !== null || this.postgresStorage.isConnected
    }
    return this.mongoStorage.isConnected || this.postgresStorage.isConnected || this.fileManager !== null
  }

  get isMongoConnected() {
    return isMongoBasedStorage() && this.mongoStorage.isConnected
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

  _startAggressiveCacheCleanup() {
    this.cacheCleanupInterval = setInterval(() => {
      this._cleanupStaleCache()
    }, 15000)
  }

  _cleanupStaleCache() {
    const now = Date.now()
    let removed = 0

    try {
      for (const [key, value] of this.sessionCache.entries()) {
        if (value.lastCached && now - value.lastCached > SESSION_CACHE_TTL) {
          this.sessionCache.delete(key)
          removed++
        }
      }

      if (this.sessionCache.size > SESSION_CACHE_MAX_SIZE) {
        const entries = Array.from(this.sessionCache.entries()).sort((a, b) => a[1].lastCached - b[1].lastCached)

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
        logger.debug(`Cleaned ${removed} cache entries (size: ${this.sessionCache.size}/${SESSION_CACHE_MAX_SIZE})`)
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

  async _writeToStorage(sessionId, sessionData) {
    if (isFileBasedStorage()) {
      // For file-based, write to file first, then postgres if available
      const fileSaved = await this.fileManager.saveSession(sessionId, sessionData)
      if (this.postgresStorage.isConnected) {
        await this.postgresStorage.saveSession(sessionId, sessionData)
      }
      return fileSaved
    }

    // MongoDB mode
    if (this.mongoStorage.isConnected) {
      return await this.mongoStorage.saveSession(sessionId, sessionData)
    }
    if (this.postgresStorage.isConnected) {
      return await this.postgresStorage.saveSession(sessionId, sessionData)
    }
    return await this.fileManager.saveSession(sessionId, sessionData)
  }

  async saveSession(sessionId, sessionData, credentials = null) {
    try {
      let saved = false

      if (isFileBasedStorage()) {
        // File-based mode: save to file first
        saved = await this.fileManager.saveSession(sessionId, sessionData)

        // Also save to postgres if available (for web users)
        if (this.postgresStorage.isConnected) {
          await this.postgresStorage.saveSession(sessionId, sessionData)
        }
      } else {
        // MongoDB mode
        if (this.mongoStorage.isConnected) {
          saved = await this.mongoStorage.saveSession(sessionId, sessionData)
        }

        if (this.postgresStorage.isConnected) {
          const pgSaved = await this.postgresStorage.saveSession(sessionId, sessionData)
          saved = saved || pgSaved
        }

        if (!saved) {
          logger.warn(`DB unavailable for ${sessionId}, using file fallback`)
          saved = await this.fileManager.saveSession(sessionId, sessionData)
        }
      }

      if (saved) {
        if (this.sessionCache.size < SESSION_CACHE_MAX_SIZE) {
          this.sessionCache.set(sessionId, {
            ...sessionData,
            credentials,
            lastCached: Date.now(),
          })
        }
      }

      return saved
    } catch (error) {
      logger.error(`Error saving session ${sessionId}:`, error)
      return false
    }
  }

  async getSession(sessionId) {
    try {
      const cached = this.sessionCache.get(sessionId)
      if (cached && Date.now() - cached.lastCached < SESSION_CACHE_TTL) {
        return this._formatSessionData(cached)
      }

      if (cached) {
        this.sessionCache.delete(sessionId)
      }

      let sessionData = null

      if (isFileBasedStorage()) {
        // File-based mode: check file first
        sessionData = await this.fileManager.getSession(sessionId)

        // Fallback to postgres for web users
        if (!sessionData && this.postgresStorage.isConnected) {
          sessionData = await this.postgresStorage.getSession(sessionId)
        }
      } else {
        // MongoDB mode
        if (this.mongoStorage.isConnected) {
          sessionData = await this.mongoStorage.getSession(sessionId)
        }

        if (!sessionData && this.postgresStorage.isConnected) {
          sessionData = await this.postgresStorage.getSession(sessionId)
        }

        if (!sessionData) {
          sessionData = await this.fileManager.getSession(sessionId)
        }
      }

      if (sessionData) {
        if (this.sessionCache.size < SESSION_CACHE_MAX_SIZE) {
          this.sessionCache.set(sessionId, {
            ...sessionData,
            lastCached: Date.now(),
          })
        }
        return this._formatSessionData(sessionData)
      }

      this.sessionCache.delete(sessionId)
      return null
    } catch (error) {
      logger.error(`Error retrieving session ${sessionId}:`, error)
      return null
    }
  }

  async updateSessionImmediate(sessionId, updates) {
    try {
      logger.info(`🚀 IMMEDIATE update for ${sessionId}:`, updates)

      this._clearWriteBuffer(sessionId)

      updates.updatedAt = new Date()

      let updated = false

      if (isFileBasedStorage()) {
        updated = await this.fileManager.updateSession(sessionId, updates)
        if (updated) {
          logger.info(`✅ File storage updated immediately for ${sessionId}`)
        }

        if (this.postgresStorage.isConnected) {
          const pgUpdated = await this.postgresStorage.updateSession(sessionId, updates)
          if (pgUpdated) {
            logger.info(`✅ PostgreSQL updated immediately for ${sessionId}`)
          }
          updated = updated || pgUpdated
        }
      } else {
        if (this.mongoStorage.isConnected) {
          updated = await this.mongoStorage.updateSession(sessionId, updates)
          if (updated) {
            logger.info(`✅ MongoDB updated immediately for ${sessionId}`)
          }
        }

        if (this.postgresStorage.isConnected) {
          const pgUpdated = await this.postgresStorage.updateSession(sessionId, updates)
          if (pgUpdated) {
            logger.info(`✅ PostgreSQL updated immediately for ${sessionId}`)
          }
          updated = updated || pgUpdated
        }

        if (!updated) {
          await this.fileManager.updateSession(sessionId, updates)
          logger.info(`✅ File storage updated immediately for ${sessionId}`)
        }
      }

      if (this.sessionCache.has(sessionId)) {
        const cachedSession = this.sessionCache.get(sessionId)
        Object.assign(cachedSession, updates)
        cachedSession.lastCached = Date.now()
      }

      return updated
    } catch (error) {
      logger.error(`Error in immediate update for ${sessionId}:`, error)
      return false
    }
  }

  async updateSession(sessionId, updates) {
    try {
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

          if (isFileBasedStorage()) {
            updated = await this.fileManager.updateSession(sessionId, bufferedData)

            if (this.postgresStorage.isConnected) {
              const pgUpdated = await this.postgresStorage.updateSession(sessionId, bufferedData)
              updated = updated || pgUpdated
            }
          } else {
            if (this.mongoStorage.isConnected) {
              updated = await this.mongoStorage.updateSession(sessionId, bufferedData)
            }

            if (this.postgresStorage.isConnected) {
              const pgUpdated = await this.postgresStorage.updateSession(sessionId, bufferedData)
              updated = updated || pgUpdated
            }

            if (!updated) {
              await this.fileManager.updateSession(sessionId, bufferedData)
            }
          }

          if (this.sessionCache.has(sessionId)) {
            const cachedSession = this.sessionCache.get(sessionId)
            Object.assign(cachedSession, bufferedData)
            cachedSession.lastCached = Date.now()
          }

          this.writeBuffer.delete(bufferId)
        } catch (error) {
          logger.error(`Error in buffered update for ${sessionId}:`, error)
          this.writeBuffer.delete(bufferId)
        }
      }, WRITE_BUFFER_FLUSH_INTERVAL)

      this.writeBuffer.get(bufferId).timeout = timeoutId
      return true
    } catch (error) {
      logger.error(`Error buffering update for ${sessionId}:`, error)
      return false
    }
  }

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

      if (isFileBasedStorage()) {
        // For file-based, delete the session file
        results.fileDeleted = await this.fileManager.cleanupSessionFiles(sessionId)
      } else {
        if (this.mongoStorage.isConnected) {
          results.authBaileysDeleted = await this.mongoStorage.deleteAuthState(sessionId)
          results.mongoSessionDeleted = await this.mongoStorage.deleteSession(sessionId)
        }

        results.fileDeleted = await this.fileManager.cleanupSessionFiles(sessionId)
      }

      if (this.postgresStorage.isConnected) {
        const pgResult = await this.postgresStorage.deleteSessionKeepUser(sessionId)
        results.postgresUpdated = pgResult.updated
        results.postgresDeleted = pgResult.deleted
        results.hadWebAuth = pgResult.hadWebAuth
      }

      logger.info(`Logout cleanup for ${sessionId}:`, results)

      return (
        results.authBaileysDeleted ||
        results.mongoSessionDeleted ||
        results.postgresUpdated ||
        results.postgresDeleted ||
        results.fileDeleted
      )
    } catch (error) {
      logger.error(`Error in deleteSessionKeepUser for ${sessionId}:`, error)
      return false
    }
  }

  async deleteSession(sessionId) {
    try {
      this.sessionCache.delete(sessionId)
      this._clearWriteBuffer(sessionId)

      let deleted = false

      if (isFileBasedStorage()) {
        deleted = await this.fileManager.cleanupSessionFiles(sessionId)
      } else {
        if (this.mongoStorage.isConnected) {
          deleted = await this.mongoStorage.deleteSession(sessionId)
        }

        await this.fileManager.cleanupSessionFiles(sessionId)
      }

      if (this.postgresStorage.isConnected) {
        const pgDeleted = await this.postgresStorage.deleteSession(sessionId)
        deleted = deleted || pgDeleted
      }

      return deleted
    } catch (error) {
      logger.error(`Error deleting session ${sessionId}:`, error)
      return false
    }
  }

  async completelyDeleteSession(sessionId) {
    try {
      this.sessionCache.delete(sessionId)
      this._clearWriteBuffer(sessionId)

      const deletePromises = []

      if (isFileBasedStorage()) {
        deletePromises.push(this.fileManager.cleanupSessionFiles(sessionId))
      } else {
        if (this.mongoStorage.isConnected) {
          deletePromises.push(this.mongoStorage.deleteSession(sessionId))
          deletePromises.push(this.mongoStorage.deleteAuthState(sessionId))
        }

        deletePromises.push(this.fileManager.cleanupSessionFiles(sessionId))
      }

      if (this.postgresStorage.isConnected) {
        deletePromises.push(this.postgresStorage.completelyDeleteSession(sessionId))
      }

      const results = await Promise.allSettled(deletePromises)
      const success = results.some((r) => r.status === "fulfilled" && r.value)

      logger.info(`Complete deletion for ${sessionId}: ${success}`)
      return success
    } catch (error) {
      logger.error(`Error completely deleting session ${sessionId}:`, error)
      return false
    }
  }

  async cleanupOrphanedSessions() {
    if (isFileBasedStorage()) {
      return await this._cleanupOrphanedFileSessions()
    }

    if (!this.mongoStorage.isConnected) {
      logger.warn("MongoDB not connected - skipping orphan cleanup")
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
      logger.error("Orphaned sessions cleanup failed:", error)
      return { cleaned: 0, errors: 1 }
    }
  }

  async _cleanupOrphanedFileSessions() {
    try {
      logger.info("Starting file-based orphaned sessions cleanup...")

      const allSessions = await this.fileManager.getAllSessions()
      let cleanedCount = 0
      let errorCount = 0

      const authDir = path.resolve(process.cwd(), STORAGE_CONFIG.AUTH_SESSIONS_DIR)
      const fs = await import("fs")
      // const path = await import('path') // path is already imported at the top

      for (const session of allSessions) {
        try {
          const sessionId = session.sessionId
          const authPath = path.join(authDir, sessionId, "creds.json")

          // Check if auth credentials exist
          if (!fs.existsSync(authPath)) {
            logger.warn(`Session ${sessionId} has no auth credentials - cleaning up`)

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

      logger.info(`File-based orphaned cleanup: ${cleanedCount} cleaned, ${errorCount} errors`)
      return { cleaned: cleanedCount, errors: errorCount }
    } catch (error) {
      logger.error("File-based orphaned sessions cleanup failed:", error)
      return { cleaned: 0, errors: 1 }
    }
  }

  async getAllSessions() {
    try {
      let sessions = []

      if (isFileBasedStorage()) {
        // File-based mode: get from file first
        sessions = await this.fileManager.getAllSessions()

        // Also check postgres for web users
        if (this.postgresStorage.isConnected) {
          const pgSessions = await this.postgresStorage.getAllSessions()
          // Merge, avoiding duplicates
          const sessionIds = new Set(sessions.map((s) => s.sessionId))
          for (const pgSession of pgSessions) {
            if (!sessionIds.has(pgSession.sessionId)) {
              sessions.push(pgSession)
            }
          }
        }
      } else {
        // MongoDB mode
        if (this.postgresStorage.isConnected) {
          sessions = await this.postgresStorage.getAllSessions()
        } else if (this.mongoStorage.isConnected) {
          sessions = await this.mongoStorage.getAllSessions()
        } else {
          sessions = await this.fileManager.getAllSessions()
        }
      }

      return sessions.map((session) => this._formatSessionData(session))
    } catch (error) {
      logger.error("Error retrieving all sessions:", error)
      return []
    }
  }

  async getUndetectedWebSessions() {
    try {
      let sessions = []

      if (this.mongoStorage.isConnected) {
        sessions = await this.mongoStorage.getUndetectedWebSessions()
      } else if (this.postgresStorage.isConnected) {
        sessions = await this.postgresStorage.getUndetectedWebSessions()
      }

      return sessions.map((session) => this._formatSessionData(session))
    } catch (error) {
      logger.error("Error getting undetected web sessions:", error)
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

      if (isFileBasedStorage()) {
        updated = await this.fileManager.updateSession(sessionId, updateData)
      } else if (this.mongoStorage.isConnected) {
        updated = await this.mongoStorage.updateSession(sessionId, updateData)
      }

      if (this.postgresStorage.isConnected) {
        const pgUpdated = await this.postgresStorage.updateSession(sessionId, updateData)
        updated = updated || pgUpdated
      }

      return updated
    } catch (error) {
      logger.error(`Error marking ${sessionId} as detected:`, error)
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
      if (isMongoBasedStorage() && this.mongoStorage.isConnected) {
        try {
          await this.mongoStorage.client.db("admin").command({ ping: 1 })
        } catch (error) {
          logger.warn("MongoDB health check failed")
          this.mongoStorage.isConnected = false
        }
      }

      if (this.postgresStorage.isConnected) {
        try {
          const client = await this.postgresStorage.pool.connect()
          await client.query("SELECT 1")
          client.release()
        } catch (error) {
          logger.warn("PostgreSQL health check failed")
          this.postgresStorage.isConnected = false
        }
      }
    }, 60000)
  }

  _startOrphanCleanup() {
    this.orphanCleanupInterval = setInterval(async () => {
      await this.cleanupOrphanedSessions().catch((error) => {
        logger.error("Periodic orphan cleanup error:", error)
      })
    }, 1800000)

    setTimeout(async () => {
      await this.cleanupOrphanedSessions().catch((error) => {
        logger.error("Initial orphan cleanup error:", error)
      })
    }, 120000)
  }

  getConnectionStatus() {
    return {
      storageType: this.storageType, // Include storage type
      mongodb: isMongoBasedStorage() && this.mongoStorage.isConnected,
      postgresql: this.postgresStorage.isConnected,
      fileManager: this.fileManager !== null,
      overall: this.isConnected,
      cacheSize: this.sessionCache.size,
      cacheMaxSize: SESSION_CACHE_MAX_SIZE,
      bufferSize: this.writeBuffer.size,
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

          if (isFileBasedStorage()) {
            await this.fileManager.updateSession(sessionId, updates)
          } else if (this.mongoStorage.isConnected) {
            await this.mongoStorage.updateSession(sessionId, updates)
          }

          if (this.postgresStorage.isConnected) {
            await this.postgresStorage.updateSession(sessionId, updates)
          }

          this.writeBuffer.delete(bufferId)
        } catch (error) {
          logger.error(`Error flushing buffer for ${sessionId}:`, error)
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

      await this.flushWriteBuffers()
      this.sessionCache.clear()

      const closePromises = [this.postgresStorage.close()]
      if (isMongoBasedStorage() && this.mongoStorage.close) {
        closePromises.push(this.mongoStorage.close())
      }

      await Promise.allSettled(closePromises)

      logger.info("Session storage closed")
    } catch (error) {
      logger.error("Storage close error:", error)
    }
  }

  getStats() {
    return {
      storageType: this.storageType, // Include storage type
      connections: {
        mongodb: isMongoBasedStorage() && this.mongoStorage.isConnected,
        postgresql: this.postgresStorage.isConnected,
        fileManager: this.fileManager !== null,
        overall: this.isConnected,
      },
      cache: {
        size: this.sessionCache.size,
        maxSize: SESSION_CACHE_MAX_SIZE,
        ttl: SESSION_CACHE_TTL,
      },
      writeBuffer: {
        size: this.writeBuffer.size,
        flushInterval: WRITE_BUFFER_FLUSH_INTERVAL,
      },
    }
  }
}

// Singleton instance
let storageInstance = null

export function getSessionStorage() {
  if (!storageInstance) {
    storageInstance = new SessionStorage()
  }
  return storageInstance
}

export async function initializeStorage() {
  const storage = getSessionStorage()
  return storage
}
