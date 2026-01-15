// ============================================================================
// mongodb.js - ULTRA-FAST: Optimized for Speed & Concurrency
// ============================================================================

import { MongoClient } from "mongodb"
import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("MONGODB_STORAGE")

const CONFIG = {
  RECONNECT_DELAY: 3000,
  HEALTH_CHECK_INTERVAL: 60000,
  CONNECTION_TIMEOUT: 15000,
  SOCKET_TIMEOUT: 120000,
  MAX_RECONNECT_ATTEMPTS: 3,
  OPERATION_TIMEOUT: 5000,
  PREKEY_BATCH_SIZE: 100,
  PREKEY_BATCH_DELAY: 50,
  MAX_POOL_SIZE: 200,
  MIN_POOL_SIZE: 50,
  BULK_WRITE_BATCH: 500,
}

const preKeyWriteQueue = new Map()
const sanitizeFileName = (fileName) => fileName?.replace(/::/g, "__").replace(/:/g, "-").replace(/\//g, "_").replace(/\\/g, "_") || fileName

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

    this._initConnection()
    this._startHealthCheck()

    const storageMode = process.env.STORAGE_MODE || "mongodb"
    logger.info(`MongoDB mode: ${storageMode === "mongodb" ? "PRIMARY" : "SECONDARY"}`)
  }

  async _initConnection() {
    if (this.isConnecting || this.shutdownRequested) return
    this.isConnecting = true

    try {
      const mongoUrl = process.env.MONGODB_URI || "mongodb://localhost:27017/whatsapp_bot"
      logger.info(`Connecting to MongoDB (attempt ${this.reconnectAttempts + 1}/${CONFIG.MAX_RECONNECT_ATTEMPTS})...`)

      if (this.client) {
        try { await this.client.close(true) } catch (e) {}
      }

      this.client = new MongoClient(mongoUrl, {
        maxPoolSize: CONFIG.MAX_POOL_SIZE,
        minPoolSize: CONFIG.MIN_POOL_SIZE,
        serverSelectionTimeoutMS: CONFIG.CONNECTION_TIMEOUT,
        socketTimeoutMS: CONFIG.SOCKET_TIMEOUT,
        connectTimeoutMS: CONFIG.CONNECTION_TIMEOUT,
        retryWrites: true,
        retryReads: true,
        waitQueueTimeoutMS: 60000,
        maxIdleTimeMS: 300000,
        heartbeatFrequencyMS: 30000,
        compressors: ['snappy', 'zlib'],
      })

      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), CONFIG.CONNECTION_TIMEOUT)),
      ])

      this.db = this.client.db()
      this.sessions = this.db.collection("sessions")
      this.authBaileys = this.db.collection("auth_baileys")

      await this._createIndexes()

      this.isConnected = true
      this.isConnecting = false
      this.reconnectAttempts = 0

      logger.info(`MongoDB connected (pool: ${CONFIG.MAX_POOL_SIZE})`)

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }

      this._setupConnectionMonitoring()
    } catch (error) {
      this.isConnected = false
      this.isConnecting = false
      this.reconnectAttempts++

      logger.error(`MongoDB connection failed: ${error.message}`)

      if (this.client) {
        try { await this.client.close(true) } catch (e) {}
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

  _setupConnectionMonitoring() {
    if (!this.client) return
    this.client.on("close", () => { this.isConnected = false })
    this.client.on("error", () => { this.isConnected = false })
    this.client.on("timeout", () => { this.isConnected = false })
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || this.shutdownRequested) return
    const delay = CONFIG.RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this._initConnection()
    }, Math.min(delay, 30000))
  }

  _startHealthCheck() {
    this.healthCheckTimer = setInterval(async () => {
      if (this.isConnecting || this.shutdownRequested) return
      if (this.isConnected && this.client) {
        try {
          await Promise.race([
            this.client.db("admin").command({ ping: 1 }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
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
    if (!this.sessions || !this.authBaileys) return
    try {
      await Promise.all([
        this.sessions.createIndex({ sessionId: 1 }, { unique: true }),
        this.sessions.createIndex({ source: 1, connectionStatus: 1, isConnected: 1, detected: 1 }),
        this.authBaileys.createIndex({ sessionId: 1, filename: 1 }, { unique: true }),
        this.authBaileys.createIndex({ sessionId: 1 }),
      ])
    } catch (error) {
      if (!error.message.includes("already exists")) {
        logger.debug(`Index creation: ${error.message}`)
      }
    }
  }

  // ============================================================================
  // SESSION METADATA OPERATIONS
  // ============================================================================

  async saveSession(sessionId, sessionData) {
    if (!this.isConnected || !this.sessions) return false
    try {
      const document = {
        sessionId,
        telegramId: sessionData.telegramId || sessionData.userId,
        userId: sessionData.userId || sessionData.telegramId,
        phoneNumber: sessionData.phoneNumber,
        isConnected: sessionData.isConnected !== undefined ? sessionData.isConnected : false,
        connectionStatus: sessionData.connectionStatus || "disconnected",
        reconnectAttempts: sessionData.reconnectAttempts || 0,
        source: sessionData.source || "telegram",
        detected: sessionData.detected !== false,
        detectedAt: sessionData.detectedAt || (sessionData.detected ? new Date() : null),
        createdAt: sessionData.createdAt || new Date(),
        updatedAt: new Date(),
      }
      const result = await this.sessions.replaceOne({ sessionId }, document, {
        upsert: true,
        writeConcern: { w: 1, j: false },
        maxTimeMS: CONFIG.OPERATION_TIMEOUT,
      })
      return result.acknowledged
    } catch (error) {
      if (!this._isSilentError(error)) logger.error(`Save failed ${sessionId}: ${error.message}`)
      return false
    }
  }

  async getSession(sessionId) {
    if (!this.isConnected || !this.sessions) return null
    try {
      const session = await this.sessions.findOne({ sessionId }, { maxTimeMS: CONFIG.OPERATION_TIMEOUT })
      if (!session) return null
      return {
        sessionId: session.sessionId,
        userId: session.telegramId || session.userId,
        telegramId: session.telegramId || session.userId,
        phoneNumber: session.phoneNumber,
        isConnected: session.isConnected,
        connectionStatus: session.connectionStatus,
        reconnectAttempts: session.reconnectAttempts,
        source: session.source || "telegram",
        detected: session.detected !== false,
        detectedAt: session.detectedAt,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      }
    } catch (error) {
      if (!this._isSilentError(error)) logger.error(`Get failed ${sessionId}: ${error.message}`)
      return null
    }
  }

  async updateSession(sessionId, updates) {
    if (!this.isConnected || !this.sessions) return false
    try {
      const updateDoc = { ...updates, updatedAt: new Date() }
      if (updates.detected === true && !updates.detectedAt) updateDoc.detectedAt = new Date()
      const result = await this.sessions.updateOne({ sessionId }, { $set: updateDoc }, {
        writeConcern: { w: 1, j: false },
        maxTimeMS: CONFIG.OPERATION_TIMEOUT,
      })
      return result.acknowledged
    } catch (error) {
      if (!this._isSilentError(error)) logger.error(`Update failed ${sessionId}: ${error.message}`)
      return false
    }
  }

  async deleteSession(sessionId) {
    if (!this.isConnected || !this.sessions) return false
    try {
      const result = await this.sessions.deleteOne({ sessionId }, { maxTimeMS: CONFIG.OPERATION_TIMEOUT })
      if (result.deletedCount > 0) logger.info(`Deleted session: ${sessionId}`)
      return result.deletedCount > 0
    } catch (error) {
      if (!this._isSilentError(error)) logger.error(`Delete failed ${sessionId}: ${error.message}`)
      return false
    }
  }

  async getAllSessions() {
    if (!this.isConnected || !this.sessions) return []
    try {
      const sessions = await this.sessions.find({}).sort({ updatedAt: -1 }).limit(5000).maxTimeMS(15000).toArray()
      return sessions.map((s) => ({
        sessionId: s.sessionId,
        userId: s.telegramId || s.userId,
        telegramId: s.telegramId || s.userId,
        phoneNumber: s.phoneNumber,
        isConnected: s.isConnected,
        connectionStatus: s.connectionStatus,
        reconnectAttempts: s.reconnectAttempts,
        source: s.source || "telegram",
        detected: s.detected !== false,
        detectedAt: s.detectedAt,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }))
    } catch (error) {
      if (!this._isSilentError(error)) logger.error(`Get all sessions failed: ${error.message}`)
      return []
    }
  }

  async getUndetectedWebSessions() {
    if (!this.isConnected || !this.sessions) return []
    try {
      const sessions = await this.sessions.find({
        source: "web",
        connectionStatus: "connected",
        isConnected: true,
        detected: { $ne: true },
      }).sort({ updatedAt: -1 }).limit(1000).maxTimeMS(CONFIG.OPERATION_TIMEOUT).toArray()

      const now = Date.now()
      return sessions.filter(s => (now - new Date(s.updatedAt).getTime()) >= 5000).map((s) => ({
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
      if (!this._isSilentError(error)) logger.error(`Get undetected sessions failed: ${error.message}`)
      return []
    }
  }

  // ============================================================================
  // AUTH DATA OPERATIONS - ULTRA FAST
  // ============================================================================

  async readAuthData(sessionId, fileName) {
    if (!this.isConnected || !this.authBaileys) return null
    try {
      const result = await this.authBaileys.findOne({ sessionId, filename: sanitizeFileName(fileName) }, {
        projection: { datajson: 1 },
        readPreference: "primaryPreferred",
        maxTimeMS: CONFIG.OPERATION_TIMEOUT,
      })
      return result?.datajson || null
    } catch (error) {
      if (!this._isSilentError(error)) logger.debug(`Read failed ${sessionId}/${fileName}: ${error.message}`)
      return null
    }
  }

  async writeAuthData(sessionId, fileName, data) {
    if (/^pre-?key-?\d+\.json$/i.test(fileName)) {
      return this._queuePreKeyWrite(sessionId, fileName, data)
    }
    return this._writeAuthDataDirect(sessionId, fileName, data)
  }

  _queuePreKeyWrite(sessionId, fileName, data) {
    if (!preKeyWriteQueue.has(sessionId)) {
      preKeyWriteQueue.set(sessionId, { writes: [], timer: null })
    }

    const queue = preKeyWriteQueue.get(sessionId)
    queue.writes.push({ fileName, data })

    if (queue.timer) clearTimeout(queue.timer)

    queue.timer = setTimeout(() => this._flushPreKeyBatch(sessionId), CONFIG.PREKEY_BATCH_DELAY)

    if (queue.writes.length >= CONFIG.PREKEY_BATCH_SIZE) {
      clearTimeout(queue.timer)
      this._flushPreKeyBatch(sessionId)
    }
    return true
  }

  async _flushPreKeyBatch(sessionId) {
    const queue = preKeyWriteQueue.get(sessionId)
    if (!queue || queue.writes.length === 0) return

    const writes = [...queue.writes]
    queue.writes = []
    queue.timer = null

    if (!this.isConnected || !this.authBaileys) return

    try {
      // Process in ultra-large batches
      for (let i = 0; i < writes.length; i += CONFIG.BULK_WRITE_BATCH) {
        const batch = writes.slice(i, i + CONFIG.BULK_WRITE_BATCH)
        const bulkOps = batch.map(({ fileName, data }) => ({
          updateOne: {
            filter: { sessionId, filename: sanitizeFileName(fileName) },
            update: {
              $set: {
                sessionId,
                filename: sanitizeFileName(fileName),
                datajson: data,
                updatedAt: new Date(),
              },
            },
            upsert: true,
          },
        }))

        await this.authBaileys.bulkWrite(bulkOps, {
          ordered: false,
          writeConcern: { w: 1, j: false },
        })
      }
      logger.debug(`Batch wrote ${writes.length} pre-keys for ${sessionId}`)
    } catch (error) {
      if (!this._isSilentError(error)) logger.error(`Batch write failed ${sessionId}: ${error.message}`)
    }
  }

  async _writeAuthDataDirect(sessionId, fileName, data) {
    if (!this.isConnected || !this.authBaileys) return false
    try {
      const result = await this.authBaileys.updateOne(
        { sessionId, filename: sanitizeFileName(fileName) },
        {
          $set: {
            sessionId,
            filename: sanitizeFileName(fileName),
            datajson: data,
            updatedAt: new Date(),
          },
        },
        {
          upsert: true,
          writeConcern: { w: 1, j: false },
          maxTimeMS: CONFIG.OPERATION_TIMEOUT * 2,
        }
      )
      return result.acknowledged
    } catch (error) {
      if (!this._isSilentError(error)) logger.error(`Write failed ${sessionId}/${fileName}: ${error.message}`)
      return false
    }
  }

  async deleteAuthData(sessionId, fileName) {
    if (!this.isConnected || !this.authBaileys) return false
    try {
      const result = await this.authBaileys.deleteOne({ sessionId, filename: sanitizeFileName(fileName) }, { maxTimeMS: CONFIG.OPERATION_TIMEOUT })
      return result.deletedCount > 0
    } catch (error) {
      if (!this._isSilentError(error)) logger.debug(`Delete failed ${sessionId}/${fileName}: ${error.message}`)
      return false
    }
  }

  async deleteAuthState(sessionId) {
    if (!this.isConnected || !this.authBaileys) return false
    try {
      const result = await this.authBaileys.deleteMany({ sessionId }, { maxTimeMS: CONFIG.OPERATION_TIMEOUT * 3 })
      if (result.deletedCount > 0) logger.info(`Deleted ${result.deletedCount} auth docs: ${sessionId}`)
      return result.deletedCount > 0
    } catch (error) {
      if (!this._isSilentError(error)) logger.error(`Delete auth state failed ${sessionId}: ${error.message}`)
      return false
    }
  }

  async getAllAuthFiles(sessionId) {
    if (!this.isConnected || !this.authBaileys) return []
    try {
      const files = await this.authBaileys.find({ sessionId }).project({ filename: 1 }).maxTimeMS(CONFIG.OPERATION_TIMEOUT * 2).toArray()
      return files.map((f) => f.filename)
    } catch (error) {
      if (!this._isSilentError(error)) logger.error(`Get auth files failed ${sessionId}: ${error.message}`)
      return []
    }
  }

  async hasValidAuthData(sessionId) {
    if (!this.isConnected || !this.authBaileys) return false
    try {
      const creds = await this.authBaileys.findOne({ sessionId, filename: "creds.json" }, { maxTimeMS: CONFIG.OPERATION_TIMEOUT })
      if (!creds?.datajson) return false
      const parsed = typeof creds.datajson === "string" ? JSON.parse(creds.datajson) : creds.datajson
      return !!(parsed?.noiseKey && parsed?.signedIdentityKey)
    } catch (error) {
      if (!this._isSilentError(error)) logger.debug(`Auth validation failed ${sessionId}: ${error.message}`)
      return false
    }
  }

  async completeCleanup(sessionId) {
    if (!this.isConnected) return { metadata: false, auth: false }
    const results = { metadata: false, auth: false }

    try {
      if (this.sessions) {
        const metaResult = await this.sessions.deleteOne({ sessionId }, { maxTimeMS: CONFIG.OPERATION_TIMEOUT })
        results.metadata = metaResult.deletedCount > 0
      }
      if (this.authBaileys) {
        const authResult = await this.authBaileys.deleteMany({ sessionId }, { maxTimeMS: CONFIG.OPERATION_TIMEOUT * 3 })
        results.auth = authResult.deletedCount > 0
        logger.info(`Cleanup complete: ${sessionId} (metadata: ${results.metadata}, auth: ${authResult.deletedCount} docs)`)
      }
      return results
    } catch (error) {
      logger.error(`Cleanup failed ${sessionId}: ${error.message}`)
      return results
    }
  }

  // ============================================================================
  // PRE-KEY MANAGEMENT - ULTRA FAST BULK OPERATIONS
  // ============================================================================

  async deleteOldPreKeys(sessionId, maxToKeep = 500) {
    if (!this.isConnected || !this.authBaileys) return { deleted: 0 }
    try {
      const preKeyFiles = await this.authBaileys.find({ sessionId, filename: { $regex: /^pre-?key/i } })
        .project({ filename: 1, updatedAt: 1 })
        .sort({ updatedAt: 1 })
        .maxTimeMS(CONFIG.OPERATION_TIMEOUT * 2)
        .toArray()

      if (preKeyFiles.length <= maxToKeep) return { deleted: 0, total: preKeyFiles.length }

      const toDelete = preKeyFiles.slice(0, preKeyFiles.length - maxToKeep).map((f) => f.filename)
      const result = await this.authBaileys.deleteMany({ sessionId, filename: { $in: toDelete } }, { maxTimeMS: CONFIG.OPERATION_TIMEOUT * 2 })

      if (result.deletedCount > 0) logger.info(`Deleted ${result.deletedCount} old pre-keys for ${sessionId}`)
      return { deleted: result.deletedCount, total: preKeyFiles.length }
    } catch (error) {
      if (!this._isSilentError(error)) logger.error(`Delete old pre-keys failed ${sessionId}: ${error.message}`)
      return { deleted: 0, error: error.message }
    }
  }

  async cleanupAllPreKeys(maxToKeep = 500, threshold = 300) {
    if (!this.isConnected || !this.authBaileys) return { sessions: 0, deleted: 0 }
    try {
      const sessionsWithPreKeys = await this.authBaileys.aggregate([
        { $match: { filename: { $regex: /^pre-?key/i } } },
        { $group: { _id: "$sessionId", count: { $sum: 1 } } },
        { $match: { count: { $gt: threshold } } },
      ], { maxTimeMS: CONFIG.OPERATION_TIMEOUT * 3 }).toArray()

      let totalDeleted = 0
      const deletePromises = sessionsWithPreKeys.map(async (session) => {
        const result = await this.deleteOldPreKeys(session._id, maxToKeep)
        return result.deleted || 0
      })

      const results = await Promise.allSettled(deletePromises)
      totalDeleted = results.filter(r => r.status === 'fulfilled').reduce((sum, r) => sum + r.value, 0)

      if (totalDeleted > 0) logger.info(`Bulk cleanup: ${totalDeleted} pre-keys across ${sessionsWithPreKeys.length} sessions`)
      return { sessions: sessionsWithPreKeys.length, deleted: totalDeleted }
    } catch (error) {
      if (!this._isSilentError(error)) logger.error(`Bulk cleanup failed: ${error.message}`)
      return { sessions: 0, deleted: 0, error: error.message }
    }
  }

  _isSilentError(error) {
    const silentMessages = ["closed", "interrupted", "session that has ended", "Cannot use a session", "Client must be connected", "connection pool"]
    return silentMessages.some((msg) => error.message.includes(msg))
  }

  async close() {
    this.shutdownRequested = true
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.client && this.isConnected) {
      try {
        await this.client.close(true)
        logger.info("MongoDB closed")
      } catch (error) {
        logger.error(`Close error: ${error.message}`)
      }
    }
    this.isConnected = false
    this.client = null
    this.db = null
    this.sessions = null
    this.authBaileys = null
  }

  getStats() {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      poolSize: CONFIG.MAX_POOL_SIZE,
      collections: { sessions: !!this.sessions, authBaileys: !!this.authBaileys },
    }
  }
}