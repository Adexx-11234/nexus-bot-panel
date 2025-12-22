import { getSessionManager } from '../../whatsapp/index.js'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('WEB_SESSION_SERVICE')

// Singleton instance
let serviceInstance = null

export class WebSessionService {
  constructor() {
    if (serviceInstance) {
      return serviceInstance
    }

    this.sessionManager = null
    this.pairingCodes = new Map()
    this.cleanupInterval = null

    serviceInstance = this
  }

  /**
   * Initialize service with session manager
   */
  initialize() {
    if (!this.sessionManager) {
      this.sessionManager = getSessionManager()
    }

    // Start cleanup interval
    if (!this.cleanupInterval) {
      this.cleanupInterval = setInterval(() => {
        this.cleanupExpiredPairingCodes()
      }, 60000) // Every minute
    }

    logger.info('Web session service initialized')
  }

  /**
   * Get session status
   */
  async getSessionStatus(sessionId) {
    try {
      if (!this.sessionManager) {
        this.initialize()
      }

      const session = await this.sessionManager.storage.getSession(sessionId)
      const hasActiveSocket = this.sessionManager.activeSockets.has(sessionId)
      const isReallyConnected = await this.sessionManager.isReallyConnected(sessionId)

      return {
        sessionId,
        isConnected: session?.isConnected || false,
        connectionStatus: session?.connectionStatus || 'disconnected',
        phoneNumber: session?.phoneNumber || null,
        hasActiveSocket,
        canReconnect: !hasActiveSocket && session?.phoneNumber,
        reconnectAttempts: session?.reconnectAttempts || 0,
        source: session?.source || 'web'
      }

    } catch (error) {
      logger.error('Get session status error:', error)
      return {
        sessionId,
        isConnected: false,
        connectionStatus: 'disconnected',
        phoneNumber: null,
        hasActiveSocket: false,
        canReconnect: false
      }
    }
  }

  /**
   * Create a new session
   */
  async createSession(userId, phoneNumber) {
    try {
      if (!this.sessionManager) {
        this.initialize()
      }

      const sessionId = `session_${userId}`

      // Check if session already exists and is connected
      const existingStatus = await this.getSessionStatus(sessionId)
      if (existingStatus.isConnected) {
        return { success: false, error: 'Session already connected' }
      }

      // Clear voluntary disconnection flag
      this.sessionManager.clearVoluntaryDisconnection(sessionId)

      // Create session with callbacks
      const callbacks = {
        onQR: (qr) => {
          logger.info(`QR code generated for ${sessionId}`)
          // QR code handling can be added here if needed
        },
        onPairingCode: (code) => {
          logger.info(`Pairing code generated for ${sessionId}: ${code}`)
          this.pairingCodes.set(sessionId, {
            code,
            timestamp: Date.now()
          })
        },
        onConnected: async () => {
          logger.info(`Session connected: ${sessionId}`)
          this.pairingCodes.delete(sessionId)
        },
        onError: (error) => {
          logger.error(`Session error for ${sessionId}:`, error)
        }
      }

      const sock = await this.sessionManager.createSession(
        userId,
        phoneNumber,
        callbacks,
        false,
        'web',
        true // Allow pairing
      )

      if (!sock) {
        return { success: false, error: 'Failed to create session' }
      }

      return {
        success: true,
        sessionId,
        message: 'Session created successfully'
      }

    } catch (error) {
      logger.error('Create session error:', error)
      return { success: false, error: error.message || 'Failed to create session' }
    }
  }

  /**
   * Get pairing code for session
   */
  async getPairingCode(sessionId) {
    try {
      const pairingData = this.pairingCodes.get(sessionId)

      if (!pairingData) {
        return null
      }

      // Check if code is still valid (90 seconds)
      const age = Date.now() - pairingData.timestamp
      if (age > 90000) {
        this.pairingCodes.delete(sessionId)
        return null
      }

      return pairingData.code

    } catch (error) {
      logger.error('Get pairing code error:', error)
      return null
    }
  }

  /**
   * Disconnect session
   */
  async disconnectSession(sessionId) {
    try {
      if (!this.sessionManager) {
        this.initialize()
      }

      const status = await this.getSessionStatus(sessionId)
      
      if (!status.hasActiveSocket && !status.isConnected) {
        return { success: false, error: 'No active session to disconnect' }
      }

      await this.sessionManager.disconnectSession(sessionId, false)

      // Clear pairing code
      this.pairingCodes.delete(sessionId)

      return {
        success: true,
        message: 'Session disconnected successfully'
      }

    } catch (error) {
      logger.error('Disconnect session error:', error)
      return { success: false, error: 'Failed to disconnect session' }
    }
  }

  /**
   * Reconnect existing session
   */
  async reconnectSession(sessionId) {
    try {
      if (!this.sessionManager) {
        this.initialize()
      }

      const status = await this.getSessionStatus(sessionId)

      if (status.isConnected && status.hasActiveSocket) {
        return { success: false, error: 'Session already connected' }
      }

      if (!status.phoneNumber) {
        return { success: false, error: 'No phone number found. Please create a new session.' }
      }

      // Clear voluntary disconnection
      this.sessionManager.clearVoluntaryDisconnection(sessionId)

      // Get user ID from sessionId
      const userId = sessionId.replace('session_', '')

      const callbacks = {
        onConnected: () => {
          logger.info(`Session reconnected: ${sessionId}`)
        },
        onError: (error) => {
          logger.error(`Reconnection error for ${sessionId}:`, error)
        }
      }

      const sock = await this.sessionManager.createSession(
        userId,
        status.phoneNumber,
        callbacks,
        true, // Is reconnect
        'web',
        false // Don't allow pairing on reconnect
      )

      if (!sock) {
        return { success: false, error: 'Failed to reconnect session' }
      }

      return {
        success: true,
        message: 'Reconnection initiated'
      }

    } catch (error) {
      logger.error('Reconnect session error:', error)
      return { success: false, error: 'Failed to reconnect session' }
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats(sessionId) {
    try {
      if (!this.sessionManager) {
        this.initialize()
      }

      const session = await this.sessionManager.storage.getSession(sessionId)
      const sock = this.sessionManager.getSession(sessionId)

      if (!session) {
        return {
          sessionId,
          isConnected: false,
          connectionStatus: 'disconnected',
          phoneNumber: null,
          reconnectAttempts: 0,
          uptime: null,
          lastConnected: null,
          createdAt: null
        }
      }

      // Calculate uptime if connected
      let uptime = null
      if (session.isConnected && sock) {
        const startTime = session.updatedAt || session.createdAt
        uptime = Date.now() - new Date(startTime).getTime()
      }

      return {
        sessionId: session.sessionId,
        isConnected: session.isConnected,
        connectionStatus: session.connectionStatus,
        phoneNumber: session.phoneNumber,
        reconnectAttempts: session.reconnectAttempts || 0,
        uptime,
        lastConnected: session.isConnected ? session.updatedAt : null,
        createdAt: session.createdAt
      }

    } catch (error) {
      logger.error('Get session stats error:', error)
      throw error
    }
  }

  /**
   * Get system statistics
   */
  async getSystemStats() {
    try {
      if (!this.sessionManager) {
        this.initialize()
      }

      const stats = await this.sessionManager.getStats()

      return {
        totalSessions: stats.totalSessions,
        connectedSessions: stats.connectedSessions,
        webSessions: stats.webSessions,
        activeSockets: stats.activeSockets,
        isInitialized: stats.isInitialized,
        eventHandlersEnabled: stats.eventHandlersEnabled
      }

    } catch (error) {
      logger.error('Get system stats error:', error)
      throw error
    }
  }

  /**
   * Cleanup expired pairing codes
   */
  async cleanupExpiredPairingCodes() {
    const now = Date.now()
    let cleanedCount = 0

    for (const [sessionId, data] of this.pairingCodes.entries()) {
      if (now - data.timestamp > 90000) {
        this.pairingCodes.delete(sessionId)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cleaned up ${cleanedCount} expired pairing codes`)
    }
  }

  /**
   * Shutdown service
   */
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    this.pairingCodes.clear()
    this.sessionManager = null

    logger.info('Web session service shutdown')
  }
}

// Export singleton instance getter
export function getWebSessionService() {
  if (!serviceInstance) {
    serviceInstance = new WebSessionService()
    serviceInstance.initialize()
  }
  return serviceInstance
}

// Export for direct instantiation if needed
export default WebSessionService