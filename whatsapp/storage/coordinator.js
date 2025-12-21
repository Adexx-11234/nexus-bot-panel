// ============================================================================
// session-coordinator.js - FIXED: Proper MongoDB/File/Postgres Coordination
// ============================================================================

import crypto from "crypto"
import { createComponentLogger } from "../../utils/logger.js"
import { MongoDBStorage } from "./mongodb.js"
import { PostgreSQLStorage } from "./postgres.js"
import { FileManager } from "./file.js"

const logger = createComponentLogger("SESSION_STORAGE")

const SESSION_CACHE_MAX_SIZE = 200
const SESSION_CACHE_TTL = 300000
const WRITE_BUFFER_FLUSH_INTERVAL = 500

export class SessionStorage {
  constructor() {
    this.storageMode = process.env.STORAGE_MODE || 'mongodb'
    
    // Initialize all storages
    this.mongoStorage = new MongoDBStorage()
    this.postgresStorage = new PostgreSQLStorage()
    this.fileManager = new FileManager()

    this.sessionCache = new Map()
    this.writeBuffer = new Map()

    this.encryptionKey = this._getEncryptionKey()
    this.healthCheckInterval = null
    this.orphanCleanupInterval = null
    this.cacheCleanupInterval = null

    this._startHealthCheck()
    this._startOrphanCleanup()
    this._startCacheCleanup()

    if (this.storageMode === 'file') {
      logger.info("📁 FILE MODE: Files primary, MongoDB for web detection, PostgreSQL always active")
    } else {
      logger.info("📦 MONGODB MODE: MongoDB primary with file backup, PostgreSQL always active")
    }
  }

  get isConnected() {
    return true // Always connected via files
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

  // ==================== SAVE SESSION ====================
  
  async saveSession(sessionId, sessionData, credentials = null) {
    logger.info(`💾 Saving session ${sessionId} (mode: ${this.storageMode}, source: ${sessionData.source || 'telegram'})`)

    // 1. Update cache
    if (this.sessionCache.size < SESSION_CACHE_MAX_SIZE) {
      this.sessionCache.set(sessionId, {
        ...sessionData,
        credentials,
        lastCached: Date.now(),
      })
    }

    let saved = false
    const isWebSession = sessionData.source === 'web'

    // 2. Always save to PostgreSQL (background, non-blocking)
    if (this.postgresStorage.isConnected) {
      this.postgresStorage.saveSession(sessionId, sessionData)
        .catch(err => logger.debug(`PostgreSQL save failed: ${err.message}`))
    }

    // 3. Save based on mode and session type
    if (this.storageMode === 'file') {
      // FILE MODE: Save to file
      try {
        saved = await this.fileManager.saveSession(sessionId, sessionData)
        if (saved) {
          logger.info(`✅ Saved to file: ${sessionId}`)
        }
      } catch (error) {
        logger.error(`File save failed for ${sessionId}:`, error.message)
      }

      // If web session, ALSO save to MongoDB for detection
      if (isWebSession && this.mongoStorage.isConnected) {
        this.mongoStorage.saveSession(sessionId, sessionData)
          .catch(err => logger.debug(`MongoDB web detection save failed: ${err.message}`))
      }

    } else {
      // MONGODB MODE: Try MongoDB first, fallback to file
      if (this.mongoStorage.isConnected) {
        try {
          saved = await this.mongoStorage.saveSession(sessionId, sessionData)
          if (saved) {
            logger.info(`✅ Saved to MongoDB: ${sessionId}`)
          }
        } catch (error) {
          logger.error(`MongoDB save failed for ${sessionId}:`, error.message)
        }
      }

      // Fallback to file if MongoDB failed
      if (!saved) {
        try {
          saved = await this.fileManager.saveSession(sessionId, sessionData)
          if (saved) {
            logger.info(`✅ Saved to file (fallback): ${sessionId}`)
          }
        } catch (error) {
          logger.error(`File fallback save failed for ${sessionId}:`, error.message)
        }
      }
    }

    return saved
  }

  // ==================== GET SESSION ====================
  
  async getSession(sessionId) {
    // Check cache first
    const cached = this.sessionCache.get(sessionId)
    if (cached && Date.now() - cached.lastCached < SESSION_CACHE_TTL) {
      return this._formatSessionData(cached)
    }

    let sessionData = null

    // Get based on mode
    if (this.storageMode === 'file') {
      // FILE MODE: Check file first
      sessionData = await this.fileManager.getSession(sessionId)
      
      // If not found and it's a web session, check MongoDB
      if (!sessionData && this.mongoStorage.isConnected) {
        const mongoData = await this.mongoStorage.getSession(sessionId)
        if (mongoData?.source === 'web') {
          sessionData = mongoData
        }
      }
    } else {
      // MONGODB MODE: Check MongoDB first, then file
      if (this.mongoStorage.isConnected) {
        sessionData = await this.mongoStorage.getSession(sessionId)
      }
      
      if (!sessionData) {
        sessionData = await this.fileManager.getSession(sessionId)
      }
    }

    // Update cache
    if (sessionData && this.sessionCache.size < SESSION_CACHE_MAX_SIZE) {
      this.sessionCache.set(sessionId, {
        ...sessionData,
        lastCached: Date.now(),
      })
    }

    return sessionData ? this._formatSessionData(sessionData) : null
  }

  // ==================== UPDATE SESSION ====================

  async updateSession(sessionId, updates) {
    // Update cache immediately
    if (this.sessionCache.has(sessionId)) {
      const cachedSession = this.sessionCache.get(sessionId)
      Object.assign(cachedSession, updates)
      cachedSession.lastCached = Date.now()
    }

    // Buffer the write
    const bufferId = `${sessionId}_update`
    if (this.writeBuffer.has(bufferId)) {
      const existing = this.writeBuffer.get(bufferId)
      if (existing.timeout) clearTimeout(existing.timeout)
      Object.assign(existing.data, updates)
    } else {
      this.writeBuffer.set(bufferId, { data: { ...updates }, timeout: null })
    }

    const timeoutId = setTimeout(async () => {
      const bufferedData = this.writeBuffer.get(bufferId)?.data
      if (!bufferedData) return

      bufferedData.updatedAt = new Date()

      // Get session to check if it's a web session
      const session = await this.getSession(sessionId)
      const isWebSession = session?.source === 'web'

      // Save based on mode
      if (this.storageMode === 'file') {
        await this.fileManager.updateSession(sessionId, bufferedData)
        
        // 🔴 CRITICAL FIX: For web sessions, ALWAYS update MongoDB (for detection)
        if (isWebSession && this.mongoStorage.isConnected) {
          await this.mongoStorage.updateSession(sessionId, bufferedData)
            .catch(err => logger.debug(`MongoDB update failed for web session: ${err.message}`))
        }
      } else {
        // MONGODB MODE
        if (this.mongoStorage.isConnected) {
          await this.mongoStorage.updateSession(sessionId, bufferedData)
        } else {
          await this.fileManager.updateSession(sessionId, bufferedData)
        }
      }

      // Always update PostgreSQL
      if (this.postgresStorage.isConnected) {
        this.postgresStorage.updateSession(sessionId, bufferedData)
          .catch(() => {})
      }

      this.writeBuffer.delete(bufferId)
    }, WRITE_BUFFER_FLUSH_INTERVAL)

    this.writeBuffer.get(bufferId).timeout = timeoutId
    return true
  }

  // ==================== DELETE SESSION ====================
  
  async deleteSession(sessionId) {
    logger.info(`🗑️ Deleting session: ${sessionId}`)
    
    this.sessionCache.delete(sessionId)
    this._clearWriteBuffer(sessionId)

    const results = []

    // Delete from all storages
    results.push(this.fileManager.cleanupSessionFiles(sessionId))
    
    if (this.mongoStorage.isConnected) {
      results.push(this.mongoStorage.deleteSession(sessionId))
    }
    
    if (this.postgresStorage.isConnected) {
      results.push(this.postgresStorage.deleteSession(sessionId))
    }

    await Promise.allSettled(results)
    return true
  }

  async deleteSessionKeepUser(sessionId) {
    logger.info(`🗑️ Deleting session (keeping user record): ${sessionId}`)
    
    this.sessionCache.delete(sessionId)
    this._clearWriteBuffer(sessionId)

    const results = {
      fileDeleted: false,
      mongoDeleted: false,
      postgresUpdated: false,
    }

    // Delete from file and MongoDB
    results.fileDeleted = await this.fileManager.cleanupSessionFiles(sessionId)
    
    if (this.mongoStorage.isConnected) {
      results.mongoDeleted = await this.mongoStorage.deleteSession(sessionId)
    }

    // Keep PostgreSQL record for web users
    if (this.postgresStorage.isConnected) {
      const pgResult = await this.postgresStorage.deleteSessionKeepUser(sessionId)
      results.postgresUpdated = pgResult.updated
    }

    return results.fileDeleted || results.mongoDeleted || results.postgresUpdated
  }

  async completelyDeleteSession(sessionId) {
    logger.info(`🗑️ COMPLETE deletion: ${sessionId} (MongoDB + Files, PostgreSQL preserved for web users)`)
    
    this.sessionCache.delete(sessionId)
    this._clearWriteBuffer(sessionId)

    // Get session to check if it's a web user
    const session = await this.getSession(sessionId)
    const isWebUser = session?.source === 'web'

    const results = []

    // Delete files (includes auth)
    results.push(this.fileManager.cleanupSessionFiles(sessionId))
    
    // Delete from MongoDB (metadata + auth)
    if (this.mongoStorage.isConnected) {
      results.push(this.mongoStorage.completeCleanup(sessionId))
    }
    
    // Handle PostgreSQL based on user type
    if (this.postgresStorage.isConnected) {
      if (isWebUser) {
        // 🔴 WEB USERS: NEVER DELETE - only update to disconnected
        results.push(
          this.postgresStorage.updateSession(sessionId, {
            isConnected: false,
            connectionStatus: 'disconnected',
            updatedAt: new Date()
          })
        )
        logger.info(`Web user ${sessionId} PostgreSQL record preserved`)
      } else {
        // Telegram users: Complete deletion
        results.push(this.postgresStorage.completelyDeleteSession(sessionId))
        logger.info(`Telegram user ${sessionId} deleted from PostgreSQL`)
      }
    }

    await Promise.allSettled(results)
    
    logger.info(`✅ Complete deletion finished: ${sessionId}`)
    return true
  }

  // ==================== GET ALL SESSIONS ====================
  
  async getAllSessions() {
    let sessions = []

    // Always check PostgreSQL first (most reliable)
    if (this.postgresStorage.isConnected) {
      sessions = await this.postgresStorage.getAllSessions()
      if (sessions.length > 0) {
        return sessions.map(s => this._formatSessionData(s))
      }
    }

    // Then check based on mode
    if (this.storageMode === 'file') {
      sessions = await this.fileManager.getAllSessions()
      
      // Also get web sessions from MongoDB
      if (this.mongoStorage.isConnected) {
        const webSessions = await this.mongoStorage.getAllSessions()
        const webOnly = webSessions.filter(s => s.source === 'web')
        
        // Merge, avoiding duplicates
        const fileSessionIds = new Set(sessions.map(s => s.sessionId))
        for (const webSession of webOnly) {
          if (!fileSessionIds.has(webSession.sessionId)) {
            sessions.push(webSession)
          }
        }
      }
    } else if (this.mongoStorage.isConnected) {
      sessions = await this.mongoStorage.getAllSessions()
    } else {
      sessions = await this.fileManager.getAllSessions()
    }

    return sessions.map(s => this._formatSessionData(s))
  }

  // ==================== WEB SESSION DETECTION ====================
  
  async getUndetectedWebSessions() {
    // Web detection ALWAYS uses MongoDB
    if (!this.mongoStorage.isConnected) {
      logger.debug('MongoDB not connected - cannot get undetected web sessions')
      return []
    }

    const sessions = await this.mongoStorage.getUndetectedWebSessions()
    return sessions.map(s => this._formatSessionData(s))
  }

  async markSessionAsDetected(sessionId, detected = true) {
    logger.info(`${detected ? '✅' : '❌'} Marking session as detected=${detected}: ${sessionId}`)
    
    const updateData = {
      detected,
      detectedAt: detected ? new Date() : null,
    }

    // Update in BOTH MongoDB (for detection) and file/primary storage
    const promises = []
    
    if (this.mongoStorage.isConnected) {
      promises.push(this.mongoStorage.updateSession(sessionId, updateData))
    }
    
    if (this.storageMode === 'file') {
      promises.push(this.fileManager.updateSession(sessionId, updateData))
    }

    await Promise.allSettled(promises)
    
    // Update cache
    if (this.sessionCache.has(sessionId)) {
      const cached = this.sessionCache.get(sessionId)
      Object.assign(cached, updateData)
    }

    return true
  }

  // ==================== ORPHAN CLEANUP ====================
  
  async cleanupOrphanedSessions() {
    if (this.storageMode === 'file') {
      return await this._cleanupFileOrphans()
    } else {
      return await this._cleanupMongoOrphans()
    }
  }

  async _cleanupFileOrphans() {
    logger.info("🧹 Starting file orphan cleanup...")
    
    const fileSessions = await this.fileManager.getAllSessions()
    let cleaned = 0

    for (const session of fileSessions) {
      const sessionId = session.sessionId
      const age = Date.now() - new Date(session.createdAt || session.updatedAt).getTime()
      
      if (age < 180000) continue // 3 minute grace period

      const hasAuth = await this.fileManager.hasValidCredentials(sessionId)
      
      if (!hasAuth) {
        logger.warn(`🗑️ Cleaning orphan: ${sessionId}`)
        await this.fileManager.cleanupSessionFiles(sessionId)
        this.sessionCache.delete(sessionId)
        cleaned++
      }
    }

    logger.info(`✅ File orphan cleanup: ${cleaned} cleaned`)
    return { cleaned, errors: 0 }
  }

  async _cleanupMongoOrphans() {
    if (!this.mongoStorage.isConnected) {
      return { cleaned: 0, errors: 0 }
    }

    logger.info("🧹 Starting MongoDB orphan cleanup...")
    
    const orphanedIds = await this.mongoStorage.findOrphanedSessions()
    let cleaned = 0

    for (const sessionId of orphanedIds) {
      try {
        logger.warn(`🗑️ Cleaning orphan: ${sessionId}`)
        
        // Get session to check source
        const session = await this.mongoStorage.getSession(sessionId)
        const isWebUser = session?.source === 'web'
        
        // Complete cleanup from MongoDB + Files
        await this.mongoStorage.completeCleanup(sessionId)
        await this.fileManager.cleanupSessionFiles(sessionId)
        
        // Handle PostgreSQL based on source
        if (this.postgresStorage.isConnected) {
          if (isWebUser) {
            // 🔴 WEB USERS: NEVER DELETE - only update
            await this.postgresStorage.updateSession(sessionId, {
              isConnected: false,
              connectionStatus: 'disconnected',
              updatedAt: new Date()
            })
          } else {
            // Telegram users: Complete deletion
            await this.postgresStorage.completelyDeleteSession(sessionId)
          }
        }
        
        this.sessionCache.delete(sessionId)
        cleaned++
      } catch (error) {
        logger.error(`Failed to cleanup orphan ${sessionId}: ${error.message}`)
      }
    }

    logger.info(`✅ MongoDB orphan cleanup: ${cleaned} cleaned`)
    return { cleaned, errors: 0 }
  }

  // ==================== SYNC DELETED SESSIONS ====================
  
  /**
   * 🆕 Check if session was deleted from MongoDB while server running
   * If yes, cleanup from files too
   */
  async checkAndSyncDeletedSessions() {
    if (!this.mongoStorage.isConnected) return { synced: 0 }

    try {
      const fileSessions = await this.fileManager.getAllSessions()
      let synced = 0

      for (const fileSession of fileSessions) {
        const sessionId = fileSession.sessionId
        
        // Check if exists in MongoDB
        const mongoSession = await this.mongoStorage.getSession(sessionId)
        
        // If not in MongoDB, it was deleted - cleanup files too
        if (!mongoSession) {
          logger.warn(`🔄 Syncing deletion: ${sessionId} (deleted from MongoDB)`)
          
          await this.fileManager.cleanupSessionFiles(sessionId)
          this.sessionCache.delete(sessionId)
          synced++
        }
      }

      if (synced > 0) {
        logger.info(`✅ Synced ${synced} deleted sessions`)
      }

      return { synced }
    } catch (error) {
      logger.error(`Sync deleted sessions failed: ${error.message}`)
      return { synced: 0 }
    }
  }

  // ==================== HELPERS ====================
  
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
      createdAt: sessionData.createdAt,
      updatedAt: sessionData.updatedAt,
    }
  }

  _clearWriteBuffer(sessionId) {
    const bufferId = `${sessionId}_update`
    const buffer = this.writeBuffer.get(bufferId)
    if (buffer?.timeout) {
      clearTimeout(buffer.timeout)
    }
    this.writeBuffer.delete(bufferId)
  }

  _getEncryptionKey() {
    const key = process.env.SESSION_ENCRYPTION_KEY || "default-key-change-in-production"
    return crypto.createHash("sha256").update(key).digest()
  }

  _startHealthCheck() {
    this.healthCheckInterval = setInterval(() => {
      // Passive health check
      const status = {
        mongodb: this.mongoStorage.isConnected,
        postgresql: this.postgresStorage.isConnected,
        mode: this.storageMode,
      }
      logger.debug('Health:', status)
    }, 60000)
  }

  _startOrphanCleanup() {
    this.orphanCleanupInterval = setInterval(async () => {
      await this.cleanupOrphanedSessions().catch(() => {})
      await this.checkAndSyncDeletedSessions().catch(() => {})
    }, 1800000) // Every 30 minutes

    // Initial cleanup after 2 minutes
    setTimeout(async () => {
      await this.cleanupOrphanedSessions().catch(() => {})
      await this.checkAndSyncDeletedSessions().catch(() => {})
    }, 120000)
  }

  _startCacheCleanup() {
    this.cacheCleanupInterval = setInterval(() => {
      const now = Date.now()
      for (const [key, value] of this.sessionCache.entries()) {
        if (value.lastCached && now - value.lastCached > SESSION_CACHE_TTL) {
          this.sessionCache.delete(key)
        }
      }
    }, 15000)
  }

  async flushWriteBuffers() {
    const buffers = Array.from(this.writeBuffer.keys())
    for (const bufferId of buffers) {
      const buffer = this.writeBuffer.get(bufferId)
      if (buffer?.timeout) {
        clearTimeout(buffer.timeout)
      }
      this.writeBuffer.delete(bufferId)
    }
  }

  async close() {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval)
    if (this.orphanCleanupInterval) clearInterval(this.orphanCleanupInterval)
    if (this.cacheCleanupInterval) clearInterval(this.cacheCleanupInterval)

    await this.flushWriteBuffers()
    this.sessionCache.clear()

    await Promise.allSettled([
      this.mongoStorage.close(),
      this.postgresStorage.close()
    ])
  }

  getConnectionStatus() {
    return {
      mode: this.storageMode,
      mongodb: this.mongoStorage.isConnected,
      postgresql: this.postgresStorage.isConnected,
      fileManager: true,
      cacheSize: this.sessionCache.size,
      bufferSize: this.writeBuffer.size,
    }
  }

  getStats() {
    return {
      mode: this.storageMode,
      connections: {
        mongodb: this.mongoStorage.isConnected,
        postgresql: this.postgresStorage.isConnected,
      },
      cache: {
        size: this.sessionCache.size,
        maxSize: SESSION_CACHE_MAX_SIZE,
      },
      writeBuffer: {
        size: this.writeBuffer.size,
      },
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