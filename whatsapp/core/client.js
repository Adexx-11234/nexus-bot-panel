import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('WHATSAPP_CLIENT')

/**
 * WhatsAppClient - High-level WhatsApp client wrapper
 * Provides simplified interface for WhatsApp operations
 */
export class WhatsAppClient {
  constructor(pluginLoader = null) {
    this.pluginLoader = pluginLoader
    this.telegramBot = null
    this.sessionManager = null
    
    logger.info('WhatsApp client initialized')
  }

  /**
   * Set Telegram bot instance
   */
  setTelegramBot(telegramBot) {
    this.telegramBot = telegramBot
    logger.info('Telegram bot linked to WhatsApp client')
  }

  /**
   * Set session manager instance
   */
  setSessionManager(sessionManager) {
    this.sessionManager = sessionManager
    logger.info('Session manager linked to WhatsApp client')
  }

  /**
   * Get socket for a session
   */
  getSocket(sessionId) {
    if (!this.sessionManager) {
      logger.error('Session manager not set')
      return null
    }

    return this.sessionManager.getSession(sessionId)
  }

  /**
   * Send a message
   */
  async sendMessage(sessionId, jid, content, options = {}) {
    try {
      const sock = this.getSocket(sessionId)
      
      if (!sock) {
        throw new Error(`No active socket for session ${sessionId}`)
      }

      if (typeof content === 'string') {
        return await sock.sendMessage(jid, { text: content }, options)
      } else {
        return await sock.sendMessage(jid, content, options)
      }

    } catch (error) {
      logger.error(`Failed to send message for ${sessionId}:`, error)
      throw error
    }
  }

  /**
   * Get group metadata
   */
  async getGroupMetadata(sessionId, groupJid) {
    try {
      const sock = this.getSocket(sessionId)
      
      if (!sock) {
        throw new Error(`No active socket for session ${sessionId}`)
      }

      return await sock.groupMetadata(groupJid)

    } catch (error) {
      logger.error(`Failed to get group metadata:`, error)
      throw error
    }
  }

  /**
   * Get client statistics
   */
  getStats() {
    return {
      hasPluginLoader: !!this.pluginLoader,
      hasTelegramBot: !!this.telegramBot,
      hasSessionManager: !!this.sessionManager,
      activeSessions: this.sessionManager?.activeSockets?.size || 0
    }
  }

  /**
   * Cleanup client resources
   */
  async cleanup() {
    try {
      logger.info('Cleaning up WhatsApp client')
      
      // Cleanup can be extended here
      
      logger.info('WhatsApp client cleanup completed')
    } catch (error) {
      logger.error('Client cleanup error:', error)
    }
  }
}