// ============================================================================
// mongodb.js - SIMPLIFIED FOR WEB DETECTION ONLY IN FILE MODE
// ============================================================================

import { MongoClient } from "mongodb"
import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("MONGODB_STORAGE")

const CONFIG = {
  RECONNECT_DELAY: 5000,
  HEALTH_CHECK_INTERVAL: 30000,
  CONNECTION_TIMEOUT: 30000,
  SOCKET_TIMEOUT: 45000,
  MAX_RECONNECT_ATTEMPTS: 5,
  OPERATION_TIMEOUT: 10000,
}

export class MongoDBStorage {
  constructor() {
    this.client = null
    this.db = null
    this.sessions = null
    this.authBaileys = null
    this.isConnected = false
    this.isConnecting = false
    this.reconnectTimer = null
    this.healthCheckTimer = null
    this.reconnectAttempts = 0
    this.shutdownRequested = false

    const storageMode = process.env.STORAGE_MODE || 'mongodb'
    
    // Always try to connect
    this._initConnection()
    this._startHealthCheck()
    
    if (storageMode === 'mongodb') {
      logger.info('📦 MongoDB PRIMARY - handles metadata + auth')
    } else {
      logger.info('📁 MongoDB SECONDARY - web detection only')
    }
  }

  // ==================== CONNECTION ====================
  
  async _initConnection() {
    if (this.isConnecting || this.shutdownRequested) return
    this.isConnecting = true

    try {
      const mongoUrl = process.env.MONGODB_URI || "mongodb://localhost:27017/whatsapp_bot"

      logger.info(`Connecting to MongoDB (attempt ${this.reconnectAttempts + 1}/${CONFIG.MAX_RECONNECT_ATTEMPTS})...`)

      if (this.client) {
        try {
          await this.client.close(true)
        } catch (e) {}
      }

      this.client = new MongoClient(mongoUrl, {
        maxPoolSize: 50,
        minPoolSize: 5,
        serverSelectionTimeoutMS: CONFIG.CONNECTION_TIMEOUT,
        socketTimeoutMS: CONFIG.SOCKET_TIMEOUT,
      })

      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), CONFIG.CONNECTION_TIMEOUT)
        ),
      ])

      await this.client.db('admin').command({ ping: 1 })

      this.db = this.client.db()
      this.sessions = this.db.collection('sessions')
      this.authBaileys = this.db.collection('auth_baileys')

      await this._createIndexes()

      this.isConnected = true
      this.isConnecting = false
      this.reconnectAttempts = 0
      
      logger.info('✅ MongoDB connected')

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }

    } catch (error) {
      this.isConnected = false
      this.isConnecting = false
      this.reconnectAttempts++

      logger.error(`MongoDB connection failed: ${error.message}`)

      if (this.client) {
        try {
          await this.client.close(true)
        } catch (e) {}
        this.client = null
        this.db = null
        this.sessions = null
        this.authBaileys = null
      }

      if (this.reconnectAttempts < CONFIG.MAX_RECONNECT_ATTEMPTS) {
        this._scheduleReconnect()
      }
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || this.shutdownRequested) return

    const delay = Math.min(
      CONFIG.RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
      CONFIG.RECONNECT_DELAY * 16
    )

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this._initConnection()
    }, delay)
  }

  _startHealthCheck() {
    this.healthCheckTimer = setInterval(async () => {
      if (this.isConnecting || this.shutdownRequested) return

      if (this.isConnected && this.client) {
        try {
          await Promise.race([
            this.client.db('admin').command({ ping: 1 }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
          ])
        } catch (error) {
          this.isConnected = false
          this._scheduleReconnect()
        }
      } else if (!this.reconnectTimer) {
        if (this.reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
          this.reconnectAttempts = 0
        }
        this._scheduleReconnect()
      }
    }, CONFIG.HEALTH_CHECK_INTERVAL)
  }

  async _createIndexes() {
    if (!this.sessions) return

    const indexes = [
      { key: { sessionId: 1 }, unique: true },
      { key: { source: 1, detected: 1 } },
      { key: { source: 1, connectionStatus: 1, isConnected: 1, detected: 1 } },
      { key: { updatedAt: -1 } },
    ]

    for (const idx of indexes) {
      try {
        await this.sessions.createIndex(idx.key, { unique: idx.unique || false })
      } catch (error) {
        if (!error.message.includes('already exists')) {
          logger.debug(`Index creation failed: ${error.message}`)
        }
      }
    }

    if (this.authBaileys) {
      try {
        await this.authBaileys.createIndex({ sessionId: 1, filename: 1 }, { unique: true })
      } catch (error) {
        if (!error.message.includes('already exists')) {
          logger.debug(`Auth index creation failed: ${error.message}`)
        }
      }
    }
  }

  // ==================== OPERATIONS ====================

  async saveSession(sessionId, sessionData) {
    if (!this.isConnected || !this.sessions) return false

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
        isWeb: sessionData.source === 'web',
        createdAt: sessionData.createdAt || new Date(),
        updatedAt: new Date(),
      }

      const result = await this.sessions.replaceOne(
        { sessionId },
        document,
        { upsert: true }
      )

      return result.acknowledged
    } catch (error) {
      logger.error(`MongoDB save failed: ${error.message}`)
      return false
    }
  }

  async getSession(sessionId) {
    if (!this.isConnected || !this.sessions) return null

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
        updatedAt: session.updatedAt,
      }
    } catch (error) {
      return null
    }
  }

  async updateSession(sessionId, updates) {
    if (!this.isConnected || !this.sessions) return false

    try {
      const updateDoc = { ...updates, updatedAt: new Date() }
      
      if (updates.source === 'web') {
        updateDoc.isWeb = true
      } else if (updates.source === 'telegram') {
        updateDoc.isWeb = false
      }

      const result = await this.sessions.updateOne(
        { sessionId },
        { $set: updateDoc }
      )

      return result.acknowledged
    } catch (error) {
      return false
    }
  }

  async deleteSession(sessionId) {
    if (!this.isConnected || !this.sessions) return false

    try {
      const result = await this.sessions.deleteOne({ sessionId })
      return result.deletedCount > 0
    } catch (error) {
      return false
    }
  }

  async deleteAuthState(sessionId) {
    if (!this.isConnected || !this.authBaileys) return false

    try {
      const result = await this.authBaileys.deleteMany({ sessionId })
      return result.deletedCount > 0
    } catch (error) {
      return false
    }
  }

  async getAllSessions() {
    if (!this.isConnected || !this.sessions) return []

    try {
      const sessions = await this.sessions
        .find({})
        .sort({ updatedAt: -1 })
        .limit(1000)
        .toArray()

      return sessions.map(s => ({
        sessionId: s.sessionId,
        userId: s.telegramId,
        telegramId: s.telegramId,
        phoneNumber: s.phoneNumber,
        isConnected: s.isConnected,
        connectionStatus: s.connectionStatus,
        reconnectAttempts: s.reconnectAttempts,
        source: s.source || 'telegram',
        detected: s.detected !== false,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }))
    } catch (error) {
      return []
    }
  }

  async getUndetectedWebSessions() {
    if (!this.isConnected || !this.sessions) return []

    try {
      const sessions = await this.sessions
        .find({
          isWeb: true,
          connectionStatus: 'connected',
          isConnected: true,
          detected: { $ne: true },
        })
        .sort({ updatedAt: -1 })
        .limit(50)
        .toArray()

      const now = Date.now()
      const readySessions = sessions.filter(s => {
        const age = now - new Date(s.updatedAt).getTime()
        return age >= 5000 // 5 seconds
      })

      if (readySessions.length > 0) {
        logger.info(`Found ${readySessions.length} undetected web sessions`)
      }

      return readySessions.map(s => ({
        sessionId: s.sessionId,
        userId: s.telegramId,
        telegramId: s.telegramId,
        phoneNumber: s.phoneNumber,
        isConnected: s.isConnected,
        connectionStatus: s.connectionStatus,
        source: s.source,
        detected: s.detected || false,
        updatedAt: s.updatedAt,
      }))
    } catch (error) {
      return []
    }
  }

  async close() {
    this.shutdownRequested = true

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.client && this.isConnected) {
      try {
        await this.client.close(true)
        logger.info('MongoDB closed')
      } catch (error) {
        logger.error(`MongoDB close error: ${error.message}`)
      }
    }

    this.isConnected = false
    this.client = null
    this.db = null
    this.sessions = null
    this.authBaileys = null
  }
}