import { createComponentLogger } from "../../utils/logger.js"
import { SessionState } from "./state.js"
import { WebSessionDetector } from "./detector.js"
import { SessionEventHandlers } from "./handlers.js"

const logger = createComponentLogger("SESSION_MANAGER")

const ENABLE_515_FLOW = process.env.ENABLE_515_FLOW === "true"

/**
 * SessionManager - Main orchestrator for WhatsApp sessions
 * Manages session lifecycle, connections, and state
 */
export class SessionManager {
  constructor(telegramBot = null, sessionDir = "./sessions") {
    // Core dependencies
    this.telegramBot = telegramBot
    this.sessionDir = sessionDir

    // Component instances (lazy loaded)
    this.storage = null
    this.connectionManager = null
    this.fileManager = null
    this.eventDispatcher = null

    // Session tracking
    this.activeSockets = new Map()
    this.sessionState = new SessionState()
    this.webSessionDetector = null

    // Session flags
    this.initializingSessions = new Set()
    this.voluntarilyDisconnected = new Set()
    this.detectedWebSessions = new Set()

    // 515 Flow tracking (only if enabled)
    if (ENABLE_515_FLOW) {
      this.sessions515Restart = new Set()
      this.completed515Restart = new Set()
    }

    // Configuration
    this.eventHandlersEnabled = false
    this.maxSessions = 200
    this.concurrencyLimit = 3 // Increased from 8 to 10
    this.isInitialized = false

    // Event handlers helper
    this.sessionEventHandlers = new SessionEventHandlers(this)

    this._startTrackingCleanup()
    this._startFailedSessionRetry()
    logger.info("Session manager created (maxSessions: 200)")
    logger.info(`515 Flow: ${ENABLE_515_FLOW ? "ENABLED" : "DISABLED"}`)
  }

  _startTrackingCleanup() {
    setInterval(() => {
      const now = Date.now()
      const activeIds = new Set(this.activeSockets.keys())
      let cleanedCount = 0

      // Helper to safely clean a Set
      const cleanSet = (set, name) => {
        const toRemove = []
        for (const sessionId of set) {
          // Only remove if NOT in active sockets
          if (!activeIds.has(sessionId)) {
            toRemove.push(sessionId)
          }
        }
        toRemove.forEach((id) => {
          set.delete(id)
          cleanedCount++
        })
      }

      cleanSet(this.initializingSessions, "initializingSessions")
      cleanSet(this.voluntarilyDisconnected, "voluntarilyDisconnected")
      cleanSet(this.detectedWebSessions, "detectedWebSessions")

      if (ENABLE_515_FLOW) {
        cleanSet(this.sessions515Restart, "sessions515Restart")
        cleanSet(this.completed515Restart, "completed515Restart")
      }

      if (cleanedCount > 0) {
        logger.debug(
          `Tracking cleanup: removed ${cleanedCount} stale entries, ${this.activeSockets.size} active sessions`,
        )
      }

      const memUsage = process.memoryUsage()
      logger.debug(
        `Memory: RSS ${Math.round(memUsage.rss / 1024 / 1024)}MB, Heap ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB/${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      )
    }, 60000) // Every minute
  }

  /**
   * Initialize dependencies and components
   */
  async initialize() {
    try {
      logger.info("Initializing session manager...")

      // Initialize storage
      await this._initializeStorage()

      // Initialize connection manager
      await this._initializeConnectionManager()

      // Only wait for MongoDB in MongoDB mode
    const storageMode = process.env.STORAGE_MODE || 'mongodb'
    if (storageMode === 'mongodb') {
      await this._waitForMongoDB()
    } else {
      logger.info("File mode - skipping MongoDB wait")
    }

      logger.info("Session manager initialization complete")
      return true
    } catch (error) {
      logger.error("Session manager initialization failed:", error)
      throw error
    }
  }

  /**
   * Initialize storage layer
   * @private
   */
  async _initializeStorage() {
    const { SessionStorage } = await import("../storage/index.js")
    this.storage = new SessionStorage()
    logger.info("Storage initialized")
  }

  /**
   * Initialize connection manager
   * @private
   */
  async _initializeConnectionManager() {
    const { ConnectionManager } = await import("../core/index.js")
    const { FileManager } = await import("../storage/index.js")

    this.fileManager = new FileManager(this.sessionDir)
    this.connectionManager = new ConnectionManager()
    this.connectionManager.initialize(this.fileManager, this.storage.isMongoConnected ? this.storage.client : null)

    logger.info("Connection manager initialized")
  }

  /**
 * Wait for MongoDB to be ready
 * @private
 */
async _waitForMongoDB(maxWaitTime = 90000) {
  const storageMode = process.env.STORAGE_MODE || 'mongodb'
  
  // In file mode, MongoDB connection is non-blocking (only for web detection)
  if (storageMode !== 'mongodb') {
    logger.info("File storage mode - continuing (MongoDB will connect in background for web detection)")
    
    // Try to set mongo client if already available
    if (this.storage.isMongoConnected && this.storage.client) {
      this.connectionManager.mongoClient = this.storage.client
    }
    
    return true
  }

  // In MongoDB mode, wait for connection
  const startTime = Date.now()
  let lastLogTime = 0

  while (Date.now() - startTime < maxWaitTime) {
    // Check if MongoDB is connected
    if (this.storage.isMongoConnected && this.storage.sessions) {
      this.connectionManager.mongoClient = this.storage.client
      logger.info("MongoDB ready for auth + metadata storage")
      return true
    }
    
    // Log progress every 3 seconds
    const elapsed = Date.now() - startTime
    if (elapsed - lastLogTime > 3000) {
      logger.debug(`Waiting for MongoDB... (${Math.round(elapsed/1000)}s/${Math.round(maxWaitTime/1000)}s)`)
      lastLogTime = elapsed
    }
    
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  // MongoDB not ready in time - continue anyway
  logger.info("MongoDB connection pending - will connect in background")
  return true
}

/**
 * Initialize existing sessions from database
 * Optimized for large-scale deployments with retry logic
 */
async initializeExistingSessions() {
  try {
    if (!this.storage) {
      await this.initialize()
    }

    // Only wait for MongoDB in MongoDB mode
    const storageMode = process.env.STORAGE_MODE || 'mongodb'
    if (storageMode === 'mongodb') {
      await this._waitForMongoDB()
    }

    const existingSessions = await this._getActiveSessionsFromDatabase()

    if (existingSessions.length === 0) {
      this.isInitialized = true
      this._enablePostInitializationFeatures()
      logger.info("No existing sessions to initialize")
      return { initialized: 0, total: 0 }
    }

    logger.info(`Found ${existingSessions.length} existing sessions`)

    const sessionsToProcess = existingSessions.slice(0, this.maxSessions)
    let initializedCount = 0
    const failedSessions = []

    // Conservative settings: 3 concurrent, 800ms stagger
    const effectiveConcurrency = 3
    const staggerDelay = 800
    const batchDelay = 1500
    
    const estimatedTime = Math.ceil((sessionsToProcess.length / effectiveConcurrency) * 3)
    logger.info(`Starting initialization with concurrency=${effectiveConcurrency} (estimated time: ${estimatedTime}s)`)

    // Process sessions in batches
    for (let i = 0; i < sessionsToProcess.length; i += effectiveConcurrency) {
      const batch = sessionsToProcess.slice(i, i + effectiveConcurrency)
      const batchNumber = Math.floor(i / effectiveConcurrency) + 1
      const totalBatches = Math.ceil(sessionsToProcess.length / effectiveConcurrency)
      
      logger.info(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} sessions)`)
      
      const results = await Promise.allSettled(
        batch.map(async (sessionData, batchIndex) => {
          const overallIndex = i + batchIndex
          
          // Stagger to avoid overwhelming WhatsApp
          await new Promise(resolve => setTimeout(resolve, batchIndex * staggerDelay))
          
          try {
            logger.info(`[${overallIndex + 1}/${sessionsToProcess.length}] Initializing ${sessionData.sessionId}`)
            
            const success = await this._initializeSession(sessionData)
            
            if (success) {
              logger.info(`✅ [${overallIndex + 1}/${sessionsToProcess.length}] ${sessionData.sessionId} initialized`)
              return { success: true, sessionData }
            } else {
              logger.warn(`❌ [${overallIndex + 1}/${sessionsToProcess.length}] ${sessionData.sessionId} failed`)
              return { success: false, sessionData }
            }
          } catch (error) {
            logger.error(`Failed to initialize ${sessionData.sessionId}:`, error.message)
            return { success: false, sessionData, error }
          }
        })
      )
      
      // Process results
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success) {
          initializedCount++
        } else if (result.status === 'fulfilled' && !result.value.success) {
          failedSessions.push(result.value.sessionData)
        }
      }
      
      const batchSuccessCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length
      logger.info(`Batch ${batchNumber}/${totalBatches} complete: ${batchSuccessCount}/${batch.length} succeeded (total: ${initializedCount}/${sessionsToProcess.length})`)
      
      // Delay between batches
      if (i + effectiveConcurrency < sessionsToProcess.length) {
        await new Promise((resolve) => setTimeout(resolve, batchDelay))
      }
    }

    // Retry failed sessions ONE at a time
    if (failedSessions.length > 0) {
      logger.info(`🔄 Retrying ${failedSessions.length} failed sessions...`)
      
      for (let i = 0; i < failedSessions.length; i++) {
        const sessionData = failedSessions[i]
        
        try {
          logger.info(`[Retry ${i + 1}/${failedSessions.length}] ${sessionData.sessionId}`)
          
          // Wait longer before retry
          await new Promise(resolve => setTimeout(resolve, 2000))
          
          const success = await this._initializeSession(sessionData)
          
          if (success) {
            initializedCount++
            logger.info(`✅ [Retry ${i + 1}/${failedSessions.length}] ${sessionData.sessionId} recovered`)
          } else {
            logger.warn(`❌ [Retry ${i + 1}/${failedSessions.length}] ${sessionData.sessionId} still failed`)
          }
        } catch (error) {
          logger.error(`Retry failed for ${sessionData.sessionId}:`, error.message)
        }
      }
    }

    this.isInitialized = true
    this._enablePostInitializationFeatures()

    logger.info(`✅ Initialization complete: ${initializedCount}/${sessionsToProcess.length} sessions (${failedSessions.length - (initializedCount - (sessionsToProcess.length - failedSessions.length))} failed)`)

    return { 
      initialized: initializedCount, 
      total: sessionsToProcess.length,
      failed: sessionsToProcess.length - initializedCount
    }
  } catch (error) {
    logger.error("Failed to initialize existing sessions:", error)
    return { initialized: 0, total: 0, failed: 0 }
  }
}

/**
 * Initialize a single session
 * @private
 */
async _initializeSession(sessionData) {
  if (this.voluntarilyDisconnected.has(sessionData.sessionId)) {
    return false
  }

  try {
    // Check auth availability
    const authAvailability = await this.connectionManager.checkAuthAvailability(sessionData.sessionId)

    if (authAvailability.preferred === "none") {
      // ✅ Mark session as needing attention - don't delete
      logger.warn(`No auth available for ${sessionData.sessionId} - marking for manual reconnection`)
      await this.storage.updateSession(sessionData.sessionId, {
        isConnected: false,
        connectionStatus: "auth_missing",
        reconnectAttempts: (sessionData.reconnectAttempts || 0) + 1
      })
      return false
    }

    // Create session
    const sock = await this.createSession(
      sessionData.userId,
      sessionData.phoneNumber,
      {},
      false,
      sessionData.source || "telegram",
      false,
    )

    if (!sock) {
      logger.warn(`Failed to create socket for ${sessionData.sessionId}`)
      await this.storage.updateSession(sessionData.sessionId, {
        isConnected: false,
        connectionStatus: "failed",
        reconnectAttempts: (sessionData.reconnectAttempts || 0) + 1
      })
      return false
    }

    return true
  } catch (error) {
    logger.error(`Session initialization failed for ${sessionData.sessionId}:`, error)
    await this.storage.updateSession(sessionData.sessionId, {
      isConnected: false,
      connectionStatus: "error",
      reconnectAttempts: (sessionData.reconnectAttempts || 0) + 1
    })
    return false
  }
}

/**
 * ✅ NEW: Retry failed sessions periodically
 */
_startFailedSessionRetry() {
  setInterval(async () => {
    if (!this.isInitialized) return

    try {
      const sessions = await this.storage.getAllSessions()
      const failedSessions = sessions.filter(s => 
        !s.isConnected && 
        s.connectionStatus !== "disconnected" &&
        !this.voluntarilyDisconnected.has(s.sessionId) &&
        !this.activeSockets.has(s.sessionId) &&
        (s.reconnectAttempts || 0) < 10 // Stop after 10 attempts
      )

      if (failedSessions.length > 0) {
        logger.info(`🔄 Retrying ${failedSessions.length} failed sessions...`)
        
        for (const sessionData of failedSessions.slice(0, 3)) { // Max 3 at a time
          await this._initializeSession(sessionData)
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }
    } catch (error) {
      logger.error("Failed session retry error:", error)
    }
  }, 300000) // Every 5 minutes
}

  /**
   * Get active sessions from database - use coordinator, not MongoDB directly
   * @private
   */
  async _getActiveSessionsFromDatabase() {
  try {
    const storageMode = process.env.STORAGE_MODE || 'mongodb'
    
    // FILE MODE: Scan actual session files on disk
    if (storageMode === 'file') {
      logger.info("📁 File mode: Scanning session files on disk...")
      return await this._getSessionsFromFileSystem()
    }
    
    // MONGODB MODE: Use database records
    logger.info("🗄️ MongoDB mode: Loading sessions from database...")
    const sessions = await this.storage.getAllSessions()

    // Filter for active sessions
    const activeSessions = sessions.filter((session) => {
      return (
        session.sessionId &&
        (session.phoneNumber || session.isConnected || ["connected", "connecting"].includes(session.connectionStatus))
      )
    })

    return activeSessions.map((session) => ({
      sessionId: session.sessionId,
      userId: session.telegramId || session.userId,
      telegramId: session.telegramId || session.userId,
      phoneNumber: session.phoneNumber,
      isConnected: session.isConnected !== undefined ? session.isConnected : false,
      connectionStatus: session.connectionStatus || "disconnected",
      source: session.source || "telegram",
      detected: session.detected !== false,
    }))
  } catch (error) {
    logger.error("Failed to get active sessions:", error)
    return []
  }
}

/**
 * 🆕 Scan file system for existing sessions (file mode only)
 * @private
 */
async _getSessionsFromFileSystem() {
  try {
    const fs = await import('fs/promises')
    const path = await import('path')
    
    // Check if sessions directory exists
    try {
      await fs.access(this.sessionDir)
    } catch {
      logger.info(`Sessions directory ${this.sessionDir} does not exist`)
      return []
    }

    // Read all directories in sessions folder
    const entries = await fs.readdir(this.sessionDir, { withFileTypes: true })
    const sessionFolders = entries.filter(entry => 
      entry.isDirectory() && entry.name.startsWith('session_')
    )

    logger.info(`Found ${sessionFolders.length} session folders in ${this.sessionDir}`)

    const validSessions = []

    // Check each folder for valid auth files
    for (const folder of sessionFolders) {
      const sessionId = folder.name
      const sessionPath = path.join(this.sessionDir, sessionId)
      const credsPath = path.join(sessionPath, 'creds.json')

      try {
        // Check if creds.json exists
        await fs.access(credsPath)
        
        // Read creds to extract phone number if available
        let phoneNumber = null
        try {
          const credsData = await fs.readFile(credsPath, 'utf8')
          const creds = JSON.parse(credsData)
          phoneNumber = creds.me?.id?.split(':')[0] || null
        } catch (credsError) {
          logger.debug(`Could not parse creds for ${sessionId}:`, credsError.message)
        }

        // Extract userId from sessionId (session_123456 -> 123456)
        const userId = sessionId.replace('session_', '')

        // Check PostgreSQL for additional metadata
        let dbSession = null
        try {
          dbSession = await this.storage.getSession(sessionId)
        } catch (dbError) {
          logger.debug(`No PostgreSQL record for ${sessionId}:`, dbError.message)
        }

        validSessions.push({
          sessionId,
          userId: dbSession?.userId || userId,
          telegramId: dbSession?.telegramId || userId,
          phoneNumber: phoneNumber || dbSession?.phoneNumber,
          isConnected: false, // Will be updated after connection
          connectionStatus: 'disconnected',
          source: dbSession?.source || 'telegram',
          detected: dbSession?.detected !== false,
        })

        logger.debug(`✅ Valid session found: ${sessionId} (phone: ${phoneNumber || 'unknown'})`)
      } catch (error) {
        // No creds.json = invalid session folder
        logger.debug(`⏭️ Skipping ${sessionId}: No valid auth files`)
      }
    }

    logger.info(`Found ${validSessions.length} valid sessions with auth files`)
    return validSessions
  } catch (error) {
    logger.error("Failed to scan file system for sessions:", error)
    return []
  }
}

  /**
   * Enable features after initialization
   * @private
   */
  _enablePostInitializationFeatures() {
    setTimeout(() => {
      this.enableEventHandlers()
      this._startWebSessionDetection()
    }, 2000)
  }

  /**
   * Enable event handlers for all active sessions
   */
  enableEventHandlers() {
    this.eventHandlersEnabled = true

for (const [sessionId, sock] of this.activeSockets) {
  if (sock?.user && sock.ws && sock.ws?.socket?._readyState === 1 && !sock.eventHandlersSetup) {
    this._setupEventHandlers(sock, sessionId).catch((error) => {
      logger.error(`Failed to setup handlers for ${sessionId}:`, error)
    })
  }
}

    logger.info("Event handlers enabled")
  }

  /**
   * Setup event handlers for a socket
   * @private
   */
  async _setupEventHandlers(sock, sessionId) {
    try {
      if (!sock || sock.eventHandlersSetup || !sock.user) {
        return
      }

   if (!sock.ws?.socket || sock.ws.socket._readyState !== 1) {
      return
    }

      const { EventDispatcher } = await import("../events/index.js")

      if (!this.eventDispatcher) {
        this.eventDispatcher = new EventDispatcher(this)
      }

      this.eventDispatcher.setupEventHandlers(sock, sessionId)
      sock.eventHandlersSetup = true

      // Flush buffer after setup
      if (sock.ev.isBuffering && sock.ev.isBuffering()) {
        sock.ev.flush()
      }

      logger.info(`Event handlers set up for ${sessionId}`)
    } catch (error) {
      logger.error(`Failed to setup event handlers for ${sessionId}:`, error)
    }
  }

  /**
   * Start web session detection
   * @private
   */
  _startWebSessionDetection() {
    if (this.webSessionDetector) {
      this.webSessionDetector.stop()
    }

    this.webSessionDetector = new WebSessionDetector(this.storage, this)
    this.webSessionDetector.start()

    logger.info("Web session detection started")
  }

  /**
   * Stop web session detection
   */
  stopWebSessionDetection() {
    if (this.webSessionDetector) {
      this.webSessionDetector.stop()
    }
  }

  /**
 * Create a new session
 */
async createSession(
  userId,
  phoneNumber = null,
  callbacks = {},
  isReconnect = false,
  source = "telegram",
  allowPairing = true,
) {
  const userIdStr = String(userId)
  const sessionId = userIdStr.startsWith("session_") ? userIdStr : `session_${userIdStr}`
   
  try {
    // Prevent duplicate session creation
    if (this.initializingSessions.has(sessionId)) {
      logger.warn(`Session ${sessionId} already initializing`)
      return this.activeSockets.get(sessionId)
    }

    // Only return existing session if it's actually connected
    if (this.activeSockets.has(sessionId) && !isReconnect) {
      const existingSocket = this.activeSockets.get(sessionId)
      const isConnected = existingSocket?.user && existingSocket?.ws?.socket?._readyState === 1

      if (isConnected) {
        logger.info(`Session ${sessionId} already exists and is connected`)
        return existingSocket
      } else {
        logger.warn(`Session ${sessionId} exists but not connected - allowing recreate`)
        // ✅ Only cleanup socket in memory, don't touch files
        await this._cleanupSocketInMemoryOnly(sessionId)
      }
    }

    // Check session limit
    if (this.activeSockets.size >= this.maxSessions) {
      throw new Error(`Maximum sessions limit (${this.maxSessions}) reached`)
    }

    this.initializingSessions.add(sessionId)
    logger.info(`Creating session ${sessionId} (source: ${source}, reconnect: ${isReconnect})`)

    // ✅ CRITICAL FIX: On reconnect, NEVER cleanup files
    if (isReconnect) {
      logger.info(`🔄 Reconnecting ${sessionId} - preserving ALL files (auth + store)`)
      // Only cleanup socket object in memory
      await this._cleanupSocketInMemoryOnly(sessionId)
    } else if (allowPairing) {
      // Only for NEW pairing requests
      const existingSocket = this.activeSockets.has(sessionId)
      const authAvailability = await this.connectionManager.checkAuthAvailability(sessionId)

      // Only cleanup if there's stale auth AND no active socket
      if (authAvailability.preferred !== "none" && !existingSocket) {
        logger.info(`Cleaning up stale auth for NEW pairing: ${sessionId}`)
        await this.performCompleteUserCleanup(sessionId)
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }

    // Create socket connection
    const sock = await this.connectionManager.createConnection(sessionId, phoneNumber, callbacks, allowPairing)

    if (!sock) {
      throw new Error("Failed to create socket connection")
    }

    // Store socket and state
    this.activeSockets.set(sessionId, sock)
    sock.connectionCallbacks = callbacks

    this.sessionState.set(sessionId, {
      userId: userIdStr,
      phoneNumber,
      source,
      isConnected: true,
      connectionStatus: "connected",
      callbacks: callbacks,
    })

    // Setup connection event handlers
    this.sessionEventHandlers.setupConnectionHandler(sock, sessionId, callbacks)
    this.sessionEventHandlers.setupCredsHandler(sock, sessionId)

    // Setup message/event handlers
    if (!sock.eventHandlersSetup) {
      await this._setupEventHandlers(sock, sessionId)
    }

    // Save to database
    await this.storage.saveSession(sessionId, {
      userId: userIdStr,
      telegramId: userIdStr,
      phoneNumber,
      isConnected: true,
      connectionStatus: "connected",
      reconnectAttempts: 0,
      source: source,
      detected: source === "web" ? false : true,
    })

    logger.info(`✅ Session ${sessionId} created successfully`)
    return sock
  } catch (error) {
    logger.error(`Failed to create session ${sessionId}:`, error)
    throw error
  } finally {
    this.initializingSessions.delete(sessionId)
  }
}

// ============================================================================
// ADD THIS NEW METHOD to session-manager.js
// Place it after createSession() method
// ============================================================================

/**
 * ✅ NEW: Cleanup socket in memory ONLY - don't touch any files
 * Use this for reconnections where we want to preserve auth
 */
async _cleanupSocketInMemoryOnly(sessionId) {
  try {
    logger.info(`🧹 Cleaning up socket in-memory only for ${sessionId}`)

    const sock = this.activeSockets.get(sessionId)
    
    if (sock) {
      // Flush event buffer if needed
      if (sock?.ev?.isBuffering?.()) {
        try {
          sock.ev.flush()
          logger.debug(`📤 Event buffer flushed for ${sessionId}`)
        } catch (flushError) {
          logger.warn(`Failed to flush buffer: ${flushError.message}`)
        }
      }

      // Remove event listeners
      if (sock.ev && typeof sock.ev.removeAllListeners === "function") {
        sock.ev.removeAllListeners()
        logger.debug(`🔇 Event listeners removed for ${sessionId}`)
      }

      // Close WebSocket connection
      if (sock.ws?.socket && sock.ws.socket._readyState === 1) {
        sock.ws.close(1000, "Reconnect")
        logger.debug(`🔌 WebSocket closed for ${sessionId}`)
      }

      // Clear socket properties in memory
      sock.user = null
      sock.eventHandlersSetup = false
      sock.connectionCallbacks = null
      sock._sessionStore = null
    }

    // Remove from in-memory tracking
    this.activeSockets.delete(sessionId)
    this.sessionState.delete(sessionId)

    logger.info(`✅ Socket cleaned up in-memory for ${sessionId} - files preserved`)
    return true
  } catch (error) {
    logger.error(`Failed to cleanup socket in-memory for ${sessionId}:`, error)
    return false
  }
}

  /**
   * Create a web session
   */
  async createWebSession(webSessionData) {
    const { sessionId, userId, phoneNumber } = webSessionData

    try {
      await this.storage.markSessionAsDetected(sessionId)
      this.detectedWebSessions.add(sessionId)

      logger.info(`Creating web session: ${sessionId}`)

      const sock = await this.createSession(
        userId,
        phoneNumber,
        {
          onConnected: () => {
            logger.info(`Web session ${sessionId} connected`)
          },
          onError: () => {
            this.detectedWebSessions.delete(sessionId)
            this.storage.markSessionAsDetected(sessionId, false).catch(() => {})
          },
        },
        false,
        "web",
        true,
      )

      return !!sock
    } catch (error) {
      logger.error(`Failed to create web session ${sessionId}:`, error)
      this.detectedWebSessions.delete(sessionId)
      await this.storage.markSessionAsDetected(sessionId, false)
      return false
    }
  }

  /**
   * Disconnect a session
   */
  async disconnectSession(sessionId, forceCleanup = false) {
    try {
      logger.info(`Disconnecting session ${sessionId} (force: ${forceCleanup})`)

      // ✅ CRITICAL: Cancel any active reconnection attempts
    const eventDispatcher = this.getEventDispatcher()
    const connectionHandler = eventDispatcher?.connectionEventHandler
    if (connectionHandler) {
      connectionHandler.cancelReconnection(sessionId)
    }

      const sessionData = await this.storage.getSession(sessionId)
      const isWebUser = sessionData?.source === "web"

      // Full cleanup if forced
      if (forceCleanup) {
        return await this.performCompleteUserCleanup(sessionId)
      }

      // Mark as voluntary disconnect
      this.initializingSessions.delete(sessionId)
      this.voluntarilyDisconnected.add(sessionId)
      this.detectedWebSessions.delete(sessionId)

      // Get and cleanup socket
      const sock = this.activeSockets.get(sessionId)
      if (sock) {
        await this._cleanupSocket(sessionId, sock)
      }

      // Remove from tracking
      this.activeSockets.delete(sessionId)
      this.sessionState.delete(sessionId)

      // Update database
      if (isWebUser) {
        await this.storage.updateSession(sessionId, {
          isConnected: false,
          connectionStatus: "disconnected",
        })
      } else {
        await this.storage.deleteSession(sessionId)
      }

      logger.info(`Session ${sessionId} disconnected`)
      return true
    } catch (error) {
      logger.error(`Failed to disconnect session ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Cleanup socket
   * @private
   */
  async _cleanupSocket(sessionId, sock) {
  try {
    logger.debug(`Cleaning up socket for ${sessionId}`)

    if (sock?.ev?.isBuffering?.()) {
      try {
        sock.ev.flush()
        logger.debug(`Event buffer flushed for ${sessionId}`)
      } catch (flushError) {
        logger.warn(`Failed to flush buffer: ${flushError.message}`)
      }
    }
    
    // ✅ Only cleanup store in memory, don't delete files
    if (sock._storeCleanup) {
      sock._storeCleanup()
    }

    // ✅ REMOVED: deleteSessionStore() call - don't delete message store on normal cleanup
    // Only delete on explicit logout via performCompleteUserCleanup()

    // Remove event listeners
    if (sock.ev && typeof sock.ev.removeAllListeners === "function") {
      sock.ev.removeAllListeners()
    }

    // Close WebSocket
    if (sock.ws?.socket && sock.ws.socket._readyState === 1) {
      sock.ws.close(1000, "Cleanup")
    }

    // Clear socket properties
    sock.user = null
    sock.eventHandlersSetup = false
    sock.connectionCallbacks = null
    sock._sessionStore = null

    logger.debug(`Socket cleaned up for ${sessionId}`)
    return true
  } catch (error) {
    logger.error(`Failed to cleanup socket for ${sessionId}:`, error)
    return false
  }
}

/**
 * Perform complete user cleanup (logout)
 * ⚠️ This is the ONLY method that should delete auth files
 */
async performCompleteUserCleanup(sessionId) {
  const results = { socket: false, database: false, authState: false, messageStore: false }

  try {
    logger.info(`🗑️ Performing COMPLETE cleanup for ${sessionId} (logout)`)

    const sessionData = await this.storage.getSession(sessionId)
    const isWebUser = sessionData?.source === "web"

    // Cleanup socket
    const sock = this.activeSockets.get(sessionId)
    if (sock) {
      results.socket = await this._cleanupSocket(sessionId, sock)
    }

    // Clear in-memory structures
    this.activeSockets.delete(sessionId)
    this.sessionState.delete(sessionId)
    this.initializingSessions.delete(sessionId)
    this.voluntarilyDisconnected.add(sessionId)
    this.detectedWebSessions.delete(sessionId)

    // ✅ Delete message store (./makeinstore)
    try {
      const { deleteSessionStore } = await import("../core/index.js")
      await deleteSessionStore(sessionId)
      results.messageStore = true
      logger.info(`✅ Message store deleted for ${sessionId}`)
    } catch (error) {
      logger.error(`Failed to delete message store: ${error.message}`)
    }

    // Delete from databases based on source
    if (isWebUser) {
      // For web users: Keep PostgreSQL record, only delete auth
      results.database = await this.storage.deleteSessionKeepUser(sessionId)
      logger.info(`Web user ${sessionId} account preserved in PostgreSQL`)
    } else {
      // For Telegram users: Complete deletion including auth
      results.database = await this.storage.completelyDeleteSession(sessionId)
      logger.info(`Telegram user ${sessionId} completely deleted from database`)
    }

    // ✅ Cleanup auth state files (./sessions/{sessionId})
    const authCleanupResults = await this.connectionManager.cleanupAuthState(sessionId)
    results.authState = authCleanupResults.mongodb || authCleanupResults.file

    logger.info(`✅ Complete cleanup for ${sessionId}:`, results)
    return results
  } catch (error) {
    logger.error(`Complete cleanup failed for ${sessionId}:`, error)
    return results
  }
}

  /**
   * Cleanup failed initialization
   * @private
   */
  async _cleanupFailedInitialization(sessionId) {
    try {
      const sock = this.activeSockets.get(sessionId)
      if (sock) {
        await this._cleanupSocket(sessionId, sock)
      }

      this.activeSockets.delete(sessionId)
      this.sessionState.delete(sessionId)
      this.initializingSessions.delete(sessionId)
      this.detectedWebSessions.delete(sessionId)
      this.voluntarilyDisconnected.delete(sessionId)

      await this.storage.completelyDeleteSession(sessionId)
      await this.connectionManager.cleanupAuthState(sessionId)

      logger.debug(`Failed initialization cleaned up for ${sessionId}`)
    } catch (error) {
      logger.error(`Failed to cleanup failed initialization for ${sessionId}:`, error)
    }
  }

/**
 * ✅ REPLACED: Don't cleanup files on reconnect
 */
async _cleanupExistingSession(sessionId) {
  try {
    logger.info(`Checking existing session ${sessionId} before reconnect`)
    
    const existingSession = await this.storage.getSession(sessionId)

    if (existingSession && !existingSession.isConnected) {
      logger.info(`Session ${sessionId} exists but disconnected - cleaning up in-memory only`)
      // ✅ Only cleanup socket in memory, preserve all files
      await this._cleanupSocketInMemoryOnly(sessionId)
    }
  } catch (error) {
    logger.error(`Failed to cleanup existing session ${sessionId}:`, error)
  }
}

/**
 * Get session socket
 */
getSession(sessionId) {
  const sock = this.activeSockets.get(sessionId)

  if (!sock && sessionId) {
    import("../utils/index.js").then(({ invalidateSessionLookupCache }) => {
      invalidateSessionLookupCache(sessionId)
    }).catch(err => {
      logger.error(`Failed to invalidate cache for ${sessionId}:`, err)
    })
  }

  return sock
}

  /**
   * Get session by WhatsApp JID
   */
  async getSessionByWhatsAppJid(jid) {
    if (!jid) return null

    try {
      const { getSessionByRemoteJid } = await import("../utils/session-lookup.js")
      return await getSessionByRemoteJid(jid, this)
    } catch (error) {
      logger.error(`Error in getSessionByWhatsAppJid:`, error)
      return null
    }
  }

  /**
   * Get all sessions from database
   */
  async getAllSessions() {
    return await this.storage.getAllSessions()
  }

  /**
   * Check if session is connected
   */
  async isSessionConnected(sessionId) {
    const session = await this.storage.getSession(sessionId)
    return session?.isConnected || false
  }

  /**
   * Check if session is really connected (socket + database)
   */
  async isReallyConnected(sessionId) {
    const sock = this.activeSockets.get(sessionId)
    const session = await this.storage.getSession(sessionId)
    return !!(sock && sock.user && session?.isConnected)
  }

  /**
   * Get session information
   */
  async getSessionInfo(sessionId) {
    const session = await this.storage.getSession(sessionId)
    const hasSocket = this.activeSockets.has(sessionId)
    const stateInfo = this.sessionState.get(sessionId)

    return {
      ...session,
      hasSocket,
      stateInfo,
    }
  }

  /**
   * Check if session is voluntarily disconnected
   */
  isVoluntarilyDisconnected(sessionId) {
    return this.voluntarilyDisconnected.has(sessionId)
  }

  /**
   * Clear voluntary disconnection flag
   */
  clearVoluntaryDisconnection(sessionId) {
    this.voluntarilyDisconnected.delete(sessionId)
  }

  /**
   * Check if web session is detected
   */
  isWebSessionDetected(sessionId) {
    return this.detectedWebSessions.has(sessionId)
  }

  /**
   * Get initialization status
   */
  getInitializationStatus() {
    return {
      isInitialized: this.isInitialized,
      activeSessions: this.activeSockets.size,
      initializingSessions: this.initializingSessions.size,
      eventHandlersEnabled: this.eventHandlersEnabled,
      webDetectionActive: this.webSessionDetector?.isRunning() || false,
      enable515Flow: ENABLE_515_FLOW,
    }
  }

  /**
   * Get statistics
   */
  async getStats() {
    try {
      const allSessions = await this.storage.getAllSessions()
      const connectedSessions = allSessions.filter((s) => s.isConnected)
      const telegramSessions = allSessions.filter((s) => s.source === "telegram" || !s.source)
      const webSessions = allSessions.filter((s) => s.source === "web")

      return {
        totalSessions: allSessions.length,
        connectedSessions: connectedSessions.length,
        telegramSessions: telegramSessions.length,
        webSessions: webSessions.length,
        detectedWebSessions: this.detectedWebSessions.size,
        activeSockets: this.activeSockets.size,
        eventHandlersEnabled: this.eventHandlersEnabled,
        maxSessions: this.maxSessions,
        isInitialized: this.isInitialized,
        enable515Flow: ENABLE_515_FLOW,
        storage: this.storage?.isConnected ? "Connected" : "Disconnected",
        webDetection: this.webSessionDetector?.isRunning() ? "Active" : "Inactive",
        mongoConnected: this.storage?.isMongoConnected || false,
        postgresConnected: this.storage?.isPostgresConnected || false,
        stateStats: this.sessionState.getStats(),
      }
    } catch (error) {
      logger.error("Failed to get stats:", error)
      return {
        error: "Failed to retrieve statistics",
        activeSockets: this.activeSockets.size,
      }
    }
  }

  /**
   * Shutdown session manager
   */
  async shutdown() {
    try {
      logger.info("Shutting down session manager...")

      // Stop web session detection
      this.stopWebSessionDetection()

      // Disconnect all sessions
      const disconnectPromises = []
      for (const sessionId of this.activeSockets.keys()) {
        disconnectPromises.push(this.disconnectSession(sessionId))
      }

      await Promise.allSettled(disconnectPromises)

      // Close storage
      if (this.storage) {
        await this.storage.close()
      }

      // Cleanup connection manager
      if (this.connectionManager) {
        await this.connectionManager.cleanup()
      }

      logger.info("Session manager shutdown complete")
    } catch (error) {
      logger.error("Shutdown error:", error)
    }
  }

  /**
   * Perform maintenance tasks
   */
  async performMaintenance() {
    try {
      logger.debug("Performing session manager maintenance")

      // Cleanup stale session states
      this.sessionState.cleanupStale()

      // Flush storage write buffers
      if (this.storage?.flushWriteBuffers) {
        await this.storage.flushWriteBuffers()
      }

      // Cleanup orphaned session files
      if (this.fileManager) {
        await this.fileManager.cleanupOrphanedSessions(this.storage)
      }
    } catch (error) {
      logger.error("Maintenance error:", error)
    }
  }

  /**
   * Get connection manager instance
   */
  getConnectionManager() {
    return this.connectionManager
  }

  /**
   * Get storage instance
   */
  getStorage() {
    return this.storage
  }

  /**
   * Get session state instance
   */
  getSessionState() {
    return this.sessionState
  }

  /**
   * Get event dispatcher instance
   */
  getEventDispatcher() {
    return this.eventDispatcher
  }
}

// Export singleton pattern functions
let sessionManagerInstance = null

/**
 * Initialize session manager singleton
 */
export function initializeSessionManager(telegramBot, sessionDir = "./sessions") {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager(telegramBot, sessionDir)
  }
  return sessionManagerInstance
}

/**
 * Get session manager instance
 */
export function getSessionManager() {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager(null, "./sessions")
  }
  return sessionManagerInstance
}

/**
 * Reset session manager (for testing)
 */
export function resetSessionManager() {
  sessionManagerInstance = null
}
