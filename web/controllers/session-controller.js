import { WebSessionService } from '../services/web-session-service.js'
import { UserService } from '../services/user-service.js'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('SESSION_CONTROLLER')

export class SessionController {
  constructor() {
    this.sessionService = new WebSessionService()
    this.userService = new UserService()
  }

  async getSessionStatus(userId) {
    try {
      const sessionId = `session_${userId}`
      const status = await this.sessionService.getSessionStatus(sessionId)

      return {
        sessionId: status.sessionId,
        isConnected: status.isConnected,
        connectionStatus: status.connectionStatus,
        phoneNumber: status.phoneNumber,
        hasActiveSocket: status.hasActiveSocket,
        canReconnect: status.canReconnect
      }

    } catch (error) {
      logger.error('Get session status error:', error)
      throw error
    }
  }

  async createSession(userId, phoneNumber) {
    try {
      // Validate phone number
      const cleanPhone = this._cleanPhoneNumber(phoneNumber)
      if (!this._isValidPhoneNumber(cleanPhone)) {
        return { success: false, error: 'Invalid phone number format' }
      }

      // Check if session already exists
      const sessionId = `session_${userId}`
      const existingStatus = await this.sessionService.getSessionStatus(sessionId)
      
      if (existingStatus.isConnected) {
        return { success: false, error: 'Session already connected' }
      }

      // Create session
      const result = await this.sessionService.createSession(userId, cleanPhone)

      if (!result.success) {
        return { success: false, error: result.error }
      }

      // Update user phone number
      await this.userService.updateUser(userId, { phoneNumber: cleanPhone })

      logger.info(`Session created for user: ${userId}`)

      return {
        success: true,
        sessionId: result.sessionId,
        message: 'Session created. Please scan QR code or enter pairing code.'
      }

    } catch (error) {
      logger.error('Create session error:', error)
      return { success: false, error: 'Failed to create session' }
    }
  }

  async getPairingCode(userId) {
    try {
      const sessionId = `session_${userId}`
      const pairingCode = await this.sessionService.getPairingCode(sessionId)

      return pairingCode

    } catch (error) {
      logger.error('Get pairing code error:', error)
      return null
    }
  }

  async disconnectSession(userId) {
    try {
      const sessionId = `session_${userId}`
      const result = await this.sessionService.disconnectSession(sessionId)

      if (!result.success) {
        return { success: false, error: result.error }
      }

      logger.info(`Session disconnected for user: ${userId}`)

      return {
        success: true,
        message: 'Session disconnected successfully'
      }

    } catch (error) {
      logger.error('Disconnect session error:', error)
      return { success: false, error: 'Failed to disconnect session' }
    }
  }

  async reconnectSession(userId) {
    try {
      const sessionId = `session_${userId}`
      const result = await this.sessionService.reconnectSession(sessionId)

      if (!result.success) {
        return { success: false, error: result.error }
      }

      logger.info(`Session reconnection initiated for user: ${userId}`)

      return {
        success: true,
        message: 'Reconnection initiated'
      }

    } catch (error) {
      logger.error('Reconnect session error:', error)
      return { success: false, error: 'Failed to reconnect session' }
    }
  }

  async getSessionStats(userId) {
    try {
      const sessionId = `session_${userId}`
      const stats = await this.sessionService.getSessionStats(sessionId)

      return {
        sessionId: stats.sessionId,
        isConnected: stats.isConnected,
        connectionStatus: stats.connectionStatus,
        phoneNumber: stats.phoneNumber,
        reconnectAttempts: stats.reconnectAttempts,
        uptime: stats.uptime,
        lastConnected: stats.lastConnected,
        createdAt: stats.createdAt
      }

    } catch (error) {
      logger.error('Get session stats error:', error)
      throw error
    }
  }

  async getSystemStats(userId) {
    try {
      // Get user's session stats
      const userStats = await this.getSessionStats(userId)

      // Get overall system stats (limited info for regular users)
      const systemStats = await this.sessionService.getSystemStats()

      return {
        user: userStats,
        system: {
          totalActiveSessions: systemStats.activeSockets,
          systemStatus: systemStats.isInitialized ? 'operational' : 'initializing'
        }
      }

    } catch (error) {
      logger.error('Get system stats error:', error)
      throw error
    }
  }

  _cleanPhoneNumber(phoneNumber) {
    let cleaned = phoneNumber.replace(/\D/g, '')
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned
    }
    return cleaned
  }

  _isValidPhoneNumber(phoneNumber) {
    const phoneRegex = /^\+\d{10,15}$/
    return phoneRegex.test(phoneNumber)
  }
}