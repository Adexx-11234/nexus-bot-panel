// ============================================================================
// session-coordinator.js - SIMPLIFIED FILE-FIRST ARCHITECTURE
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
    // Storage mode determines primary storage
    this.storageMode = process.env.STORAGE_MODE || 'mongodb'
    
    // Always initialize all storages
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
      logger.info("📁 FILE MODE: Files primary, MongoDB for web detection only, PostgreSQL always saves")
    } else {
      logger.info("📦 MONGODB MODE: Files → MongoDB migration enabled, PostgreSQL always saves")
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
    logger.info(`💾 Saving session ${sessionId} (mode: ${this.storageMode})`)

    // 1. Always update cache
    if (this.sessionCache.size < SESSION_CACHE_MAX_SIZE) {
      this.sessionCache.set(sessionId, {
        ...sessionData,
        credentials,
        lastCached: Date.now(),
      })
    }

    let saved = false

    // 2. Always save to PostgreSQL (background, non-blocking)
    if (this.postgresStorage.isConnected) {
      this.postgresStorage.saveSession(sessionId, sessionData)
        .catch(err => logger.debug(`PostgreSQL save failed: ${err.message}`))
    }

    // 3. Save based on mode
    if (this.storageMode === 'file') {
      // FILE MODE: Only files (MongoDB only for web detection)
      try {
        saved = await this.fileManager.saveSession(sessionId, sessionData)
        if (saved) {
          logger.info(`✅ Saved to file storage: ${sessionId}`)
        }
      } catch (error) {
        logger.error(`File save failed for ${sessionId}:`, error.message)
      }

      // If web session, also mark in MongoDB for detection
      if (sessionData.source === 'web' && this.mongoStorage.isConnected) {
        this.mongoStorage.saveSession(sessionId, sessionData)
          .catch(err => logger.debug(`MongoDB web detection save failed: ${err.message}`))
      }

    } else {
      // MONGODB MODE: Try MongoDB, fallback to file
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
            logger.info(`✅ Saved to file (MongoDB fallback): ${sessionId}`)
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
      // FILE MODE: Only check files
      sessionData = await this.fileManager.getSession(sessionId)
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

      // Save based on mode
      if (this.storageMode === 'file') {
        await this.fileManager.updateSession(sessionId, bufferedData)
      } else {
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
    this.sessionCache.delete(sessionId)
    this._clearWriteBuffer(sessionId)

    const results = []

    results.push(this.fileManager.cleanupSessionFiles(sessionId))
    
    if (this.mongoStorage.isConnected) {
      results.push(this.mongoStorage.deleteSession(sessionId))
      results.push(this.mongoStorage.deleteAuthState(sessionId))
    }
    
    if (this.postgresStorage.isConnected) {
      results.push(this.postgresStorage.completelyDeleteSession(sessionId))
    }

    await Promise.allSettled(results)
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
      return []
    }

    const sessions = await this.mongoStorage.getUndetectedWebSessions()
    return sessions.map(s => this._formatSessionData(s))
  }

  async markSessionAsDetected(sessionId, detected = true) {
    const updateData = {
      detected,
      detectedAt: detected ? new Date() : null,
    }

    // Mark in MongoDB for web detection
    if (this.mongoStorage.isConnected) {
      await this.mongoStorage.updateSession(sessionId, updateData)
    }

    // Also update in primary storage
    if (this.storageMode === 'file') {
      await this.fileManager.updateSession(sessionId, updateData)
    }

    return true
  }

  // ==================== ORPHAN CLEANUP ====================
  
  async cleanupOrphanedSessions() {
    if (this.storageMode === 'file') {
      // FILE MODE: Only cleanup file orphans
      return await this._cleanupFileOrphans()
    } else {
      // MONGODB MODE: Cleanup MongoDB orphans
      return await this._cleanupMongoOrphans()
    }
  }

  async _cleanupFileOrphans() {
    logger.info("Starting file orphan cleanup...")
    
    const fileSessions = await this.fileManager.getAllSessions()
    let cleaned = 0

    for (const session of fileSessions) {
      const sessionId = session.sessionId
      const age = Date.now() - new Date(session.createdAt || session.updatedAt).getTime()
      
      if (age < 180000) continue // 3 minute grace period

      const hasAuth = await this.fileManager.hasValidCredentials(sessionId)
      
      if (!hasAuth) {
        logger.warn(`Cleaning orphan: ${sessionId}`)
        await this.fileManager.cleanupSessionFiles(sessionId)
        this.sessionCache.delete(sessionId)
        cleaned++
      }
    }

    logger.info(`File orphan cleanup: ${cleaned} cleaned`)
    return { cleaned, errors: 0 }
  }

  async _cleanupMongoOrphans() {
    if (!this.mongoStorage.isConnected) {
      return { cleaned: 0, errors: 0 }
    }

    logger.info("Starting MongoDB orphan cleanup...")
    
    const allSessions = await this.mongoStorage.sessions.find({}).toArray()
    const authCollection = this.mongoStorage.db.collection("auth_baileys")
    let cleaned = 0

    for (const session of allSessions) {
      const sessionId = session.sessionId
      const age = Date.now() - new Date(session.createdAt || session.updatedAt).getTime()
      
      if (age < 180000) continue

      // Check both MongoDB and file auth
      const mongoAuth = await authCollection.findOne({
        sessionId,
        filename: "creds.json"
      })

      const fileAuth = await this.fileManager.hasValidCredentials(sessionId)

      if (!mongoAuth && !fileAuth) {
        logger.warn(`Cleaning orphan: ${sessionId}`)
        
        await this.mongoStorage.deleteSession(sessionId)
        await this.mongoStorage.deleteAuthState(sessionId)
        await this.fileManager.cleanupSessionFiles(sessionId)
        
        if (this.postgresStorage.isConnected) {
          await this.postgresStorage.cleanupOrphanedSession(sessionId, session.source || 'telegram')
        }
        
        this.sessionCache.delete(sessionId)
        cleaned++
      }
    }

    logger.info(`MongoDB orphan cleanup: ${cleaned} cleaned`)
    return { cleaned, errors: 0 }
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
      // Just check connections, no actions needed
    }, 60000)
  }

  _startOrphanCleanup() {
    this.orphanCleanupInterval = setInterval(async () => {
      await this.cleanupOrphanedSessions().catch(() => {})
    }, 1800000) // Every 30 minutes

    // Initial cleanup after 2 minutes
    setTimeout(async () => {
      await this.cleanupOrphanedSessions().catch(() => {})
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