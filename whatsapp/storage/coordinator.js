import crypto from 'crypto'
import { createComponentLogger } from '../../utils/logger.js'
import { MongoDBStorage } from './mongodb.js'
import { PostgreSQLStorage } from './postgres.js'

const logger = createComponentLogger('SESSION_STORAGE')

/**
 * SessionStorage - Coordinates multiple storage backends
 * Provides unified interface for MongoDB, PostgreSQL, and in-memory operations
 */
export class SessionStorage {
  constructor() {
    this.mongoStorage = new MongoDBStorage()
    this.postgresStorage = new PostgreSQLStorage()
    this.sessionCache = new Map()
    this.writeBuffer = new Map()
    this.encryptionKey = this._getEncryptionKey()
    this.healthCheckInterval = null
    
    this._startHealthCheck()
    
    logger.info('Session storage coordinator initialized')
  }

  /**
   * Check if any storage is connected
   */
  get isConnected() {
    return this.mongoStorage.isConnected || this.postgresStorage.isConnected
  }

  /**
   * Check MongoDB connection
   */
  get isMongoConnected() {
    return this.mongoStorage.isConnected
  }

  /**
   * Check PostgreSQL connection
   */
  get isPostgresConnected() {
    return this.postgresStorage.isConnected
  }

  /**
   * Get MongoDB client
   */
  get client() {
    return this.mongoStorage.client
  }

  /**
   * Get MongoDB sessions collection
   */
  get sessions() {
    return this.mongoStorage.sessions
  }

  /**
   * Get PostgreSQL pool
   */
  get postgresPool() {
    return this.postgresStorage.pool
  }

  /**
   * Save session to all available storages
   */
  async saveSession(sessionId, sessionData, credentials = null) {
    try {
      const savePromises = [
        this.mongoStorage.saveSession(sessionId, sessionData, credentials),
        this.postgresStorage.saveSession(sessionId, sessionData)
      ]

      const results = await Promise.allSettled(savePromises)
      const mongoSuccess = results[0].status === 'fulfilled' && results[0].value
      const postgresSuccess = results[1].status === 'fulfilled' && results[1].value
      const overallSuccess = mongoSuccess || postgresSuccess

      if (overallSuccess) {
        // Update cache
        this.sessionCache.set(sessionId, {
          ...sessionData,
          credentials,
          lastCached: Date.now()
        })
      }

      logger.debug(`Session ${sessionId} saved (MongoDB: ${mongoSuccess}, PostgreSQL: ${postgresSuccess})`)
      return overallSuccess

    } catch (error) {
      logger.error(`Error saving session ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Get session from cache or storage
   */
  async getSession(sessionId) {
    try {
      // Check cache first (5 minute TTL)
      const cached = this.sessionCache.get(sessionId)
      if (cached && (Date.now() - cached.lastCached) < 300000) {
        return this._formatSessionData(cached)
      }

      let sessionData = null

      // Try MongoDB first
      if (this.mongoStorage.isConnected) {
        sessionData = await this.mongoStorage.getSession(sessionId)
      }

      // Fallback to PostgreSQL
      if (!sessionData && this.postgresStorage.isConnected) {
        sessionData = await this.postgresStorage.getSession(sessionId)
      }

      if (sessionData) {
        // Update cache
        this.sessionCache.set(sessionId, {
          ...sessionData,
          lastCached: Date.now()
        })
        return this._formatSessionData(sessionData)
      }

      // Clear cache if not found
      this.sessionCache.delete(sessionId)
      return null

    } catch (error) {
      logger.error(`Error retrieving session ${sessionId}:`, error)
      return null
    }
  }

  /**
   * Update session with write buffering
   */
  async updateSession(sessionId, updates) {
    try {
      const bufferId = `${sessionId}_update`

      // Merge with existing buffer if present
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

      // Schedule write with debouncing (300ms)
      const timeoutId = setTimeout(async () => {
        const bufferedData = this.writeBuffer.get(bufferId)?.data
        if (!bufferedData) return

        try {
          bufferedData.updatedAt = new Date()

          const updatePromises = [
            this.mongoStorage.updateSession(sessionId, bufferedData),
            this.postgresStorage.updateSession(sessionId, bufferedData)
          ]

          await Promise.allSettled(updatePromises)

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
      }, 300)

      this.writeBuffer.get(bufferId).timeout = timeoutId
      return true

    } catch (error) {
      logger.error(`Error buffering update for ${sessionId}:`, error)
      return false
    }
  }

/**
 * Delete session auth but keep user record (for web users)
 */
async deleteSessionKeepUser(sessionId) {
  try {
    this.sessionCache.delete(sessionId)
    this._clearWriteBuffer(sessionId)

    const results = {
      mongoSessionDeleted: false,
      authBaileysDeleted: false,
      postgresUpdated: false
    }

    // 1. Delete auth from auth_baileys collection
    results.authBaileysDeleted = await this.mongoStorage.deleteAuthState(sessionId)
    
    // 2. Delete entire session document from MongoDB sessions collection
    //    (this removes any stored credentials, auth state, and session data)
    results.mongoSessionDeleted = await this.mongoStorage.deleteSession(sessionId)

    // 3. Update PostgreSQL - clear connection data but preserve user record
    results.postgresUpdated = await this.postgresStorage.updateSession(sessionId, {
      sessionId: null,
      isConnected: false,
      connectionStatus: 'disconnected',
      phoneNumber: null
    })

    logger.info(`Web user cleanup for ${sessionId}:`, results)
    
    // Return true if any operation succeeded
    return results.authBaileysDeleted || results.mongoSessionDeleted || results.postgresUpdated

  } catch (error) {
    logger.error(`Error in deleteSessionKeepUser for ${sessionId}:`, error)
    return false
  }
}
    
  /**
   * Delete session from all storages
   */
  async deleteSession(sessionId) {
    try {
      this.sessionCache.delete(sessionId)
      this._clearWriteBuffer(sessionId)

      const deletePromises = [
        this.mongoStorage.deleteSession(sessionId),
        this.postgresStorage.deleteSession(sessionId)
      ]

      const results = await Promise.allSettled(deletePromises)
      const mongoSuccess = results[0].status === 'fulfilled' && results[0].value
      const postgresSuccess = results[1].status === 'fulfilled' && results[1].value

      logger.debug(`Session ${sessionId} deleted (MongoDB: ${mongoSuccess}, PostgreSQL: ${postgresSuccess})`)
      return mongoSuccess || postgresSuccess

    } catch (error) {
      logger.error(`Error deleting session ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Completely delete session including auth state
   */
  async completelyDeleteSession(sessionId) {
    try {
      this.sessionCache.delete(sessionId)
      this._clearWriteBuffer(sessionId)

      const deletePromises = [
        this.mongoStorage.completelyDeleteSession(sessionId),
        this.mongoStorage.deleteAuthState(sessionId),
        this.postgresStorage.completelyDeleteSession(sessionId)
      ]

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
   * Get all sessions
   */
  async getAllSessions() {
    try {
      let sessions = []

      // Prefer PostgreSQL for list queries (better performance)
      if (this.postgresStorage.isConnected) {
        sessions = await this.postgresStorage.getAllSessions()
      } else if (this.mongoStorage.isConnected) {
        sessions = await this.mongoStorage.getAllSessions()
      }

      return sessions.map(session => this._formatSessionData(session))

    } catch (error) {
      logger.error('Error retrieving all sessions:', error)
      return []
    }
  }

  /**
   * Get undetected web sessions
   */
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

  /**
   * Mark session as detected (for web sessions)
   */
  async markSessionAsDetected(sessionId, detected = true) {
    try {
      const updateData = {
        detected,
        detectedAt: detected ? new Date() : null
      }

      const updatePromises = [
        this.mongoStorage.updateSession(sessionId, updateData),
        this.postgresStorage.updateSession(sessionId, updateData)
      ]

      const results = await Promise.allSettled(updatePromises)
      return results.some(r => r.status === 'fulfilled' && r.value)

    } catch (error) {
      logger.error(`Error marking ${sessionId} as detected:`, error)
      return false
    }
  }

  /**
   * Format session data to standardized structure
   * @private
   */
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

  /**
   * Clear write buffer for a session
   * @private
   */
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

  /**
   * Get encryption key for sensitive data
   * @private
   */
  _getEncryptionKey() {
    const key = process.env.SESSION_ENCRYPTION_KEY || 'default-key-change-in-production'
    return crypto.createHash('sha256').update(key).digest()
  }

  /**
   * Start health check for storage connections
   * @private
   */
  _startHealthCheck() {
    this.healthCheckInterval = setInterval(async () => {
      // MongoDB health check
      if (this.mongoStorage.isConnected) {
        try {
          await this.mongoStorage.client.db('admin').command({ ping: 1 })
        } catch (error) {
          logger.warn('MongoDB health check failed')
          this.mongoStorage.isConnected = false
        }
      }

      // PostgreSQL health check
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
    }, 60000) // Every minute
  }

  /**
   * Get connection status
   */
  getConnectionStatus() {
    return {
      mongodb: this.mongoStorage.isConnected,
      postgresql: this.postgresStorage.isConnected,
      overall: this.isConnected,
      cacheSize: this.sessionCache.size,
      bufferSize: this.writeBuffer.size
    }
  }

  /**
   * Flush all write buffers immediately
   */
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

          await Promise.allSettled([
            this.mongoStorage.updateSession(sessionId, updates),
            this.postgresStorage.updateSession(sessionId, updates)
          ])

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

  /**
   * Close all storage connections
   */
  async close() {
    try {
      logger.info('Closing session storage...')

      // Stop health check
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval)
        this.healthCheckInterval = null
      }

      // Flush pending writes
      await this.flushWriteBuffers()

      // Clear cache
      this.sessionCache.clear()

      // Close storage connections
      const closePromises = [
        this.mongoStorage.close(),
        this.postgresStorage.close()
      ]

      await Promise.allSettled(closePromises)

      logger.info('Session storage closed')

    } catch (error) {
      logger.error('Storage close error:', error)
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      connections: {
        mongodb: this.mongoStorage.isConnected,
        postgresql: this.postgresStorage.isConnected,
        overall: this.isConnected
      },
      cache: {
        size: this.sessionCache.size,
        entries: Array.from(this.sessionCache.keys())
      },
      writeBuffer: {
        size: this.writeBuffer.size,
        entries: Array.from(this.writeBuffer.keys())
      }
    }
  }
}

// Singleton pattern
let storageInstance = null

/**
 * Initialize storage singleton
 */
export function initializeStorage() {
  if (!storageInstance) {
    storageInstance = new SessionStorage()
  }
  return storageInstance
}

/**
 * Get storage instance
 */
export function getSessionStorage() {
  if (!storageInstance) {
    storageInstance = new SessionStorage()
  }
  return storageInstance
}