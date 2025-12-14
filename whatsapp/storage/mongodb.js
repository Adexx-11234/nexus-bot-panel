import { MongoClient } from "mongodb"
import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("MONGODB_STORAGE")

/**
 * MongoDBStorage - Pure MongoDB operations with robust auto-reconnection
 * Handles connection drops gracefully without disrupting active sessions
 */
export class MongoDBStorage {
  constructor() {
    this.client = null
    this.db = null
    this.sessions = null
    this.isConnected = false
    this.retryCount = 0
    this.maxRetries = Infinity // Never give up retrying
    this.connectionTimeout = 30000
    this.reconnectInterval = null
    this.healthCheckInterval = null
    this.isReconnecting = false
    this.lastSuccessfulConnection = null
    this.connectionAttempts = 0

    this._initConnection()
    this._startHealthCheck()
  }

  /**
   * Initialize MongoDB connection with auto-reconnect
   * @private
   */
  async _initConnection() {
    // Prevent multiple simultaneous reconnection attempts
    if (this.isReconnecting) {
      logger.debug("Reconnection already in progress, skipping...")
      return
    }

    this.isReconnecting = true
    this.connectionAttempts++

    try {
      const mongoUrl = process.env.MONGODB_URI || "mongodb://localhost:27017/whatsapp_bot"

      const options = {
        maxPoolSize: 90,
        minPoolSize: 5, // Keep minimum connections alive
        maxIdleTimeMS: 300000, // 5 minutes idle before closing
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 300000, // 5 minutes socket timeout
        connectTimeoutMS: 30000,
        retryWrites: true,
        retryReads: true,
        heartbeatFrequencyMS: 10000 // Ping every 10 seconds
      }

      // Close existing connection if any
      if (this.client) {
        try {
          await this.client.close()
        } catch (err) {
          logger.debug("Error closing old client:", err.message)
        }
      }

      this.client = new MongoClient(mongoUrl, options)

      // Connect with timeout
      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("MongoDB connection timeout")), this.connectionTimeout),
        ),
      ])

      // Verify connection with ping
      await this.client.db("admin").command({ ping: 1 })

      this.db = this.client.db()
      this.sessions = this.db.collection("sessions")

      await this._createIndexes()

      // Setup connection event listeners
      this._setupConnectionEvents()

      this.isConnected = true
      this.retryCount = 0
      this.lastSuccessfulConnection = new Date()
      this.isReconnecting = false

      if (this.connectionAttempts > 1) {
        logger.info(`🔄 MongoDB reconnected successfully (attempt ${this.connectionAttempts})`)
      } else {
        logger.info("✅ MongoDB connected successfully")
      }

      // Clear any pending reconnection interval
      if (this.reconnectInterval) {
        clearInterval(this.reconnectInterval)
        this.reconnectInterval = null
      }

    } catch (error) {
      this.isConnected = false
      this.isReconnecting = false
      
      const logLevel = this.connectionAttempts <= 3 ? 'error' : 'warn'
      logger[logLevel](`MongoDB connection failed (attempt ${this.connectionAttempts}):`, error.message)

      // Schedule reconnection with exponential backoff (max 30 seconds)
      this._scheduleReconnection()
    }
  }

  /**
   * Setup MongoDB connection event listeners
   * @private
   */
  _setupConnectionEvents() {
    if (!this.client) return

    // Connection closed
    this.client.on('close', () => {
      logger.warn("⚠️ MongoDB connection closed")
      this.isConnected = false
      this._scheduleReconnection()
    })

    // Connection error
    this.client.on('error', (error) => {
      logger.error("❌ MongoDB connection error:", error.message)
      this.isConnected = false
      this._scheduleReconnection()
    })

    // Timeout
    this.client.on('timeout', () => {
      logger.warn("⏱️ MongoDB connection timeout")
      this.isConnected = false
      this._scheduleReconnection()
    })

    // Reconnected
    this.client.on('reconnect', () => {
      logger.info("🔄 MongoDB automatically reconnected")
      this.isConnected = true
    })
  }

  /**
   * Schedule reconnection with exponential backoff
   * @private
   */
  _scheduleReconnection() {
    // Don't schedule if already scheduled
    if (this.reconnectInterval) return

    // Calculate backoff delay (5s, 10s, 20s, max 30s)
    const delay = Math.min(30000, 5000 * Math.pow(2, Math.min(this.retryCount, 3)))
    this.retryCount++

    logger.info(`🔄 Scheduling MongoDB reconnection in ${delay / 1000}s (attempt ${this.retryCount})`)

    this.reconnectInterval = setInterval(() => {
      if (!this.isConnected && !this.isReconnecting) {
        this._initConnection()
      }
    }, delay)
  }

  /**
   * Start health check to detect stale connections
   * @private
   */
  _startHealthCheck() {
    this.healthCheckInterval = setInterval(async () => {
      // Skip if reconnecting
      if (this.isReconnecting) return

      if (this.isConnected && this.client) {
        try {
          // Ping to verify connection is alive
          await this.client.db("admin").command({ ping: 1 })
          
          // Connection is healthy
          if (this.retryCount > 0) {
            logger.debug("MongoDB health check passed")
            this.retryCount = 0
          }
        } catch (error) {
          logger.warn("⚠️ MongoDB health check failed:", error.message)
          this.isConnected = false
          this._scheduleReconnection()
        }
      } else if (!this.isConnected && !this.reconnectInterval) {
        // Not connected and no reconnection scheduled - try now
        this._scheduleReconnection()
      }
    }, 30000) // Every 30 seconds
  }

  /**
   * Create indexes for sessions collection
   * @private
   */
  async _createIndexes() {
    const indexes = [
      { key: { telegramId: 1 }, name: "telegramId_1" },
      { key: { phoneNumber: 1 }, name: "phoneNumber_1" },
      { key: { source: 1, detected: 1 }, name: "source_detected_1" },
      { key: { isConnected: 1, connectionStatus: 1 }, name: "connection_status_1" },
      { key: { sessionId: 1 }, unique: true, name: "sessionId_unique" },
      { key: { phoneNumber: 1, sessionId: 1 }, name: "phoneNumber_sessionId_1" },
    ]

    for (const indexDef of indexes) {
      try {
        await this.sessions.createIndex(indexDef.key, {
          name: indexDef.name,
          background: true,
          unique: indexDef.unique || false,
        })
      } catch (error) {
        // Ignore duplicate index errors
        if (!error.message.includes("already exists")) {
          logger.warn(`Failed to create index ${indexDef.name}:`, error.message)
        }
      }
    }

    logger.debug("MongoDB indexes verified")
  }

  /**
   * Execute operation with automatic reconnection
   * @private
   */
  async _executeWithReconnect(operation, operationName) {
    if (!this.isConnected) {
      // Try to reconnect immediately if not already reconnecting
      if (!this.isReconnecting && !this.reconnectInterval) {
        this._scheduleReconnection()
      }
      logger.debug(`${operationName}: MongoDB not connected, operation skipped`)
      return null
    }

    try {
      return await operation()
    } catch (error) {
      // Check if it's a connection error
      if (this._isConnectionError(error)) {
        logger.warn(`${operationName}: Connection error, triggering reconnection`)
        this.isConnected = false
        this._scheduleReconnection()
      } else {
        logger.error(`${operationName}: Operation error:`, error.message)
      }
      return null
    }
  }

  /**
   * Check if error is a connection-related error
   * @private
   */
  _isConnectionError(error) {
    const connectionErrors = [
      'connection',
      'disconnected',
      'topology',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'pool destroyed',
      'server selection',
      'MongoNetworkError',
      'MongoServerSelectionError'
    ]
    
    const errorMessage = error.message?.toLowerCase() || ''
    return connectionErrors.some(msg => errorMessage.includes(msg.toLowerCase()))
  }

  /**
   * Save session (PURE operation with auto-reconnect)
   */
  async saveSession(sessionId, sessionData) {
    return await this._executeWithReconnect(async () => {
      const document = {
        sessionId,
        telegramId: sessionData.telegramId || sessionData.userId,
        phoneNumber: sessionData.phoneNumber,
        isConnected: sessionData.isConnected !== undefined ? sessionData.isConnected : false,
        connectionStatus: sessionData.connectionStatus || "disconnected",
        reconnectAttempts: sessionData.reconnectAttempts || 0,
        source: sessionData.source || "telegram",
        detected: sessionData.detected !== false,
        createdAt: sessionData.createdAt || new Date(),
        updatedAt: new Date(),
      }

      await this.sessions.replaceOne({ sessionId }, document, { upsert: true })
      return true
    }, `saveSession(${sessionId})`) || false
  }

  /**
   * Get session (PURE operation with auto-reconnect)
   */
  async getSession(sessionId) {
    return await this._executeWithReconnect(async () => {
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
        source: session.source || "telegram",
        detected: session.detected !== false,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      }
    }, `getSession(${sessionId})`)
  }

  /**
   * Update session (PURE operation with auto-reconnect)
   */
  async updateSession(sessionId, updates) {
    return await this._executeWithReconnect(async () => {
      const updateDoc = { updatedAt: new Date() }
      const allowedFields = [
        "isConnected",
        "connectionStatus",
        "phoneNumber",
        "reconnectAttempts",
        "source",
        "detected",
      ]

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          updateDoc[field] = updates[field]
        }
      }

      const result = await this.sessions.updateOne({ sessionId }, { $set: updateDoc })
      return result.modifiedCount > 0 || result.matchedCount > 0
    }, `updateSession(${sessionId})`) || false
  }

  /**
   * Delete session (PURE operation with auto-reconnect)
   */
  async deleteSession(sessionId) {
    return await this._executeWithReconnect(async () => {
      const result = await this.sessions.deleteOne({ sessionId })
      return result.deletedCount > 0
    }, `deleteSession(${sessionId})`) || false
  }

  /**
   * Delete auth state from auth_baileys collection (PURE operation with auto-reconnect)
   */
  async deleteAuthState(sessionId) {
    return await this._executeWithReconnect(async () => {
      const authCollection = this.db.collection("auth_baileys")
      const result = await authCollection.deleteMany({ sessionId })
      logger.info(`Deleted ${result.deletedCount} auth documents for ${sessionId}`)
      return result.deletedCount > 0
    }, `deleteAuthState(${sessionId})`) || false
  }

  /**
   * Get all sessions (PURE operation with auto-reconnect)
   */
  async getAllSessions() {
    const result = await this._executeWithReconnect(async () => {
      const sessions = await this.sessions.find({}).sort({ updatedAt: -1 }).toArray()

      return sessions.map((session) => ({
        sessionId: session.sessionId,
        userId: session.telegramId,
        telegramId: session.telegramId,
        phoneNumber: session.phoneNumber,
        isConnected: session.isConnected,
        connectionStatus: session.connectionStatus,
        reconnectAttempts: session.reconnectAttempts,
        source: session.source || "telegram",
        detected: session.detected !== false,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      }))
    }, 'getAllSessions()')

    return result || []
  }

  /**
   * Get undetected web sessions (PURE operation with auto-reconnect)
   */
  async getUndetectedWebSessions() {
    const result = await this._executeWithReconnect(async () => {
      const sessions = await this.sessions
        .find({
          source: "web",
          connectionStatus: "connected",
          isConnected: true,
          detected: { $ne: true },
        })
        .sort({ updatedAt: -1 })
        .toArray()

      return sessions.map((session) => ({
        sessionId: session.sessionId,
        userId: session.telegramId,
        telegramId: session.telegramId,
        phoneNumber: session.phoneNumber,
        isConnected: session.isConnected,
        connectionStatus: session.connectionStatus,
        source: session.source,
        detected: session.detected || false,
      }))
    }, 'getUndetectedWebSessions()')

    return result || []
  }

  /**
   * Get connection status
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      isReconnecting: this.isReconnecting,
      lastSuccessfulConnection: this.lastSuccessfulConnection,
      connectionAttempts: this.connectionAttempts,
      retryCount: this.retryCount,
    }
  }

  /**
   * Close connection
   */
  async close() {
    try {
      // Clear intervals
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval)
        this.healthCheckInterval = null
      }

      if (this.reconnectInterval) {
        clearInterval(this.reconnectInterval)
        this.reconnectInterval = null
      }

      // Close client
      if (this.client && this.isConnected) {
        await this.client.close()
        this.isConnected = false
        logger.info("MongoDB connection closed gracefully")
      }
    } catch (error) {
      logger.error("MongoDB close error:", error.message)
    }
  }
}