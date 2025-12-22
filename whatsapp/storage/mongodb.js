// ============================================================================
// mongodb.js - FIXED: Web Detection + Auth Sync + Complete Cleanup
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

// ✅ Sanitize filename (replaces :: with __, : with -)
const sanitizeFileName = (fileName) => {
  if (!fileName) return fileName
  return fileName
    .replace(/::/g, '__')
    .replace(/:/g, '-')
    .replace(/\//g, '_')
    .replace(/\\/g, '_')
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
    
    this._initConnection()
    this._startHealthCheck()
    
    if (storageMode === 'mongodb') {
      logger.info('📦 MongoDB PRIMARY - metadata + auth storage')
    } else {
      logger.info('📁 MongoDB SECONDARY - web detection + auth backup')
    }
  }

  // ==================== CONNECTION MANAGEMENT ====================
  
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
      
      logger.info('✅ MongoDB connected successfully')

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

    logger.info(`Reconnecting in ${delay/1000}s...`)

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
          logger.warn('MongoDB health check failed - reconnecting...')
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
    if (!this.sessions || !this.authBaileys) return

    try {
      // Session indexes
      await this.sessions.createIndex({ sessionId: 1 }, { unique: true })
      await this.sessions.createIndex({ source: 1, detected: 1 })
      await this.sessions.createIndex({ source: 1, connectionStatus: 1, isConnected: 1, detected: 1 })
      await this.sessions.createIndex({ updatedAt: -1 })

      // Auth indexes
      await this.authBaileys.createIndex({ sessionId: 1, filename: 1 }, { unique: true })
      await this.authBaileys.createIndex({ sessionId: 1 })

      logger.debug('MongoDB indexes created')
    } catch (error) {
      if (!error.message.includes('already exists')) {
        logger.debug(`Index creation: ${error.message}`)
      }
    }
  }

  // ==================== SESSION METADATA OPERATIONS ====================

  async saveSession(sessionId, sessionData) {
    if (!this.isConnected || !this.sessions) return false

    try {
      const document = {
        sessionId,
        telegramId: sessionData.telegramId || sessionData.userId,
        userId: sessionData.userId || sessionData.telegramId,
        phoneNumber: sessionData.phoneNumber,
        isConnected: sessionData.isConnected !== undefined ? sessionData.isConnected : false,
        connectionStatus: sessionData.connectionStatus || 'disconnected',
        reconnectAttempts: sessionData.reconnectAttempts || 0,
        source: sessionData.source || 'telegram',
        detected: sessionData.detected !== false,
        detectedAt: sessionData.detectedAt || (sessionData.detected ? new Date() : null),
        createdAt: sessionData.createdAt || new Date(),
        updatedAt: new Date(),
      }

      const result = await this.sessions.replaceOne(
        { sessionId },
        document,
        { upsert: true }
      )

      if (result.acknowledged) {
        logger.debug(`✅ Saved session metadata: ${sessionId}`)
      }

      return result.acknowledged
    } catch (error) {
      logger.error(`MongoDB save failed for ${sessionId}: ${error.message}`)
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
        userId: session.telegramId || session.userId,
        telegramId: session.telegramId || session.userId,
        phoneNumber: session.phoneNumber,
        isConnected: session.isConnected,
        connectionStatus: session.connectionStatus,
        reconnectAttempts: session.reconnectAttempts,
        source: session.source || 'telegram',
        detected: session.detected !== false,
        detectedAt: session.detectedAt,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      }
    } catch (error) {
      logger.error(`Failed to get session ${sessionId}: ${error.message}`)
      return null
    }
  }

  async updateSession(sessionId, updates) {
    if (!this.isConnected || !this.sessions) return false

    try {
      const updateDoc = { 
        ...updates, 
        updatedAt: new Date() 
      }

      // If marking as detected, set timestamp
      if (updates.detected === true && !updates.detectedAt) {
        updateDoc.detectedAt = new Date()
      }

      const result = await this.sessions.updateOne(
        { sessionId },
        { $set: updateDoc }
      )

      if (result.acknowledged && result.modifiedCount > 0) {
        logger.debug(`✅ Updated session: ${sessionId}`)
      }

      return result.acknowledged
    } catch (error) {
      logger.error(`MongoDB update failed for ${sessionId}: ${error.message}`)
      return false
    }
  }

  async deleteSession(sessionId) {
    if (!this.isConnected || !this.sessions) return false

    try {
      const result = await this.sessions.deleteOne({ sessionId })
      
      if (result.deletedCount > 0) {
        logger.info(`✅ Deleted session metadata: ${sessionId}`)
      }

      return result.deletedCount > 0
    } catch (error) {
      logger.error(`Failed to delete session ${sessionId}: ${error.message}`)
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
        userId: s.telegramId || s.userId,
        telegramId: s.telegramId || s.userId,
        phoneNumber: s.phoneNumber,
        isConnected: s.isConnected,
        connectionStatus: s.connectionStatus,
        reconnectAttempts: s.reconnectAttempts,
        source: s.source || 'telegram',
        detected: s.detected !== false,
        detectedAt: s.detectedAt,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }))
    } catch (error) {
      logger.error(`Failed to get all sessions: ${error.message}`)
      return []
    }
  }

  // ==================== WEB SESSION DETECTION ====================

  async getUndetectedWebSessions() {
    if (!this.isConnected || !this.sessions) {
      logger.debug('MongoDB not connected - cannot get undetected web sessions')
      return []
    }

    try {
      // Find web sessions that are connected but not detected
      const sessions = await this.sessions
        .find({
          source: 'web',
          connectionStatus: 'connected',
          isConnected: true,
          detected: { $ne: true },
        })
        .sort({ updatedAt: -1 })
        .limit(500)
        .toArray()

      // Filter sessions that are old enough (5+ seconds)
      const now = Date.now()
      const readySessions = sessions.filter(s => {
        const age = now - new Date(s.updatedAt).getTime()
        return age >= 5000
      })

      if (readySessions.length > 0) {
        logger.info(`🔍 Found ${readySessions.length} undetected web sessions`)
      }

      return readySessions.map(s => ({
        sessionId: s.sessionId,
        userId: s.telegramId || s.userId,
        telegramId: s.telegramId || s.userId,
        phoneNumber: s.phoneNumber,
        isConnected: s.isConnected,
        connectionStatus: s.connectionStatus,
        source: s.source,
        detected: s.detected || false,
        updatedAt: s.updatedAt,
      }))
    } catch (error) {
      logger.error(`Failed to get undetected web sessions: ${error.message}`)
      return []
    }
  }

  // ==================== AUTH STATE OPERATIONS ====================

  async readAuthData(sessionId, fileName) {
    if (!this.isConnected || !this.authBaileys) return null

    try {
      const sanitized = sanitizeFileName(fileName)
      
      const result = await this.authBaileys.findOne(
        { 
          sessionId,
          filename: sanitized
        },
        { projection: { datajson: 1 } }
      )

      if (result?.datajson) {
        logger.debug(`✅ Read auth: ${sessionId}/${fileName}`)
        return result.datajson
      }

      return null
    } catch (error) {
      logger.debug(`Auth read failed ${sessionId}/${fileName}: ${error.message}`)
      return null
    }
  }

  async writeAuthData(sessionId, fileName, data) {
    if (!this.isConnected || !this.authBaileys) return false

    try {
      const sanitized = sanitizeFileName(fileName)
      
      const result = await this.authBaileys.updateOne(
        { 
          sessionId,
          filename: sanitized
        },
        {
          $set: {
            sessionId,
            filename: sanitized,
            datajson: data,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      )

      if (result.acknowledged) {
        logger.debug(`✅ Wrote auth: ${sessionId}/${fileName}`)
      }

      return result.acknowledged
    } catch (error) {
      logger.error(`Auth write failed ${sessionId}/${fileName}: ${error.message}`)
      return false
    }
  }

  async deleteAuthData(sessionId, fileName) {
    if (!this.isConnected || !this.authBaileys) return false

    try {
      const sanitized = sanitizeFileName(fileName)
      
      const result = await this.authBaileys.deleteOne({
        sessionId,
        filename: sanitized,
      })

      return result.deletedCount > 0
    } catch (error) {
      logger.debug(`Auth delete failed ${sessionId}/${fileName}: ${error.message}`)
      return false
    }
  }

  async deleteAuthState(sessionId) {
    if (!this.isConnected || !this.authBaileys) return false

    try {
      const result = await this.authBaileys.deleteMany({ sessionId })
      
      if (result.deletedCount > 0) {
        logger.info(`✅ Deleted ${result.deletedCount} auth docs: ${sessionId}`)
      }

      return result.deletedCount > 0
    } catch (error) {
      logger.error(`Failed to delete auth state ${sessionId}: ${error.message}`)
      return false
    }
  }

  async getAllAuthFiles(sessionId) {
    if (!this.isConnected || !this.authBaileys) return []

    try {
      const files = await this.authBaileys
        .find({ sessionId })
        .project({ filename: 1 })
        .toArray()

      return files.map(f => f.filename)
    } catch (error) {
      logger.error(`Failed to get auth files for ${sessionId}: ${error.message}`)
      return []
    }
  }

  async hasValidAuthData(sessionId) {
    if (!this.isConnected || !this.authBaileys) return false

    try {
      const creds = await this.authBaileys.findOne({
        sessionId,
        filename: 'creds.json'
      })

      if (!creds?.datajson) return false

      const parsed = typeof creds.datajson === 'string' 
        ? JSON.parse(creds.datajson) 
        : creds.datajson

      return !!(parsed?.noiseKey && parsed?.signedIdentityKey)
    } catch (error) {
      logger.debug(`Auth validation failed ${sessionId}: ${error.message}`)
      return false
    }
  }

  // ==================== COMPLETE CLEANUP ====================

  async completeCleanup(sessionId) {
    if (!this.isConnected) return { metadata: false, auth: false }

    const results = {
      metadata: false,
      auth: false,
    }

    try {
      // Delete session metadata
      if (this.sessions) {
        const metaResult = await this.sessions.deleteOne({ sessionId })
        results.metadata = metaResult.deletedCount > 0
      }

      // Delete all auth data
      if (this.authBaileys) {
        const authResult = await this.authBaileys.deleteMany({ sessionId })
        results.auth = authResult.deletedCount > 0
      }

      if (results.metadata || results.auth) {
        logger.info(`✅ Complete MongoDB cleanup: ${sessionId} (meta: ${results.metadata}, auth: ${results.auth})`)
      }

      return results
    } catch (error) {
      logger.error(`Complete cleanup failed ${sessionId}: ${error.message}`)
      return results
    }
  }

  // ==================== ORPHAN DETECTION ====================

  async findOrphanedSessions() {
    if (!this.isConnected || !this.sessions || !this.authBaileys) return []

    try {
      const allSessions = await this.sessions.find({}).toArray()
      const orphans = []

      for (const session of allSessions) {
        const age = Date.now() - new Date(session.updatedAt || session.createdAt).getTime()
        
        // Skip recently created sessions (3 minute grace period)
        if (age < 180000) continue

        // Check if has auth data
        const hasAuth = await this.authBaileys.findOne({
          sessionId: session.sessionId,
          filename: 'creds.json'
        })

        if (!hasAuth) {
          orphans.push(session.sessionId)
        }
      }

      if (orphans.length > 0) {
        logger.info(`Found ${orphans.length} orphaned sessions in MongoDB`)
      }

      return orphans
    } catch (error) {
      logger.error(`Failed to find orphaned sessions: ${error.message}`)
      return []
    }
  }

  // ==================== SHUTDOWN ====================

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
        logger.info('✅ MongoDB connection closed')
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

  // ==================== UTILITIES ====================

  getStats() {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      collections: {
        sessions: !!this.sessions,
        authBaileys: !!this.authBaileys,
      },
    }
  }
}