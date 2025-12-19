import { MongoClient } from "mongodb"
import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("MONGODB_STORAGE")

// ==================== CONFIGURATION ====================
const CONFIG = {
  RECONNECT_DELAY: 5000, // 5 seconds
  HEALTH_CHECK_INTERVAL: 30000, // 30 seconds
  CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
}

// ==================== SESSION CACHE ====================
class SessionCache {
  constructor() {
    this.cache = new Map() // sessionId -> { data, timestamp }
    this.allSessions = { data: null, timestamp: 0 }
  }

  get(sessionId) {
    const cached = this.cache.get(sessionId)
    if (!cached) return null
    
    // Return cached data (even if stale - better than nothing)
    return cached.data
  }

  set(sessionId, data) {
    this.cache.set(sessionId, { data, timestamp: Date.now() })
  }

  delete(sessionId) {
    this.cache.delete(sessionId)
  }

  getAllSessions() {
    return this.allSessions.data
  }

  setAllSessions(data) {
    this.allSessions = { data, timestamp: Date.now() }
  }

  clear() {
    this.cache.clear()
    this.allSessions = { data: null, timestamp: 0 }
  }
}

// ==================== MONGODB STORAGE ====================
export class MongoDBStorage {
  constructor() {
    this.client = null
    this.db = null
    this.sessions = null
    this.isConnected = false
    this.isConnecting = false
    this.reconnectTimer = null
    this.healthCheckTimer = null
    this.cache = new SessionCache()
    
    this._initConnection()
    this._startHealthCheck()
  }

  // ==================== CONNECTION ====================
  async _initConnection() {
    if (this.isConnecting) return
    this.isConnecting = true

    try {
      const mongoUrl = process.env.MONGODB_URI || "mongodb://localhost:27017/whatsapp_bot"

      logger.info("🔄 Connecting to MongoDB...")

      // Close old connection if exists
      if (this.client) {
        try {
          await this.client.close(false)
        } catch (e) {}
      }

      this.client = new MongoClient(mongoUrl, {
        maxPoolSize: 50,
        minPoolSize: 5,
        maxIdleTimeMS: 120000,
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 30000,
        retryWrites: true,
        retryReads: true,
      })

      await this.client.connect()
      this.db = this.client.db()
      this.sessions = this.db.collection("sessions")

      // Setup event listeners
      this.client.on('close', () => {
        logger.warn("MongoDB connection closed")
        this.isConnected = false
        this._scheduleReconnect()
      })

      this.client.on('error', (error) => {
        logger.error(`MongoDB error: ${error.message}`)
        this.isConnected = false
        this._scheduleReconnect()
      })

      await this._createIndexes()

      this.isConnected = true
      this.isConnecting = false
      logger.info("✅ MongoDB connected successfully")

      // Clear reconnect timer
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }

    } catch (error) {
      this.isConnected = false
      this.isConnecting = false
      logger.error(`MongoDB connection failed: ${error.message}`)
      this._scheduleReconnect()
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return
    
    logger.info(`🔄 Reconnecting in ${CONFIG.RECONNECT_DELAY / 1000}s...`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this._initConnection()
    }, CONFIG.RECONNECT_DELAY)
  }

  _startHealthCheck() {
    this.healthCheckTimer = setInterval(async () => {
      if (this.isConnecting) return

      if (this.isConnected && this.client) {
        try {
          await this.client.db("admin").command({ ping: 1 })
        } catch (error) {
          logger.warn("Health check failed")
          this.isConnected = false
          this._scheduleReconnect()
        }
      } else if (!this.reconnectTimer) {
        this._scheduleReconnect()
      }
    }, CONFIG.HEALTH_CHECK_INTERVAL)
  }

  async _createIndexes() {
    if (!this.sessions) return

    const indexes = [
      { key: { telegramId: 1 }, name: "telegramId_1" },
      { key: { phoneNumber: 1 }, name: "phoneNumber_1" },
      { key: { sessionId: 1 }, unique: true, name: "sessionId_unique" },
    ]

    for (const idx of indexes) {
      try {
        await this.sessions.createIndex(idx.key, {
          name: idx.name,
          unique: idx.unique || false,
          background: true,
        })
      } catch (error) {
        if (!error.message.includes("already exists")) {
          logger.warn(`Index creation failed: ${idx.name}`)
        }
      }
    }
  }

  // ==================== SAVE SESSION (WITH CACHE) ====================
  async saveSession(sessionId, sessionData) {
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

    // ALWAYS update cache immediately
    this.cache.set(sessionId, document)

    // Try MongoDB in background (don't wait)
    if (this.isConnected && this.sessions) {
      this.sessions.replaceOne({ sessionId }, document, { upsert: true })
        .catch(error => {
          logger.debug(`Background save failed for ${sessionId}: ${error.message}`)
        })
    }

    return true // Always return success (cache updated)
  }

  // ==================== GET SESSION (WITH CACHE) ====================
  async getSession(sessionId) {
    // 1. Check cache first
    const cached = this.cache.get(sessionId)
    if (cached) {
      return cached
    }

    // 2. Try MongoDB
    if (this.isConnected && this.sessions) {
      try {
        const session = await this.sessions.findOne({ sessionId })
        
        if (session) {
          const mapped = {
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
          
          // Update cache
          this.cache.set(sessionId, mapped)
          return mapped
        }
      } catch (error) {
        logger.debug(`getSession(${sessionId}) failed: ${error.message}`)
      }
    }

    return null
  }

  // ==================== UPDATE SESSION (WITH CACHE) ====================
  async updateSession(sessionId, updates) {
    // 1. Update cache first
    const cached = this.cache.get(sessionId)
    if (cached) {
      Object.assign(cached, updates, { updatedAt: new Date() })
      this.cache.set(sessionId, cached)
    }

    // 2. Try MongoDB in background
    if (this.isConnected && this.sessions) {
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

      this.sessions.updateOne({ sessionId }, { $set: updateDoc })
        .catch(error => {
          logger.debug(`Background update failed for ${sessionId}: ${error.message}`)
        })
    }

    return true // Always return success (cache updated)
  }

  // ==================== DELETE SESSION ====================
  async deleteSession(sessionId) {
    // Remove from cache
    this.cache.delete(sessionId)

    // Try MongoDB
    if (this.isConnected && this.sessions) {
      try {
        await this.sessions.deleteOne({ sessionId })
      } catch (error) {
        logger.debug(`deleteSession(${sessionId}) failed: ${error.message}`)
      }
    }

    return true
  }

  // ==================== DELETE AUTH STATE ====================
  async deleteAuthState(sessionId) {
    if (this.isConnected && this.db) {
      try {
        const authCollection = this.db.collection("auth_baileys")
        const result = await authCollection.deleteMany({ sessionId })
        logger.info(`Deleted ${result.deletedCount} auth documents for ${sessionId}`)
        return true
      } catch (error) {
        logger.error(`deleteAuthState(${sessionId}) failed: ${error.message}`)
      }
    }
    return false
  }

  // ==================== GET ALL SESSIONS (WITH CACHE) ====================
  async getAllSessions() {
    // 1. Check cache first
    const cached = this.cache.getAllSessions()
    if (cached) {
      return cached
    }

    // 2. Try MongoDB
    if (this.isConnected && this.sessions) {
      try {
        const sessions = await this.sessions.find({}).sort({ updatedAt: -1 }).toArray()
        
        const mapped = sessions.map((session) => ({
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

        // Update cache
        this.cache.setAllSessions(mapped)
        return mapped
      } catch (error) {
        logger.debug(`getAllSessions failed: ${error.message}`)
      }
    }

    return []
  }

  // ==================== GET UNDETECTED WEB SESSIONS ====================
  async getUndetectedWebSessions() {
    if (this.isConnected && this.sessions) {
      try {
        const sessions = await this.sessions
          .find({
            source: "web",
            connectionStatus: "connected",
            isConnected: true,
            detected: { $ne: true },
          })
          .sort({ updatedAt: -1 })
          .limit(50)
          .toArray()

        return sessions.map((session) => ({
          sessionId: session.sessionId,
          userId: session.telegramId || session.userId,
          telegramId: session.telegramId || session.userId,
          phoneNumber: session.phoneNumber,
          isConnected: session.isConnected,
          connectionStatus: session.connectionStatus,
          source: session.source,
          detected: session.detected || false,
        }))
      } catch (error) {
        logger.debug(`getUndetectedWebSessions failed: ${error.message}`)
      }
    }

    return []
  }

  // ==================== CONNECTION STATUS ====================
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      cacheSize: this.cache.cache.size,
    }
  }

  // ==================== CLOSE ====================
  async close() {
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
        await this.client.close()
        logger.info("MongoDB connection closed")
      } catch (error) {
        logger.error(`MongoDB close error: ${error.message}`)
      }
    }

    this.cache.clear()
  }
}