import { MongoClient } from 'mongodb'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('MONGODB_STORAGE')

/**
 * MongoDBStorage - Pure MongoDB operations
 * NO business logic, only database operations
 */
export class MongoDBStorage {
  constructor() {
    this.client = null
    this.db = null
    this.sessions = null
    this.isConnected = false
    this.retryCount = 0
    this.maxRetries = 4
    this.connectionTimeout = 30000

    this._initConnection()
  }

  /**
   * Initialize MongoDB connection
   * @private
   */
  async _initConnection() {
    try {
      const mongoUrl = process.env.MONGODB_URI || 
        'mongodb://localhost:27017/whatsapp_bot'

      const options = {
        maxPoolSize: 90,
        minPoolSize: 2,
        maxIdleTimeMS: 60000,
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 30000,
        retryWrites: true,
        retryReads: true
      }

      this.client = new MongoClient(mongoUrl, options)

      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('MongoDB connection timeout')), this.connectionTimeout)
        )
      ])

      // Verify connection
      await this.client.db('admin').command({ ping: 1 })

      this.db = this.client.db()
      this.sessions = this.db.collection('sessions')

      await this._createIndexes()

      this.isConnected = true
      this.retryCount = 0

      logger.info('MongoDB connected successfully')

    } catch (error) {
      this.isConnected = false
      logger.error('MongoDB connection failed:', error.message)

      // Retry with exponential backoff
      if (this.retryCount < this.maxRetries) {
        this.retryCount++
        const delay = Math.min(30000, 5000 * Math.pow(2, this.retryCount - 1))
        logger.info(`Retrying MongoDB connection in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`)
        setTimeout(() => this._initConnection(), delay)
      }
    }
  }

  /**
   * Create indexes for sessions collection
   * @private
   */
  async _createIndexes() {
    const indexes = [
      { key: { telegramId: 1 }, name: 'telegramId_1' },
      { key: { phoneNumber: 1 }, name: 'phoneNumber_1' },
      { key: { source: 1, detected: 1 }, name: 'source_detected_1' },
      { key: { isConnected: 1, connectionStatus: 1 }, name: 'connection_status_1' },
      { key: { sessionId: 1 }, unique: true, name: 'sessionId_unique' }
    ]

    for (const indexDef of indexes) {
      try {
        await this.sessions.createIndex(indexDef.key, {
          name: indexDef.name,
          background: true,
          unique: indexDef.unique || false
        })
      } catch (error) {
        // Ignore duplicate index errors
        if (!error.message.includes('already exists')) {
          logger.warn(`Failed to create index ${indexDef.name}:`, error.message)
        }
      }
    }

    logger.debug('MongoDB indexes created')
  }

  /**
   * Save session (PURE operation - no business logic)
   */
  async saveSession(sessionId, sessionData) {
    if (!this.isConnected) return false

    try {
      const document = {
        sessionId,
        telegramId: sessionData.telegramId || sessionData.userId,
        phoneNumber: sessionData.phoneNumber,
        isConnected: sessionData.isConnected !== undefined ? sessionData.isConnected : false,
        connectionStatus: sessionData.connectionStatus || 'disconnected',
        reconnectAttempts: sessionData.reconnectAttempts || 0,
        source: sessionData.source || 'telegram',
        detected: sessionData.detected !== false,
        createdAt: sessionData.createdAt || new Date(),
        updatedAt: new Date()
      }

      await this.sessions.replaceOne(
        { sessionId },
        document,
        { upsert: true }
      )

      return true

    } catch (error) {
      logger.error(`MongoDB save error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Get session (PURE operation)
   */
  async getSession(sessionId) {
    if (!this.isConnected) return null

    try {
      const session = await this.sessions.findOne({ sessionId })
      if (!session) return null

      return {
        sessionId: session.sessionId,
        userId: session.telegramId,
        telegramId: session.telegramId,
        phoneNumber: session.phoneNumber,
        isConnected: session.isConnected,
        connectionStatus: session.connectionStatus,
        reconnectAttempts: session.reconnectAttempts,
        source: session.source || 'telegram',
        detected: session.detected !== false,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      }

    } catch (error) {
      logger.error(`MongoDB get error for ${sessionId}:`, error.message)
      return null
    }
  }

  /**
   * Update session (PURE operation)
   */
  async updateSession(sessionId, updates) {
    if (!this.isConnected) return false

    try {
      const updateDoc = { updatedAt: new Date() }
      const allowedFields = [
        'isConnected', 'connectionStatus', 'phoneNumber',
        'reconnectAttempts', 'source', 'detected'
      ]

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          updateDoc[field] = updates[field]
        }
      }

      const result = await this.sessions.updateOne(
        { sessionId },
        { $set: updateDoc }
      )

      return result.modifiedCount > 0 || result.matchedCount > 0

    } catch (error) {
      logger.error(`MongoDB update error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Delete session (PURE operation)
   */
  async deleteSession(sessionId) {
    if (!this.isConnected) return false

    try {
      const result = await this.sessions.deleteOne({ sessionId })
      return result.deletedCount > 0

    } catch (error) {
      logger.error(`MongoDB delete error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Delete auth state from auth_baileys collection (PURE operation)
   */
  async deleteAuthState(sessionId) {
    if (!this.isConnected) return false

    try {
      const authCollection = this.db.collection('auth_baileys')
      const result = await authCollection.deleteMany({ sessionId })
      logger.info(`Deleted ${result.deletedCount} auth documents for ${sessionId}`)
      return result.deletedCount > 0

    } catch (error) {
      logger.error(`MongoDB auth delete error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Get all sessions (PURE operation)
   */
  async getAllSessions() {
    if (!this.isConnected) return []

    try {
      const sessions = await this.sessions.find({})
        .sort({ updatedAt: -1 })
        .toArray()

      return sessions.map(session => ({
        sessionId: session.sessionId,
        userId: session.telegramId,
        telegramId: session.telegramId,
        phoneNumber: session.phoneNumber,
        isConnected: session.isConnected,
        connectionStatus: session.connectionStatus,
        reconnectAttempts: session.reconnectAttempts,
        source: session.source || 'telegram',
        detected: session.detected !== false,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      }))

    } catch (error) {
      logger.error('MongoDB get all sessions error:', error.message)
      return []
    }
  }

  /**
   * Get undetected web sessions (PURE operation)
   */
  async getUndetectedWebSessions() {
    if (!this.isConnected) return []

    try {
      const sessions = await this.sessions.find({
        source: 'web',
        connectionStatus: 'connected',
        isConnected: true,
        detected: { $ne: true }
      }).sort({ updatedAt: -1 }).toArray()

      return sessions.map(session => ({
        sessionId: session.sessionId,
        userId: session.telegramId,
        telegramId: session.telegramId,
        phoneNumber: session.phoneNumber,
        isConnected: session.isConnected,
        connectionStatus: session.connectionStatus,
        source: session.source,
        detected: session.detected || false
      }))

    } catch (error) {
      logger.error('MongoDB get undetected web sessions error:', error.message)
      return []
    }
  }

  /**
   * Close connection
   */
  async close() {
    try {
      if (this.client && this.isConnected) {
        await this.client.close()
        this.isConnected = false
        logger.info('MongoDB connection closed')
      }
    } catch (error) {
      logger.error('MongoDB close error:', error.message)
    }
  }
}