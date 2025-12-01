import { createComponentLogger } from '../../utils/logger.js'
import { SessionState } from './state.js'
import { WebSessionDetector } from './detector.js'
import { SessionEventHandlers } from './handlers.js'

const logger = createComponentLogger('SESSION_MANAGER')

// 515 Flow Toggle
const ENABLE_515_FLOW = process.env.ENABLE_515_FLOW === 'true'

/**
 * SessionManager - Main orchestrator for WhatsApp sessions
 * Manages session lifecycle, connections, and state
 */
export class SessionManager {
  constructor(telegramBot = null, sessionDir = './sessions') {
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
    this.concurrencyLimit = 8
    this.isInitialized = false

    // Event handlers helper
    this.sessionEventHandlers = new SessionEventHandlers(this)

    logger.info('Session manager created')
    logger.info(`515 Flow: ${ENABLE_515_FLOW ? 'ENABLED' : 'DISABLED'}`)
  }

  /**
   * Initialize dependencies and components
   */
  async initialize() {
    try {
      logger.info('Initializing session manager...')

      // Initialize storage
      await this._initializeStorage()

      // Initialize connection manager
      await this._initializeConnectionManager()

      // Wait for MongoDB connection
      await this._waitForMongoDB()

      logger.info('Session manager initialization complete')
      return true

    } catch (error) {
      logger.error('Session manager initialization failed:', error)
      throw error
    }
  }

  /**
   * Initialize storage layer
   * @private
   */
  async _initializeStorage() {
    const { SessionStorage } = await import('../storage/index.js')
    this.storage = new SessionStorage()
    logger.info('Storage initialized')
  }

  /**
   * Initialize connection manager
   * @private
   */
  async _initializeConnectionManager() {
    const { ConnectionManager } = await import('../core/index.js')
    const { FileManager } = await import('../storage/index.js')

    this.fileManager = new FileManager(this.sessionDir)
    this.connectionManager = new ConnectionManager()
    this.connectionManager.initialize(
      this.fileManager,
      this.storage.isMongoConnected ? this.storage.client : null
    )

    logger.info('Connection manager initialized')
  }

  /**
   * Wait for MongoDB to be ready
   * @private
   */
  async _waitForMongoDB(maxWaitTime = 10000) {
    const startTime = Date.now()
    
    while (Date.now() - startTime < maxWaitTime) {
      if (this.storage.isMongoConnected && this.storage.sessions) {
        // Update connection manager with mongo client
        this.connectionManager.mongoClient = this.storage.client
        return true
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    logger.warn('MongoDB not ready after waiting')
    return false
  }

  /**
   * Initialize existing sessions from database
   */
  async initializeExistingSessions() {
    try {
      if (!this.storage) {
        await this.initialize()
      }

      await this._waitForMongoDB()

      const existingSessions = await this._getActiveSessionsFromDatabase()

      if (existingSessions.length === 0) {
        this.isInitialized = true
        this._enablePostInitializationFeatures()
        logger.info('No existing sessions to initialize')
        return { initialized: 0, total: 0 }
      }

      logger.info(`Found ${existingSessions.length} existing sessions`)

      const sessionsToProcess = existingSessions.slice(0, this.maxSessions)
      let initializedCount = 0

      // Process in batches
      for (let i = 0; i < sessionsToProcess.length; i += this.concurrencyLimit) {
        const batch = sessionsToProcess.slice(i, i + this.concurrencyLimit)

        await Promise.all(batch.map(async (sessionData) => {
          try {
            const success = await this._initializeSession(sessionData)
            if (success) initializedCount++
          } catch (error) {
            logger.error(`Failed to initialize session ${sessionData.sessionId}:`, error)
          }
        }))

        // Brief pause between batches
        if (i + this.concurrencyLimit < sessionsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }

      this.isInitialized = true
      this._enablePostInitializationFeatures()

      logger.info(`Initialized ${initializedCount}/${sessionsToProcess.length} sessions`)

      return { initialized: initializedCount, total: sessionsToProcess.length }

    } catch (error) {
      logger.error('Failed to initialize existing sessions:', error)
      return { initialized: 0, total: 0 }
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
      const authAvailability = await this.connectionManager.checkAuthAvailability(
        sessionData.sessionId
      )

      if (authAvailability.preferred === 'none') {
        await this._cleanupFailedInitialization(sessionData.sessionId)
        return false
      }

      // Create session
      const sock = await this.createSession(
        sessionData.userId,
        sessionData.phoneNumber,
        {},
        false,
        sessionData.source || 'telegram',
        false // Don't allow pairing during initialization
      )

      if (!sock) {
        await this._cleanupFailedInitialization(sessionData.sessionId)
        return false
      }

      return true

    } catch (error) {
      logger.error(`Session initialization failed for ${sessionData.sessionId}:`, error)
      await this._cleanupFailedInitialization(sessionData.sessionId)
      return false
    }
  }

/**
 * Get active sessions from database - use coordinator, not MongoDB directly
 * @private
 */
async _getActiveSessionsFromDatabase() {
  try {
    // CRITICAL: Use coordinator, which handles fallback automatically
    const sessions = await this.storage.getAllSessions()
    
    // Filter for active sessions
    const activeSessions = sessions.filter(session => {
      return session.sessionId && (
        session.phoneNumber ||
        session.isConnected ||
        ['connected', 'connecting'].includes(session.connectionStatus)
      )
    })

    return activeSessions.map(session => ({
      sessionId: session.sessionId,
      userId: session.telegramId || session.userId,
      telegramId: session.telegramId || session.userId,
      phoneNumber: session.phoneNumber,
      isConnected: session.isConnected !== undefined ? session.isConnected : false,
      connectionStatus: session.connectionStatus || 'disconnected',
      source: session.source || 'telegram',
      detected: session.detected !== false
    }))

  } catch (error) {
    logger.error('Failed to get active sessions from database:', error)
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
      if (sock.user && sock.readyState === sock.ws?.OPEN && !sock.eventHandlersSetup) {
        this._setupEventHandlers(sock, sessionId).catch(error => {
          logger.error(`Failed to setup handlers for ${sessionId}:`, error)
        })
      }
    }

    logger.info('Event handlers enabled')
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

      if (sock.readyState !== sock.ws?.OPEN) {
        return
      }

      const { EventDispatcher } = await import('../events/index.js')

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

    logger.info('Web session detection started')
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
    source = 'telegram',
    allowPairing = true
  ) {
    const userIdStr = String(userId)
    const sessionId = userIdStr.startsWith('session_') ? userIdStr : `session_${userIdStr}`

    try {
      // Prevent duplicate session creation
      if (this.initializingSessions.has(sessionId)) {
        logger.warn(`Session ${sessionId} already initializing`)
        return this.activeSockets.get(sessionId)
      }

      // Only return existing session if it's actually connected
      if (this.activeSockets.has(sessionId) && !isReconnect) {
        const existingSocket = this.activeSockets.get(sessionId)
        const isConnected = existingSocket?.user && existingSocket?.readyState === existingSocket?.ws?.OPEN
        
        if (isConnected) {
          logger.info(`Session ${sessionId} already exists and is connected`)
          return existingSocket
        } else {
          logger.warn(`Session ${sessionId} exists but not connected - allowing recreate`)
          await this._cleanupExistingSession(sessionId)
        }
      }

      // Check session limit
      if (this.activeSockets.size >= this.maxSessions) {
        throw new Error(`Maximum sessions limit (${this.maxSessions}) reached`)
      }

      this.initializingSessions.add(sessionId)
      logger.info(`Creating session ${sessionId} (source: ${source})`)

      // Cleanup existing session if reconnecting
      if (isReconnect) {
        await this._cleanupExistingSession(sessionId)
      } else if (allowPairing) {
        // Check if there's stale auth that needs cleanup
        const existingSocket = this.activeSockets.has(sessionId)
        const authAvailability = await this.connectionManager.checkAuthAvailability(sessionId)
        
        // Only cleanup if there's BOTH old auth AND no active socket (stale session)
        if (authAvailability.preferred !== 'none' && !existingSocket) {
          logger.info(`Cleaning up stale auth for new pairing: ${sessionId}`)
          await this.performCompleteUserCleanup(sessionId)
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }

      // Create socket connection
      const sock = await this.connectionManager.createConnection(
        sessionId,
        phoneNumber,
        callbacks,
        allowPairing
      )

      if (!sock) {
        throw new Error('Failed to create socket connection')
      }

      // Store socket and state
      this.activeSockets.set(sessionId, sock)
      sock.connectionCallbacks = callbacks

      this.sessionState.set(sessionId, {
        userId: userIdStr,
        phoneNumber,
        source,
        isConnected: false,
        connectionStatus: 'connecting',
        callbacks: callbacks
      })

      // Setup connection event handlers (connection.update, creds.update)
      this.sessionEventHandlers.setupConnectionHandler(sock, sessionId, callbacks)
      this.sessionEventHandlers.setupCredsHandler(sock, sessionId)
      
      // Setup message/event handlers immediately (not waiting for connection to open)
      if (!sock.eventHandlersSetup) {
        await this._setupEventHandlers(sock, sessionId)
      }

      // Save to database - CRITICAL FIX
      await this.storage.saveSession(sessionId, {
        userId: userIdStr,
        telegramId: userIdStr,
        phoneNumber,
        isConnected: false,
        connectionStatus: 'connecting',
        reconnectAttempts: 0,
        source: source,
        detected: source === 'web' ? false : true
      })

      logger.info(`Session ${sessionId} created successfully`)
      return sock

    } catch (error) {
      logger.error(`Failed to create session ${sessionId}:`, error)
      throw error
    } finally {
      this.initializingSessions.delete(sessionId)
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
          }
        },
        false,
        'web',
        true
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

      const sessionData = await this.storage.getSession(sessionId)
      const isWebUser = sessionData?.source === 'web'

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
          connectionStatus: 'disconnected'
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
      // Remove event listeners
      if (sock.ev && typeof sock.ev.removeAllListeners === 'function') {
        sock.ev.removeAllListeners()
      }

      // Close WebSocket
      if (sock.ws && sock.ws.readyState === sock.ws.OPEN) {
        sock.ws.close(1000, 'Cleanup')
      }

      // Clear socket properties
      sock.user = null
      sock.eventHandlersSetup = false
      sock.connectionCallbacks = null

      logger.debug(`Socket cleaned up for ${sessionId}`)
      return true

    } catch (error) {
      logger.error(`Failed to cleanup socket for ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Perform complete user cleanup (logout)
   */
  async performCompleteUserCleanup(sessionId) {
    const results = { socket: false, database: false, authState: false }

    try {
      logger.info(`Performing complete cleanup for ${sessionId}`)

      const sessionData = await this.storage.getSession(sessionId)
      const isWebUser = sessionData?.source === 'web'

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

      // Delete from databases based on source
      if (isWebUser) {
        // For web users: Keep PostgreSQL record, only delete auth
        results.database = await this.storage.deleteSessionKeepUser(sessionId)
        logger.info(`Web user ${sessionId} account preserved`)
      } else {
        // For Telegram users: Complete deletion including auth
        results.database = await this.storage.completelyDeleteSession(sessionId)
        logger.info(`Telegram user ${sessionId} completely deleted`)
      }

      // Cleanup auth state files
      const authCleanupResults = await this.connectionManager.cleanupAuthState(sessionId)
      results.authState = authCleanupResults.mongodb || authCleanupResults.file

      logger.info(`Complete cleanup for ${sessionId}:`, results)
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
   * Cleanup existing session before reconnect
   * @private
   */
  async _cleanupExistingSession(sessionId) {
    try {
      const existingSession = await this.storage.getSession(sessionId)
      
      if (existingSession && !existingSession.isConnected) {
        await this.disconnectSession(sessionId)
      }

    } catch (error) {
      logger.error(`Failed to cleanup existing session ${sessionId}:`, error)
    }
  }

  /**
   * Get session socket
   */
  getSession(sessionId) {
    return this.activeSockets.get(sessionId)
  }

  /**
   * Get session by WhatsApp JID
   */
  async getSessionByWhatsAppJid(jid) {
    if (!jid) return null

    const phoneNumber = jid.split('@')[0].split(':')[0]

    for (const [sessionId, sock] of this.activeSockets) {
      if (sock?.user?.id) {
        const sessionPhone = sock.user.id.split('@')[0]
        if (sessionPhone === phoneNumber) {
          return { sock, sessionId }
        }
      }
    }

    return null
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
      stateInfo
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
      enable515Flow: ENABLE_515_FLOW
    }
  }

  /**
   * Get statistics
   */
  async getStats() {
    try {
      const allSessions = await this.storage.getAllSessions()
      const connectedSessions = allSessions.filter(s => s.isConnected)
      const telegramSessions = allSessions.filter(s => s.source === 'telegram' || !s.source)
      const webSessions = allSessions.filter(s => s.source === 'web')

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
        storage: this.storage?.isConnected ? 'Connected' : 'Disconnected',
        webDetection: this.webSessionDetector?.isRunning() ? 'Active' : 'Inactive',
        mongoConnected: this.storage?.isMongoConnected || false,
        postgresConnected: this.storage?.isPostgresConnected || false,
        stateStats: this.sessionState.getStats()
      }

    } catch (error) {
      logger.error('Failed to get stats:', error)
      return {
        error: 'Failed to retrieve statistics',
        activeSockets: this.activeSockets.size
      }
    }
  }

  /**
   * Shutdown session manager
   */
  async shutdown() {
    try {
      logger.info('Shutting down session manager...')

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

      logger.info('Session manager shutdown complete')

    } catch (error) {
      logger.error('Shutdown error:', error)
    }
  }

  /**
   * Perform maintenance tasks
   */
  async performMaintenance() {
    try {
      logger.debug('Performing session manager maintenance')

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
      logger.error('Maintenance error:', error)
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
export function initializeSessionManager(telegramBot, sessionDir = './sessions') {
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
    sessionManagerInstance = new SessionManager(null, './sessions')
  }
  return sessionManagerInstance
}

/**
 * Reset session manager (for testing)
 */
export function resetSessionManager() {
  sessionManagerInstance = null
}