import crypto from 'crypto'
import { createComponentLogger } from '../../utils/logger.js'
import { MongoDBStorage } from './mongodb.js'
import { PostgreSQLStorage } from './postgres.js'
import { FileManager } from './file.js'

const logger = createComponentLogger('SESSION_STORAGE')

// CRITICAL: Reduced cache sizes and TTL
const SESSION_CACHE_MAX_SIZE = 500 // Supports 500 users
const SESSION_CACHE_TTL = 120000 // 2 minutes TTL
const WRITE_BUFFER_FLUSH_INTERVAL = 500 // Faster flush

/**
 * SessionStorage - Pure Coordinator
 * NO database code, only orchestration + fallback logic
 */
export class SessionStorage {
  constructor() {
    this.mongoStorage = new MongoDBStorage()
    this.postgresStorage = new PostgreSQLStorage()
    this.fileManager = new FileManager()
    
    // CRITICAL: Limited cache
    this.sessionCache = new Map()
    this.writeBuffer = new Map()
    
    this.encryptionKey = this._getEncryptionKey()
    this.healthCheckInterval = null
    this.orphanCleanupInterval = null
    this.cacheCleanupInterval = null
    
    this._startHealthCheck()
    this._startOrphanCleanup()
    this._startAggressiveCacheCleanup()
    
    logger.info('Session storage coordinator initialized')
  }

  get isConnected() {
    return this.mongoStorage.isConnected || 
           this.postgresStorage.isConnected || 
           this.fileManager !== null
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
   * CRITICAL: Aggressive cache cleanup every 30 seconds
   */
  _startAggressiveCacheCleanup() {
    this.cacheCleanupInterval = setInterval(() => {
      this._cleanupStaleCache()
    }, 30000) // Every 30 seconds
  }

  /**
   * CRITICAL: Remove stale cache entries
   */
_cleanupStaleCache() {
  const now = Date.now()
  let removed = 0

  try {
    // Clean session cache - ONLY if expired by TTL
    for (const [key, value] of this.sessionCache.entries()) {
      // Only check TTL - if expired, remove
      if (value.lastCached && (now - value.lastCached > SESSION_CACHE_TTL)) {
        this.sessionCache.delete(key)
        removed++
      }
    }

    // Enforce max size (remove oldest entries ONLY if over limit)
    if (this.sessionCache.size > SESSION_CACHE_MAX_SIZE) {
      const entries = Array.from(this.sessionCache.entries())
        .sort((a, b) => a[1].lastCached - b[1].lastCached)
      
      const toRemove = entries.slice(0, this.sessionCache.size - SESSION_CACHE_MAX_SIZE)
      toRemove.forEach(([key]) => {
        this.sessionCache.delete(key)
        removed++
      })
    }

    if (removed > 0) {
      logger.debug(`Cleaned ${removed} stale cache entries (size: ${this.sessionCache.size}/${SESSION_CACHE_MAX_SIZE})`)
    }

  } catch (error) {
    // If cleanup itself errors, just log - DON'T delete anything
    logger.error('Cache cleanup error (entries preserved):', error.message)
  }
}

  /**
   * Save session with fallback chain: MongoDB → PostgreSQL → File
   */
  async saveSession(sessionId, sessionData, credentials = null) {
    try {
      let saved = false

      // Try MongoDB first
      if (this.mongoStorage.isConnected) {
        saved = await this.mongoStorage.saveSession(sessionId, sessionData)
      }

      // Try PostgreSQL
      if (this.postgresStorage.isConnected) {
        const pgSaved = await this.postgresStorage.saveSession(sessionId, sessionData)
        saved = saved || pgSaved
      }

      // FALLBACK: Use file storage if both DBs failed
      if (!saved) {
        logger.warn(`DB unavailable for ${sessionId}, using file fallback`)
        saved = await this.fileManager.saveSession(sessionId, sessionData)
      }

      // CRITICAL: Only cache if saved successfully + enforce max size
      if (saved) {
        if (this.sessionCache.size >= SESSION_CACHE_MAX_SIZE) {
          // Remove oldest entry
          const oldestKey = Array.from(this.sessionCache.entries())
            .sort((a, b) => a[1].lastCached - b[1].lastCached)[0][0]
          this.sessionCache.delete(oldestKey)
        }

        this.sessionCache.set(sessionId, {
          ...sessionData,
          credentials,
          lastCached: Date.now()
        })
      }

      return saved

    } catch (error) {
      logger.error(`Error saving session ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Get session with fallback chain + cache
   */
  async getSession(sessionId) {
    try {
      // Check cache (with TTL)
      const cached = this.sessionCache.get(sessionId)
      if (cached && (Date.now() - cached.lastCached) < SESSION_CACHE_TTL) {
        return this._formatSessionData(cached)
      }

      let sessionData = null

      // Try MongoDB
      if (this.mongoStorage.isConnected) {
        sessionData = await this.mongoStorage.getSession(sessionId)
      }

      // Try PostgreSQL
      if (!sessionData && this.postgresStorage.isConnected) {
        sessionData = await this.postgresStorage.getSession(sessionId)
      }

      // FALLBACK: Try file storage
      if (!sessionData) {
        sessionData = await this.fileManager.getSession(sessionId)
      }

      // CRITICAL: Cache only if found + enforce max size
      if (sessionData) {
        if (this.sessionCache.size >= SESSION_CACHE_MAX_SIZE) {
          const oldestKey = Array.from(this.sessionCache.entries())
            .sort((a, b) => a[1].lastCached - b[1].lastCached)[0][0]
          this.sessionCache.delete(oldestKey)
        }

        this.sessionCache.set(sessionId, {
          ...sessionData,
          lastCached: Date.now()
        })
        return this._formatSessionData(sessionData)
      }

      this.sessionCache.delete(sessionId)
      return null

    } catch (error) {
      logger.error(`Error retrieving session ${sessionId}:`, error)
      return null
    }
  }

  /**
   * Update session with write buffering (faster flush)
   */
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
          timeout: null
        })
      }

      const timeoutId = setTimeout(async () => {
        const bufferedData = this.writeBuffer.get(bufferId)?.data
        if (!bufferedData) return

        try {
          bufferedData.updatedAt = new Date()

          // Try MongoDB
          let updated = false
          if (this.mongoStorage.isConnected) {
            updated = await this.mongoStorage.updateSession(sessionId, bufferedData)
          }

          // Try PostgreSQL
          if (this.postgresStorage.isConnected) {
            const pgUpdated = await this.postgresStorage.updateSession(sessionId, bufferedData)
            updated = updated || pgUpdated
          }

          // FALLBACK: Use file storage
          if (!updated) {
            await this.fileManager.updateSession(sessionId, bufferedData)
          }

          // Update cache
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

  /**
   * Delete session but keep user (web users)
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
        hadWebAuth: false
      }

      // Delete from MongoDB
      if (this.mongoStorage.isConnected) {
        results.authBaileysDeleted = await this.mongoStorage.deleteAuthState(sessionId)
        results.mongoSessionDeleted = await this.mongoStorage.deleteSession(sessionId)
      }

      // Delete file-based auth
      results.fileDeleted = await this.fileManager.cleanupSessionFiles(sessionId)

      // Handle PostgreSQL
      if (this.postgresStorage.isConnected) {
        const pgResult = await this.postgresStorage.deleteSessionKeepUser(sessionId)
        results.postgresUpdated = pgResult.updated
        results.postgresDeleted = pgResult.deleted
        results.hadWebAuth = pgResult.hadWebAuth
      }

      logger.info(`Logout cleanup for ${sessionId}:`, results)
      
      return results.authBaileysDeleted || results.mongoSessionDeleted || 
             results.postgresUpdated || results.postgresDeleted

    } catch (error) {
      logger.error(`Error in deleteSessionKeepUser for ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Delete session (soft delete)
   */
  async deleteSession(sessionId) {
    try {
      this.sessionCache.delete(sessionId)
      this._clearWriteBuffer(sessionId)

      let deleted = false

      if (this.mongoStorage.isConnected) {
        deleted = await this.mongoStorage.deleteSession(sessionId)
      }

      if (this.postgresStorage.isConnected) {
        const pgDeleted = await this.postgresStorage.deleteSession(sessionId)
        deleted = deleted || pgDeleted
      }

      // Also delete from file storage
      await this.fileManager.cleanupSessionFiles(sessionId)

      return deleted

    } catch (error) {
      logger.error(`Error deleting session ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Completely delete session (hard delete)
   */
  async completelyDeleteSession(sessionId) {
    try {
      this.sessionCache.delete(sessionId)
      this._clearWriteBuffer(sessionId)

      const deletePromises = []

      if (this.mongoStorage.isConnected) {
        deletePromises.push(this.mongoStorage.deleteSession(sessionId))
        deletePromises.push(this.mongoStorage.deleteAuthState(sessionId))
      }

      if (this.postgresStorage.isConnected) {
        deletePromises.push(this.postgresStorage.completelyDeleteSession(sessionId))
      }

      deletePromises.push(this.fileManager.cleanupSessionFiles(sessionId))

      const results = await Promise.allSettled(deletePromises)
      const success = results.some(r => r.status === 'fulfilled' && r.value)

      logger.info(`Complete deletion for ${sessionId}: ${success}`)
      return success

    } catch (error) {
      logger.error(`Error completely deleting session ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Cleanup orphaned sessions
   */
  async cleanupOrphanedSessions() {
    if (!this.mongoStorage.isConnected) {
      logger.warn('MongoDB not connected - skipping orphan cleanup')
      return { cleaned: 0, errors: 0 }
    }

    try {
      logger.info('Starting orphaned sessions cleanup...')

      const allSessions = await this.mongoStorage.sessions.find({}).toArray()
      
      if (allSessions.length === 0) {
        return { cleaned: 0, errors: 0 }
      }

      const authCollection = this.mongoStorage.db.collection('auth_baileys')
      let cleanedCount = 0
      let errorCount = 0

      for (const session of allSessions) {
        try {
          const sessionId = session.sessionId
          
          const credsExists = await authCollection.findOne({
            sessionId: sessionId,
            filename: 'creds.json'
          })

          if (!credsExists) {
            logger.warn(`Session ${sessionId} has no auth - cleaning up`)

            // Delete from MongoDB
            if (this.mongoStorage.isConnected) {
              await this.mongoStorage.deleteSession(sessionId)
            }
            
            // Delete files
            await this.fileManager.cleanupSessionFiles(sessionId)
            
            // Handle PostgreSQL
            if (this.postgresStorage.isConnected) {
              const source = session.source || 'telegram'
              await this.postgresStorage.cleanupOrphanedSession(sessionId, source)
            }

            // Clear cache
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
      logger.error('Orphaned sessions cleanup failed:', error)
      return { cleaned: 0, errors: 1 }
    }
  }

  /**
   * Get all sessions with fallback chain
   */
  async getAllSessions() {
    try {
      let sessions = []

      if (this.postgresStorage.isConnected) {
        sessions = await this.postgresStorage.getAllSessions()
      } else if (this.mongoStorage.isConnected) {
        sessions = await this.mongoStorage.getAllSessions()
      } else {
        // FALLBACK: Get from files
        sessions = await this.fileManager.getAllSessions()
      }

      return sessions.map(session => this._formatSessionData(session))

    } catch (error) {
      logger.error('Error retrieving all sessions:', error)
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

      return sessions.map(session => this._formatSessionData(session))

    } catch (error) {
      logger.error('Error getting undetected web sessions:', error)
      return []
    }
  }

  async markSessionAsDetected(sessionId, detected = true) {
    try {
      const updateData = {
        detected,
        detectedAt: detected ? new Date() : null
      }

      let updated = false

      if (this.mongoStorage.isConnected) {
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
      connectionStatus: sessionData.connectionStatus || 'disconnected',
      reconnectAttempts: sessionData.reconnectAttempts || 0,
      source: sessionData.source || 'telegram',
      detected: sessionData.detected !== false,
      detectedAt: sessionData.detectedAt,
      credentials: sessionData.credentials || null,
      authState: sessionData.authState || null,
      createdAt: sessionData.createdAt,
      updatedAt: sessionData.updatedAt
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
    const key = process.env.SESSION_ENCRYPTION_KEY || 'default-key-change-in-production'
    return crypto.createHash('sha256').update(key).digest()
  }

  _startHealthCheck() {
    this.healthCheckInterval = setInterval(async () => {
      if (this.mongoStorage.isConnected) {
        try {
          await this.mongoStorage.client.db('admin').command({ ping: 1 })
        } catch (error) {
          logger.warn('MongoDB health check failed')
          this.mongoStorage.isConnected = false
        }
      }

      if (this.postgresStorage.isConnected) {
        try {
          const client = await this.postgresStorage.pool.connect()
          await client.query('SELECT 1')
          client.release()
        } catch (error) {
          logger.warn('PostgreSQL health check failed')
          this.postgresStorage.isConnected = false
        }
      }
    }, 60000)
  }

  _startOrphanCleanup() {
    this.orphanCleanupInterval = setInterval(async () => {
      await this.cleanupOrphanedSessions().catch(error => {
        logger.error('Periodic orphan cleanup error:', error)
      })
    }, 1800000)

    setTimeout(async () => {
      await this.cleanupOrphanedSessions().catch(error => {
        logger.error('Initial orphan cleanup error:', error)
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
      bufferSize: this.writeBuffer.size
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

      const sessionId = bufferId.replace('_update', '')

      const flushPromise = (async () => {
        try {
          const updates = { ...bufferData.data, updatedAt: new Date() }

          if (this.mongoStorage.isConnected) {
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
      logger.info('Closing session storage...')

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

      await Promise.allSettled([
        this.mongoStorage.close(),
        this.postgresStorage.close()
      ])

      logger.info('Session storage closed')

    } catch (error) {
      logger.error('Storage close error:', error)
    }
  }

  getStats() {
    return {
      connections: {
        mongodb: this.mongoStorage.isConnected,
        postgresql: this.postgresStorage.isConnected,
        fileManager: this.fileManager !== null,
        overall: this.isConnected
      },
      cache: {
        size: this.sessionCache.size,
        maxSize: SESSION_CACHE_MAX_SIZE,
        ttl: SESSION_CACHE_TTL,
        entries: Array.from(this.sessionCache.keys()).slice(0, 10)
      },
      writeBuffer: {
        size: this.writeBuffer.size,
        entries: Array.from(this.writeBuffer.keys()).slice(0, 10)
      },
      fileManager: this.fileManager.getStats()
    }
  }
}

// Singleton
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