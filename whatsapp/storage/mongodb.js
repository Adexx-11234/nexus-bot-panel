// ============================================================================
// mongodb.js - PRODUCTION READY: Connection Pool Management + Bulk Write Safety
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
  PREKEY_BATCH_SIZE: 10,
  PREKEY_BATCH_DELAY: 100,
  CONNECTION_VERIFY_INTERVAL: 5000,
  LENIENT_PING_TIMEOUT: true,
}

const preKeyWriteQueue = new Map()

const sanitizeFileName = (fileName) => {
  if (!fileName) return fileName
  return fileName.replace(/::/g, "__").replace(/:/g, "-").replace(/\//g, "_").replace(/\\/g, "_")
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
    this.activeOperations = 0
    this.bulkWriteInProgress = false
    this.lastVerifiedAt = 0

    const storageMode = process.env.STORAGE_MODE || "mongodb"

    this._initConnection()
    this._startHealthCheck()

    if (storageMode === "mongodb") {
      logger.info("MongoDB PRIMARY - metadata + auth storage")
    } else {
      logger.info("MongoDB SECONDARY - web detection + auth backup")
    }
  }

  async _verifyConnection() {
    if (!this.isConnected || !this.client) return false

    const now = Date.now()
    if (now - this.lastVerifiedAt < CONFIG.CONNECTION_VERIFY_INTERVAL) {
      return true
    }

    try {
      await Promise.race([
        this.client.db("admin").command({ ping: 1 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("ping timeout")), 30000)),
      ])
      this.lastVerifiedAt = now
      return true
    } catch (error) {
  if (CONFIG.LENIENT_PING_TIMEOUT && error.message.includes("ping timeout")) {
    logger.warn(`MongoDB ping timeout (lenient mode - continuing operations)`)
    this.lastVerifiedAt = now
    return true // Still return true to allow operations
  }
}
  }

  async _initConnection() {
    if (this.isConnecting || this.shutdownRequested) return

    if (this.activeOperations > 0) {
      logger.info(`Waiting for ${this.activeOperations} active operations to complete...`)
      const startWait = Date.now()

      while (this.activeOperations > 0 && Date.now() - startWait < 30000) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      if (this.activeOperations > 0) {
        logger.warn(`Reconnecting with ${this.activeOperations} operations still active`)
      }
    }

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
        retryWrites: true,
        retryReads: true,
        waitQueueTimeoutMS: 30000,
        maxIdleTimeMS: 60000,
        connectTimeoutMS: 30000,
        heartbeatFrequencyMS: 10000,
      })

      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), CONFIG.CONNECTION_TIMEOUT)),
      ])

      await this.client.db("admin").command({ ping: 1 })

      this.db = this.client.db()
      this.sessions = this.db.collection("sessions")
      this.authBaileys = this.db.collection("auth_baileys")

      await this._createIndexes()

      this.isConnected = true
      this.isConnecting = false
      this.reconnectAttempts = 0
      this.lastVerifiedAt = Date.now()

      logger.info("MongoDB connected successfully")

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

  _setupConnectionMonitoring() {
    if (!this.client) return

    this.client.on("close", () => {
      logger.warn("MongoDB client connection closed")
      this.isConnected = false
    })

    this.client.on("error", (error) => {
      logger.error(`MongoDB client error: ${error.message}`)
      this.isConnected = false
    })

    this.client.on("timeout", () => {
      logger.warn("MongoDB client timeout")
      this.isConnected = false
    })
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || this.shutdownRequested) return

    const delay = Math.min(CONFIG.RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts), CONFIG.RECONNECT_DELAY * 16)

    logger.info(`Reconnecting in ${delay / 1000}s...`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this._initConnection()
    }, delay)
  }

  _startHealthCheck() {
    this.healthCheckTimer = setInterval(async () => {
      if (this.isConnecting || this.shutdownRequested || this.activeOperations > 10 || this.bulkWriteInProgress) {
        return
      }

      if (this.isConnected && this.client) {
        try {
          await Promise.race([
            this.client.db("admin").command({ ping: 1 }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
          ])
          this.lastVerifiedAt = Date.now()
        } catch (error) {
          logger.warn("MongoDB health check failed - reconnecting...")
          this.isConnected = false
          this._scheduleReconnect()
        }
      } else if (!this.reconnectTimer && this.activeOperations === 0) {
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
      await this.sessions.createIndex({ sessionId: 1 }, { unique: true })
      await this.sessions.createIndex({ source: 1, detected: 1 })
      await this.sessions.createIndex({ source: 1, connectionStatus: 1, isConnected: 1, detected: 1 })
      await this.sessions.createIndex({ updatedAt: -1 })

      await this.authBaileys.createIndex({ sessionId: 1, filename: 1 }, { unique: true })
      await this.authBaileys.createIndex({ sessionId: 1 })

      logger.debug("MongoDB indexes created")
    } catch (error) {
      if (!error.message.includes("already exists")) {
        logger.debug(`Index creation: ${error.message}`)
      }
    }
  }

  async saveSession(sessionId, sessionData) {
    if (!this.isConnected || !this.sessions) return false

    this.activeOperations++

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
        maxTimeMS: 5000,
      })

      if (result.acknowledged) {
        logger.debug(`Saved session metadata: ${sessionId}`)
      }

      return result.acknowledged
    } catch (error) {
      if (!this._isSilentError(error)) {
        logger.error(`MongoDB save failed for ${sessionId}: ${error.message}`)
      }
      return false
    } finally {
      this.activeOperations--
    }
  }

  async getSession(sessionId) {
    if (!this.isConnected || !this.sessions) return null

    this.activeOperations++

    try {
      const session = await this.sessions.findOne({ sessionId }, { maxTimeMS: 5000 })

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
      if (!this._isSilentError(error)) {
        logger.error(`Failed to get session ${sessionId}: ${error.message}`)
      }
      return null
    } finally {
      this.activeOperations--
    }
  }

  async updateSession(sessionId, updates) {
    if (!this.isConnected || !this.sessions) return false

    this.activeOperations++

    try {
      const updateDoc = {
        ...updates,
        updatedAt: new Date(),
      }

      if (updates.detected === true && !updates.detectedAt) {
        updateDoc.detectedAt = new Date()
      }

      const result = await this.sessions.updateOne(
        { sessionId },
        { $set: updateDoc },
        {
          writeConcern: { w: 1, j: false },
          maxTimeMS: 5000,
        },
      )

      if (result.acknowledged && result.modifiedCount > 0) {
        logger.debug(`Updated session: ${sessionId}`)
      }

      return result.acknowledged
    } catch (error) {
      if (!this._isSilentError(error)) {
        logger.error(`MongoDB update failed for ${sessionId}: ${error.message}`)
      }
      return false
    } finally {
      this.activeOperations--
    }
  }

  async deleteSession(sessionId) {
    if (!this.isConnected || !this.sessions) return false

    this.activeOperations++

    try {
      const result = await this.sessions.deleteOne({ sessionId }, { maxTimeMS: 5000 })

      if (result.deletedCount > 0) {
        logger.info(`Deleted session metadata: ${sessionId}`)
      }

      return result.deletedCount > 0
    } catch (error) {
      if (!this._isSilentError(error)) {
        logger.error(`Failed to delete session ${sessionId}: ${error.message}`)
      }
      return false
    } finally {
      this.activeOperations--
    }
  }

  async getAllSessions() {
    if (!this.isConnected || !this.sessions) return []

    this.activeOperations++

    try {
      const sessions = await this.sessions.find({}).sort({ updatedAt: -1 }).limit(1000).maxTimeMS(10000).toArray()

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
      if (!this._isSilentError(error)) {
        logger.error(`Failed to get all sessions: ${error.message}`)
      }
      return []
    } finally {
      this.activeOperations--
    }
  }

  async getUndetectedWebSessions() {
    if (!this.isConnected || !this.sessions) {
      logger.debug("MongoDB not connected - cannot get undetected web sessions")
      return []
    }

    if (this.activeOperations > 50) {
      return []
    }

    this.activeOperations++

    try {
      const sessions = await this.sessions
        .find({
          source: "web",
          connectionStatus: "connected",
          isConnected: true,
          detected: { $ne: true },
        })
        .sort({ updatedAt: -1 })
        .limit(500)
        .maxTimeMS(5000)
        .toArray()

      const now = Date.now()
      const readySessions = sessions.filter((s) => {
        const age = now - new Date(s.updatedAt).getTime()
        return age >= 5000
      })

      if (readySessions.length > 0) {
        logger.info(`Found ${readySessions.length} undetected web sessions`)
      }

      return readySessions.map((s) => ({
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
      if (!this._isSilentError(error)) {
        logger.error(`Failed to get undetected web sessions: ${error.message}`)
      }
      return []
    } finally {
      this.activeOperations--
    }
  }

  async readAuthData(sessionId, fileName) {
    if (!(await this._verifyConnection()) || !this.authBaileys) return null

    this.activeOperations++

    try {
      const sanitized = sanitizeFileName(fileName)

      const result = await this.authBaileys.findOne(
        {
          sessionId,
          filename: sanitized,
        },
        {
          projection: { datajson: 1 },
          readPreference: "primaryPreferred",
          maxTimeMS: 5000,
        },
      )

      if (result?.datajson) {
        logger.debug(`Read auth: ${sessionId}/${fileName}`)
        return result.datajson
      }

      return null
    } catch (error) {
      if (!this._isSilentError(error)) {
        logger.debug(`Auth read failed ${sessionId}/${fileName}: ${error.message}`)
      }
      return null
    } finally {
      this.activeOperations--
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

    if (queue.timer) {
      clearTimeout(queue.timer)
    }

    queue.timer = setTimeout(() => {
      this._flushPreKeyBatch(sessionId)
    }, CONFIG.PREKEY_BATCH_DELAY)

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

    if (!(await this._verifyConnection()) || !this.authBaileys) {
      logger.warn(`Batch write skipped for ${sessionId} - MongoDB not connected`)
      return
    }

    this.activeOperations++
    this.bulkWriteInProgress = true

    try {
      const bulkOps = writes.map(({ fileName, data }) => ({
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

      logger.debug(`Batch wrote ${writes.length} pre-keys for ${sessionId}`)
    } catch (error) {
      if (!this._isSilentError(error)) {
        logger.error(`Batch pre-key write failed for ${sessionId}: ${error.message}`)
      }
    } finally {
      this.activeOperations--
      setTimeout(() => {
        if (this.activeOperations === 0) {
          this.bulkWriteInProgress = false
        }
      }, 1000)
    }
  }

  async _writeAuthDataDirect(sessionId, fileName, data) {
    if (!(await this._verifyConnection()) || !this.authBaileys) {
      logger.warn(`Auth write skipped for ${sessionId}/${fileName} - MongoDB not connected`)
      return false
    }

    this.activeOperations++

    try {
      const sanitized = sanitizeFileName(fileName)

      const result = await this.authBaileys.updateOne(
        {
          sessionId,
          filename: sanitized,
        },
        {
          $set: {
            sessionId,
            filename: sanitized,
            datajson: data,
            updatedAt: new Date(),
          },
        },
        {
          upsert: true,
          writeConcern: { w: 1, j: false },
          maxTimeMS: 10000,
        },
      )

      if (result.acknowledged) {
        logger.debug(`Wrote auth: ${sessionId}/${fileName}`)
      }

      return result.acknowledged
    } catch (error) {
      if (!this._isSilentError(error)) {
        logger.error(`Auth write failed ${sessionId}/${fileName}: ${error.message}`)
      }
      return false
    } finally {
      this.activeOperations--
    }
  }

  async deleteAuthData(sessionId, fileName) {
    if (!this.isConnected || !this.authBaileys) return false

    this.activeOperations++

    try {
      const sanitized = sanitizeFileName(fileName)

      const result = await this.authBaileys.deleteOne(
        {
          sessionId,
          filename: sanitized,
        },
        { maxTimeMS: 5000 },
      )

      return result.deletedCount > 0
    } catch (error) {
      if (!this._isSilentError(error)) {
        logger.debug(`Auth delete failed ${sessionId}/${fileName}: ${error.message}`)
      }
      return false
    } finally {
      this.activeOperations--
    }
  }

  async deleteAuthState(sessionId) {
    if (!this.isConnected || !this.authBaileys) return false

    this.activeOperations++

    try {
      const result = await this.authBaileys.deleteMany({ sessionId }, { maxTimeMS: 10000 })

      if (result.deletedCount > 0) {
        logger.info(`Deleted ${result.deletedCount} auth docs: ${sessionId}`)
      }

      return result.deletedCount > 0
    } catch (error) {
      if (!this._isSilentError(error)) {
        logger.error(`Failed to delete auth state ${sessionId}: ${error.message}`)
      }
      return false
    } finally {
      this.activeOperations--
    }
  }

  async getAllAuthFiles(sessionId) {
    if (!this.isConnected || !this.authBaileys) return []

    this.activeOperations++

    try {
      const files = await this.authBaileys.find({ sessionId }).project({ filename: 1 }).maxTimeMS(5000).toArray()

      return files.map((f) => f.filename)
    } catch (error) {
      if (!this._isSilentError(error)) {
        logger.error(`Failed to get auth files for ${sessionId}: ${error.message}`)
      }
      return []
    } finally {
      this.activeOperations--
    }
  }

  async hasValidAuthData(sessionId) {
    if (!this.isConnected || !this.authBaileys) return false

    this.activeOperations++

    try {
      const creds = await this.authBaileys.findOne(
        {
          sessionId,
          filename: "creds.json",
        },
        { maxTimeMS: 5000 },
      )

      if (!creds?.datajson) return false

      const parsed = typeof creds.datajson === "string" ? JSON.parse(creds.datajson) : creds.datajson

      return !!(parsed?.noiseKey && parsed?.signedIdentityKey)
    } catch (error) {
      if (!this._isSilentError(error)) {
        logger.debug(`Auth validation failed ${sessionId}: ${error.message}`)
      }
      return false
    } finally {
      this.activeOperations--
    }
  }

  async findOrphanedSessions() {
    if (!this.isConnected || !this.sessions || !this.authBaileys) return []

    this.activeOperations++

    try {
      const allSessions = await this.sessions.find({}).maxTimeMS(10000).toArray()

      const orphans = []

      for (const session of allSessions) {
        const age = Date.now() - new Date(session.updatedAt || session.createdAt).getTime()

        if (age < 180000) continue

        const hasAuth = await this.authBaileys.findOne(
          {
            sessionId: session.sessionId,
            filename: "creds.json",
          },
          { maxTimeMS: 3000 },
        )

        if (!hasAuth) {
          orphans.push(session.sessionId)
        }
      }

      if (orphans.length > 0) {
        logger.info(`Found ${orphans.length} orphaned sessions in MongoDB`)
      }

      return orphans
    } catch (error) {
      if (!this._isSilentError(error)) {
        logger.error(`Failed to find orphaned sessions: ${error.message}`)
      }
      return []
    } finally {
      this.activeOperations--
    }
  }

  async completeCleanup(sessionId) {
    if (!this.isConnected) return { metadata: false, auth: false }

    const results = {
      metadata: false,
      auth: false,
    }

    this.activeOperations++

    try {
      if (this.sessions) {
        try {
          const metaResult = await this.sessions.deleteOne({ sessionId }, { maxTimeMS: 5000 })
          results.metadata = metaResult.deletedCount > 0

          if (!results.metadata) {
            const retryResult = await this.sessions.deleteOne({ sessionId }, { maxTimeMS: 5000 })
            results.metadata = retryResult.deletedCount > 0
          }

          logger.info(`MongoDB metadata delete: ${results.metadata ? "SUCCESS" : "NOT_FOUND"} for ${sessionId}`)
        } catch (error) {
          logger.error(`MongoDB metadata delete failed for ${sessionId}: ${error.message}`)
        }
      }

      if (this.authBaileys) {
        try {
          const authResult = await this.authBaileys.deleteMany({ sessionId }, { maxTimeMS: 10000 })
          results.auth = authResult.deletedCount > 0

          if (!results.auth) {
            const retryResult = await this.authBaileys.deleteMany({ sessionId }, { maxTimeMS: 10000 })
            results.auth = retryResult.deletedCount > 0
          }

          logger.info(`MongoDB auth delete: ${authResult.deletedCount} docs deleted for ${sessionId}`)
        } catch (error) {
          logger.error(`MongoDB auth delete failed for ${sessionId}: ${error.message}`)
        }
      }

      if (results.metadata || results.auth) {
        logger.info(`MongoDB cleanup complete: ${sessionId} (metadata: ${results.metadata}, auth: ${results.auth})`)
      } else {
        logger.warn(`MongoDB cleanup found nothing to delete for ${sessionId}`)
      }

      return results
    } catch (error) {
      logger.error(`MongoDB complete cleanup failed ${sessionId}: ${error.message}`)
      return results
    } finally {
      this.activeOperations--
    }
  }

  async deleteOldPreKeys(sessionId, maxToKeep = 500) {
    if (!this.isConnected || !this.authBaileys) return { deleted: 0 }

    this.activeOperations++

    try {
      const preKeyFiles = await this.authBaileys
        .find({
          sessionId,
          filename: { $regex: /^pre-?key/i },
        })
        .project({ filename: 1, updatedAt: 1 })
        .sort({ updatedAt: 1 })
        .maxTimeMS(10000)
        .toArray()

      if (preKeyFiles.length <= maxToKeep) {
        return { deleted: 0, total: preKeyFiles.length }
      }

      const toDeleteCount = preKeyFiles.length - maxToKeep
      const toDelete = preKeyFiles.slice(0, toDeleteCount).map((f) => f.filename)

      const result = await this.authBaileys.deleteMany(
        {
          sessionId,
          filename: { $in: toDelete },
        },
        { maxTimeMS: 10000 },
      )

      if (result.deletedCount > 0) {
        logger.info(`Deleted ${result.deletedCount} old pre-keys for ${sessionId}`)
      }

      return { deleted: result.deletedCount, total: preKeyFiles.length }
    } catch (error) {
      if (!this._isSilentError(error)) {
        logger.error(`Failed to delete old pre-keys for ${sessionId}: ${error.message}`)
      }
      return { deleted: 0, error: error.message }
    } finally {
      this.activeOperations--
    }
  }

  async getPreKeyCount(sessionId) {
    if (!this.isConnected || !this.authBaileys) return 0

    this.activeOperations++

    try {
      return await this.authBaileys.countDocuments(
        {
          sessionId,
          filename: { $regex: /^pre-?key/i },
        },
        { maxTimeMS: 5000 },
      )
    } catch (error) {
      if (!this._isSilentError(error)) {
        logger.debug(`Failed to count pre-keys for ${sessionId}: ${error.message}`)
      }
      return 0
    } finally {
      this.activeOperations--
    }
  }

  async cleanupAllPreKeys(maxToKeep = 500, threshold = 300) {
    if (!this.isConnected || !this.authBaileys) return { sessions: 0, deleted: 0 }

    this.activeOperations++

    try {
      const sessionsWithPreKeys = await this.authBaileys
        .aggregate(
          [
            { $match: { filename: { $regex: /^pre-?key/i } } },
            { $group: { _id: "$sessionId", count: { $sum: 1 } } },
            { $match: { count: { $gt: threshold } } },
          ],
          { maxTimeMS: 10000 },
        )
        .toArray()

      let totalDeleted = 0
      let sessionsProcessed = 0

      for (const session of sessionsWithPreKeys) {
        const result = await this.deleteOldPreKeys(session._id, maxToKeep)
        totalDeleted += result.deleted || 0
        sessionsProcessed++
      }

      if (totalDeleted > 0) {
        logger.info(`Bulk pre-key cleanup: ${totalDeleted} deleted across ${sessionsProcessed} sessions`)
      }

      return { sessions: sessionsProcessed, deleted: totalDeleted }
    } catch (error) {
      if (!this._isSilentError(error)) {
        logger.error(`Bulk pre-key cleanup failed: ${error.message}`)
      }
      return { sessions: 0, deleted: 0, error: error.message }
    } finally {
      this.activeOperations--
    }
  }

  _isSilentError(error) {
    const silentMessages = [
      "closed",
      "interrupted",
      "session that has ended",
      "Cannot use a session",
      "Client must be connected",
      "connection pool",
      "Socket connection establishment was cancelled",
    ]

    return silentMessages.some((msg) => error.message.includes(msg))
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

    if (this.activeOperations > 0) {
      logger.info(`Waiting for ${this.activeOperations} operations to complete before shutdown...`)
      const startWait = Date.now()

      while (this.activeOperations > 0 && Date.now() - startWait < 10000) {
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }

    if (this.client && this.isConnected) {
      try {
        await this.client.close(true)
        logger.info("MongoDB connection closed")
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

  getStats() {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      activeOperations: this.activeOperations,
      bulkWriteInProgress: this.bulkWriteInProgress,
      collections: {
        sessions: !!this.sessions,
        authBaileys: !!this.authBaileys,
      },
    }
  }
}
