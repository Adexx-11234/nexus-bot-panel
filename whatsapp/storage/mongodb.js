import { MongoClient } from "mongodb"
import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("MONGODB_STORAGE")

/**
 * MongoDBStorage - Enhanced with write buffering during reconnection
 */
export class MongoDBStorage {
  constructor() {
    this.client = null
    this.db = null
    this.sessions = null
    this.isConnected = false
    this.isConnecting = false
    this.retryCount = 0
    this.connectionTimeout = 30000
    this.reconnectInterval = null
    this.healthCheckInterval = null
    this.aggressiveHealingInterval = null
    this.lastSuccessfulConnection = null
    this.lastSuccessfulOperation = null
    this.connectionAttempts = 0
    this.consecutiveFailures = 0
    this.inEmergencyMode = false

    // ✅ NEW: Write buffer for operations during disconnection
    this.writeBuffer = new Map() // key -> { operation, timestamp, retries }
    this.maxBufferSize = 1000
    this.maxBufferAge = 300000 // 5 minutes
    this.bufferProcessInterval = null

    this.minReconnectDelay = 2000
    this.maxReconnectDelay = 15000
    this.emergencyModeThreshold = 5
    this.emergencyCheckInterval = 5000

    this._initConnection()
    this._startHealthCheck()
    this._startAggressiveHealing()
    this._startBufferProcessor()
  }

  /**
   * ✅ NEW: Process buffered writes when connection is restored
   */
  _startBufferProcessor() {
    this.bufferProcessInterval = setInterval(async () => {
      if (!this.isConnected || this.writeBuffer.size === 0) return

      const now = Date.now()
      const toProcess = []
      const toDelete = []

      // Collect operations to process
      for (const [key, item] of this.writeBuffer.entries()) {
        // Remove stale operations
        if (now - item.timestamp > this.maxBufferAge) {
          toDelete.push(key)
          logger.warn(`[Buffer] Discarding stale operation: ${key}`)
          continue
        }

        // Skip if too many retries
        if (item.retries >= 3) {
          toDelete.push(key)
          logger.error(`[Buffer] Max retries exceeded for: ${key}`)
          continue
        }

        toProcess.push({ key, item })
      }

      // Process buffered operations
      if (toProcess.length > 0) {
        logger.info(`[Buffer] Processing ${toProcess.length} buffered operations...`)

        for (const { key, item } of toProcess) {
          try {
            await item.operation()
            toDelete.push(key)
            logger.debug(`[Buffer] ✅ Processed: ${key}`)
          } catch (error) {
            item.retries++
            logger.warn(`[Buffer] Retry ${item.retries} failed for ${key}: ${error.message}`)
            
            if (item.retries >= 3) {
              toDelete.push(key)
            }
          }
        }
      }

      // Clean up processed/failed operations
      for (const key of toDelete) {
        this.writeBuffer.delete(key)
      }

      if (toDelete.length > 0) {
        logger.info(`[Buffer] Cleaned ${toDelete.length} operations (${this.writeBuffer.size} remaining)`)
      }
    }, 2000) // Check every 2 seconds
  }

  /**
   * ✅ ENHANCED: Add to buffer if connection fails
   */
  async _executeWithBuffer(operation, operationName, bufferKey = null) {
    // If we're connected, try to execute directly
    if (this.isConnected && this.client) {
      try {
        if (this.client.topology && !this.client.topology.isConnected()) {
          throw new Error("Topology not connected")
        }

        const result = await operation()
        this.lastSuccessfulOperation = new Date()
        this.consecutiveFailures = 0
        return result
      } catch (error) {
        if (this._isConnectionError(error)) {
          logger.warn(`${operationName}: Connection error - buffering if possible`)
          this.isConnected = false
          this.consecutiveFailures++
          this._scheduleReconnection()
          
          // Fall through to buffering logic below
        } else {
          logger.error(`${operationName}: ${error.message}`)
          return null
        }
      }
    }

    // ✅ Buffer write operations during disconnection
    if (bufferKey && (operationName.includes('save') || operationName.includes('update') || operationName.includes('delete'))) {
      // Check buffer size limit
      if (this.writeBuffer.size >= this.maxBufferSize) {
        logger.error(`[Buffer] Buffer full (${this.maxBufferSize}), dropping operation: ${operationName}`)
        return null
      }

      // Add to buffer
      if (!this.writeBuffer.has(bufferKey)) {
        this.writeBuffer.set(bufferKey, {
          operation,
          timestamp: Date.now(),
          retries: 0,
          operationName
        })
        logger.info(`[Buffer] Queued: ${operationName} (buffer size: ${this.writeBuffer.size})`)
      } else {
        // Update existing buffer entry with latest operation
        const existing = this.writeBuffer.get(bufferKey)
        existing.operation = operation
        existing.timestamp = Date.now()
        logger.debug(`[Buffer] Updated: ${operationName}`)
      }

      // Schedule reconnection if not already scheduled
      if (!this.isConnecting && !this.reconnectInterval) {
        this._scheduleReconnection()
      }

      return null // Indicate buffered
    }

    // For read operations or unbufferable operations, just fail
    logger.warn(`${operationName}: Not connected, operation skipped`)
    return null
  }

 async _initConnection() {
  if (this.isConnecting) {
    logger.debug("Connection attempt already in progress")
    return
  }

  this.isConnecting = true
  this.connectionAttempts++

  try {
    const mongoUrl = process.env.MONGODB_URI || "mongodb://localhost:27017/whatsapp_bot"

    // FIXED: More conservative connection options
    const options = {
      maxPoolSize: 10, // Reduced from 30
      minPoolSize: 2,  // Reduced from 5
      maxIdleTimeMS: 600000, // Increased from 300000
      serverSelectionTimeoutMS: 30000, // Increased from 15000
      socketTimeoutMS: 45000, // Reduced from 300000
      connectTimeoutMS: 30000, // Increased from 15000
      retryWrites: true,
      retryReads: true,
      heartbeatFrequencyMS: 30000, // Increased from 10000 - less aggressive
      waitQueueTimeoutMS: 10000, // Increased from 5000
      monitorCommands: false,
      compressors: ['zlib'],
      zlibCompressionLevel: 6,
      family: 4,
      directConnection: false,
      // CRITICAL: Don't auto-close connections
      maxConnecting: 2,
      minHeartbeatFrequencyMS: 10000
    }

    // FIXED: Don't force close existing client during reconnection
    if (this.client) {
      try {
        // Only close if truly disconnected
        const topology = this.client.topology
        if (!topology || !topology.isConnected()) {
          await this.client.close(false) // Graceful close, not force
          this.client = null
          await new Promise(resolve => setTimeout(resolve, 1000)) // Wait before new client
        } else {
          // Connection still alive, reuse it
          logger.info("♻️ Reusing existing MongoDB connection")
          this.isConnected = true
          this.isConnecting = false
          this.consecutiveFailures = 0
          return
        }
      } catch (err) {
        logger.debug(`Old client cleanup: ${err.message}`)
        this.client = null
      }
    }

    logger.info(`🔄 Attempting MongoDB connection (attempt ${this.connectionAttempts})...`)

    this.client = new MongoClient(mongoUrl, options)

    await Promise.race([
      this.client.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Connection timeout")), 30000) // Increased timeout
      )
    ])

    // FIXED: Give MongoDB time to stabilize before ping
    await new Promise(resolve => setTimeout(resolve, 500))

    await Promise.race([
      this.client.db("admin").command({ ping: 1 }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Ping timeout")), 10000) // Increased timeout
      )
    ])

    this.db = this.client.db()
    this.sessions = this.db.collection("sessions")

    this._setupConnectionEvents()
    await this._createIndexes()

    this.isConnected = true
    this.isConnecting = false
    this.retryCount = 0
    this.consecutiveFailures = 0
    this.lastSuccessfulConnection = new Date()
    this.lastSuccessfulOperation = new Date()

    if (this.inEmergencyMode) {
      this.inEmergencyMode = false
      logger.info("✅ [RECOVERY] Exited emergency mode")
    }

    const attemptMsg = this.connectionAttempts > 1 
      ? ` (recovered after ${this.connectionAttempts} attempts)` 
      : ''
    logger.info(`✅ MongoDB connected successfully${attemptMsg}`)

    if (this.writeBuffer.size > 0) {
      logger.info(`📦 [Buffer] ${this.writeBuffer.size} operations queued for processing`)
    }

    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval)
      this.reconnectInterval = null
    }

  } catch (error) {
    this.isConnected = false
    this.isConnecting = false
    this.consecutiveFailures++
    
    if (this.consecutiveFailures >= this.emergencyModeThreshold && !this.inEmergencyMode) {
      this.inEmergencyMode = true
      logger.error(`❌ [EMERGENCY MODE] MongoDB failed ${this.consecutiveFailures} times`)
    }

    const logLevel = this.connectionAttempts <= 3 ? 'error' : 'warn'
    logger[logLevel](`MongoDB connection failed (attempt ${this.connectionAttempts}): ${error.message}`)

    this._scheduleReconnection()
  }
}

  _setupConnectionEvents() {
  if (!this.client) return
  
  // FIXED: Remove old listeners before adding new ones
  this.client.removeAllListeners()

  this.client.on('close', () => {
    // FIXED: Don't immediately mark as disconnected if we're in a healthy state
    if (this.consecutiveFailures < 2) {
      logger.debug("⚠️ MongoDB connection closed (will monitor)")
      return
    }
    
    logger.warn("⚠️ MongoDB connection closed")
    this.isConnected = false
    this.consecutiveFailures++
    this._scheduleReconnection()
  })

  this.client.on('error', (error) => {
    logger.error(`❌ MongoDB error: ${error.message}`)
    this.consecutiveFailures++
    
    // Only disconnect on serious errors
    if (error.message?.includes('connection') || error.message?.includes('closed')) {
      this.isConnected = false
      this._scheduleReconnection()
    }
  })

  this.client.on('timeout', () => {
    logger.warn("⏱️ MongoDB timeout")
    this.consecutiveFailures++
    
    // Don't immediately disconnect on timeout
    if (this.consecutiveFailures >= 3) {
      this.isConnected = false
      this._scheduleReconnection()
    }
  })

  this.client.on('serverHeartbeatFailed', (event) => {
    this.consecutiveFailures++
    
    // Only disconnect after multiple heartbeat failures
    if (this.consecutiveFailures >= 3) {
      logger.warn(`💔 Multiple heartbeat failures (${this.consecutiveFailures}), reconnecting`)
      this.isConnected = false
      this._scheduleReconnection()
    }
  })

  this.client.on('serverClosed', (event) => {
    logger.warn(`🔌 Server closed: ${event.address}`)
    this.isConnected = false
    this._scheduleReconnection()
  })

  this.client.on('topologyDescriptionChanged', (event) => {
    const newType = event.newDescription.type
    const oldType = event.previousDescription.type
    
    if (newType === 'Unknown' || newType === 'ReplicaSetNoPrimary') {
      logger.warn(`⚠️ Topology changed to ${newType}`)
      this.consecutiveFailures++
      
      // Only disconnect after multiple topology issues
      if (this.consecutiveFailures >= 2) {
        this.isConnected = false
        this._scheduleReconnection()
      }
    } else if (oldType === 'Unknown' && newType !== 'Unknown') {
      logger.info(`✅ Topology recovered: ${oldType} -> ${newType}`)
      this.isConnected = true
      this.consecutiveFailures = 0
    }
  })
}

  _scheduleReconnection() {
    if (this.reconnectInterval) return

    let delay
    if (this.inEmergencyMode) {
      delay = this.emergencyCheckInterval
    } else {
      delay = Math.min(
        this.maxReconnectDelay, 
        this.minReconnectDelay * Math.pow(2, Math.min(this.retryCount, 3))
      )
    }
    
    this.retryCount++

    const mode = this.inEmergencyMode ? '[EMERGENCY]' : ''
    const bufferInfo = this.writeBuffer.size > 0 ? ` (${this.writeBuffer.size} ops buffered)` : ''
    logger.info(`🔄 ${mode} Reconnecting in ${delay / 1000}s${bufferInfo}`)

    this.reconnectInterval = setInterval(() => {
      if (!this.isConnected && !this.isConnecting) {
        this._initConnection()
      }
    }, delay)
  }

  // ALSO FIX: Less aggressive health check
_startHealthCheck() {
  this.healthCheckInterval = setInterval(async () => {
    if (this.isConnecting) return

    if (this.isConnected && this.client) {
      try {
        // FIXED: Quick check without forcing reconnection on single failure
        await Promise.race([
          this.client.db("admin").command({ ping: 1 }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Health check timeout")), 5000)
          )
        ])
        
        this.lastSuccessfulOperation = new Date()
        
        if (this.consecutiveFailures > 0) {
          this.consecutiveFailures = 0
          if (this.retryCount > 0) {
            logger.info("✅ Health check passed, connection stable")
            this.retryCount = 0
          }
        }
      } catch (error) {
        this.consecutiveFailures++
        
        // FIXED: Only reconnect after 2 consecutive failures
        if (this.consecutiveFailures >= 2) {
          logger.warn(`⚠️ Health check failed ${this.consecutiveFailures} times: ${error.message}`)
          this.isConnected = false
          this._scheduleReconnection()
        }
      }
    } else if (!this.isConnected && !this.reconnectInterval) {
      this._scheduleReconnection()
    }
  }, 30000) // FIXED: Check every 30 seconds instead of 15
}

 _startAggressiveHealing() {
  this.aggressiveHealingInterval = setInterval(async () => {
    if (this.isConnecting || !this.lastSuccessfulOperation) return

    const timeSinceLastSuccess = Date.now() - this.lastSuccessfulOperation
    
    // FIXED: Wait 5 minutes before force reconnect (was 2 minutes)
    if (timeSinceLastSuccess > 300000 && this.isConnected) {
      logger.warn(`⚠️ [AUTO-HEAL] No operations for ${Math.round(timeSinceLastSuccess/1000)}s, forcing reconnect`)
      this.isConnected = false
      this.consecutiveFailures++
      
      if (this.client) {
        try {
          await this.client.close(false) // Graceful close
        } catch (err) {
          logger.debug(`Force close error: ${err.message}`)
        }
      }
      
      this._scheduleReconnection()
    }
    
    if (this.inEmergencyMode && timeSinceLastSuccess > 600000) {
      logger.error("❌ [AUTO-HEAL] Emergency mode for 10+ minutes, attempting full reset")
      
      if (this.reconnectInterval) {
        clearInterval(this.reconnectInterval)
        this.reconnectInterval = null
      }
      
      this.retryCount = 0
      this.connectionAttempts = 0
      this.isConnecting = false
      
      setTimeout(() => {
        this._initConnection()
      }, 5000)
    }
  }, 60000) // FIXED: Check every 60 seconds instead of 30
}

  async _createIndexes() {
    if (!this.sessions) return

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
        await Promise.race([
          this.sessions.createIndex(indexDef.key, {
            name: indexDef.name,
            background: true,
            unique: indexDef.unique || false,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Index creation timeout")), 10000)
          )
        ])
      } catch (error) {
        if (!error.message.includes("already exists") && 
            !error.message.includes("timeout")) {
          logger.warn(`Index creation failed for ${indexDef.name}: ${error.message}`)
        }
      }
    }
  }

  _isConnectionError(error) {
    const errorStr = error.message?.toLowerCase() || ''
    const connectionErrors = [
      'connection',
      'disconnected',
      'topology',
      'econnrefused',
      'etimedout',
      'pool destroyed',
      'server selection',
      'mongonetworkerror',
      'mongoservererror',
      'must be connected',
      'not connected',
      'socket',
      'closed'
    ]
    
    return connectionErrors.some(msg => errorStr.includes(msg))
  }

  // ✅ UPDATED: All write operations now use buffering
  async saveSession(sessionId, sessionData) {
    const bufferKey = `save:${sessionId}`
    
    return await this._executeWithBuffer(async () => {
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
    }, `saveSession(${sessionId})`, bufferKey) || false
  }

  async getSession(sessionId) {
    return await this._executeWithBuffer(async () => {
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
    }, `getSession(${sessionId})`, null) // No buffering for reads
  }

  async updateSession(sessionId, updates) {
    const bufferKey = `update:${sessionId}`
    
    return await this._executeWithBuffer(async () => {
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
    }, `updateSession(${sessionId})`, bufferKey) || false
  }

  async deleteSession(sessionId) {
    const bufferKey = `delete:${sessionId}`
    
    return await this._executeWithBuffer(async () => {
      const result = await this.sessions.deleteOne({ sessionId })
      return result.deletedCount > 0
    }, `deleteSession(${sessionId})`, bufferKey) || false
  }

  async deleteAuthState(sessionId) {
    const bufferKey = `deleteAuth:${sessionId}`
    
    return await this._executeWithBuffer(async () => {
      const authCollection = this.db.collection("auth_baileys")
      const result = await authCollection.deleteMany({ sessionId })
      logger.info(`Deleted ${result.deletedCount} auth documents for ${sessionId}`)
      return result.deletedCount > 0
    }, `deleteAuthState(${sessionId})`, bufferKey) || false
  }

  async getAllSessions() {
    const result = await this._executeWithBuffer(async () => {
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
    }, 'getAllSessions()', null) // No buffering for reads

    return result || []
  }

  async getUndetectedWebSessions() {
    const result = await this._executeWithBuffer(async () => {
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
    }, 'getUndetectedWebSessions()', null) // No buffering for reads

    return result || []
  }

  getConnectionStatus() {
    const timeSinceLastSuccess = this.lastSuccessfulOperation 
      ? Date.now() - this.lastSuccessfulOperation 
      : null

    return {
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      inEmergencyMode: this.inEmergencyMode,
      lastSuccessfulConnection: this.lastSuccessfulConnection,
      lastSuccessfulOperation: this.lastSuccessfulOperation,
      connectionAttempts: this.connectionAttempts,
      consecutiveFailures: this.consecutiveFailures,
      retryCount: this.retryCount,
      secondsSinceLastSuccess: timeSinceLastSuccess ? Math.round(timeSinceLastSuccess / 1000) : null,
      writeBufferSize: this.writeBuffer.size
    }
  }

  async close() {
    try {
      // Clear all intervals
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval)
        this.healthCheckInterval = null
      }

      if (this.reconnectInterval) {
        clearInterval(this.reconnectInterval)
        this.reconnectInterval = null
      }

      if (this.aggressiveHealingInterval) {
        clearInterval(this.aggressiveHealingInterval)
        this.aggressiveHealingInterval = null
      }

      if (this.bufferProcessInterval) {
        clearInterval(this.bufferProcessInterval)
        this.bufferProcessInterval = null
      }

      // Warn about unsaved operations
      if (this.writeBuffer.size > 0) {
        logger.warn(`⚠️ Closing with ${this.writeBuffer.size} buffered operations unsaved`)
      }

      // Close client
      if (this.client && this.isConnected) {
        await this.client.close()
        this.isConnected = false
        logger.info("MongoDB connection closed gracefully")
      }
    } catch (error) {
      logger.error(`MongoDB close error: ${error.message}`)
    }
  }
}