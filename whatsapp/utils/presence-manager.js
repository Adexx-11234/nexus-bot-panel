import { createComponentLogger } from '../../utils/logger.js'
import { UserQueries } from '../../database/query.js'

const logger = createComponentLogger('PRESENCE_MANAGER')

/**
 * PresenceManager - Centralized presence update management
 * Handles all presence updates based on user settings
 */
export class PresenceManager {
  constructor() {
    this.activeTypingTimers = new Map()
    this.activeRecordingTimers = new Map()
    this.defaultPresence = 'unavailable'
  }

  /**
   * Initialize presence for a session
   */
  async initializePresence(sock, sessionId) {
    try {
      const telegramId = this._extractTelegramId(sessionId)
      if (!telegramId) return

      const settings = await UserQueries.getPresenceSettings(telegramId)
      
      // Set default presence based on settings
      if (settings.auto_online) {
        await this._sendPresence(sock, 'available')
        logger.info(`[${sessionId}] Set to auto-online mode`)
      } else {
        await this._sendPresence(sock, 'unavailable')
        logger.info(`[${sessionId}] Set to offline mode`)
      }

    } catch (error) {
      logger.error(`Error initializing presence for ${sessionId}:`, error)
      // Fallback to offline
      await this._sendPresence(sock, 'unavailable')
    }
  }

  /**
   * Handle presence before sending a message
   */
  async beforeSendMessage(sock, sessionId, chatJid) {
    try {
      const telegramId = this._extractTelegramId(sessionId)
      if (!telegramId) return

      const settings = await UserQueries.getPresenceSettings(telegramId)
      
      // If not auto-online, temporarily go online
      if (!settings.auto_online) {
        await this._sendPresence(sock, 'available')
        await this._sleep(500) // Brief delay
      }

      // Show typing
      await this._sendPresence(sock, 'composing', chatJid)
      await this._sleep(1000) // Type for 1 second

    } catch (error) {
      logger.error(`Error in beforeSendMessage:`, error)
    }
  }

  /**
   * Handle presence after sending a message
   */
  async afterSendMessage(sock, sessionId) {
    try {
      const telegramId = this._extractTelegramId(sessionId)
      if (!telegramId) return

      const settings = await UserQueries.getPresenceSettings(telegramId)
      
      // Return to default presence
      if (settings.auto_online) {
        await this._sendPresence(sock, 'available')
      } else {
        await this._sendPresence(sock, 'unavailable')
      }

    } catch (error) {
      logger.error(`Error in afterSendMessage:`, error)
    }
  }

  /**
   * Handle presence on message received
   */
  async onMessageReceived(sock, sessionId, m) {
    try {
      const telegramId = this._extractTelegramId(sessionId)
      if (!telegramId) return

      const settings = await UserQueries.getPresenceSettings(telegramId)
      const chatJid = m.chat

      // Auto-typing
      if (settings.auto_typing) {
        await this._showTyping(sock, sessionId, chatJid)
      }

      // Auto-recording
      if (settings.auto_recording) {
        await this._showRecording(sock, sessionId, chatJid)
      }

    } catch (error) {
      logger.error(`Error in onMessageReceived:`, error)
    }
  }

  /**
   * Show typing indicator for 10-20 seconds
   */
  async _showTyping(sock, sessionId, chatJid) {
    try {
      const key = `${sessionId}_${chatJid}`
      
      // Clear existing timer
      if (this.activeTypingTimers.has(key)) {
        clearTimeout(this.activeTypingTimers.get(key))
      }

      // Show typing
      await this._sendPresence(sock, 'composing', chatJid)
      
      // Random duration between 10-20 seconds
      const duration = Math.floor(Math.random() * 10000) + 10000
      
      const timer = setTimeout(async () => {
        await this._sendPresence(sock, 'paused', chatJid)
        this.activeTypingTimers.delete(key)
        
        // Return to default presence
        const telegramId = this._extractTelegramId(sessionId)
        const settings = await UserQueries.getPresenceSettings(telegramId)
        if (settings.auto_online) {
          await this._sendPresence(sock, 'available')
        } else {
          await this._sendPresence(sock, 'unavailable')
        }
      }, duration)

      this.activeTypingTimers.set(key, timer)
      
    } catch (error) {
      logger.error(`Error showing typing:`, error)
    }
  }

  /**
   * Show recording indicator for 10-20 seconds
   */
  async _showRecording(sock, sessionId, chatJid) {
    try {
      const key = `${sessionId}_${chatJid}`
      
      // Clear existing timer
      if (this.activeRecordingTimers.has(key)) {
        clearTimeout(this.activeRecordingTimers.get(key))
      }

      // Show recording
      await this._sendPresence(sock, 'recording', chatJid)
      
      // Random duration between 10-20 seconds
      const duration = Math.floor(Math.random() * 10000) + 10000
      
      const timer = setTimeout(async () => {
        await this._sendPresence(sock, 'paused', chatJid)
        this.activeRecordingTimers.delete(key)
        
        // Return to default presence
        const telegramId = this._extractTelegramId(sessionId)
        const settings = await UserQueries.getPresenceSettings(telegramId)
        if (settings.auto_online) {
          await this._sendPresence(sock, 'available')
        } else {
          await this._sendPresence(sock, 'unavailable')
        }
      }, duration)

      this.activeRecordingTimers.set(key, timer)
      
    } catch (error) {
      logger.error(`Error showing recording:`, error)
    }
  }

  /**
   * Send presence update (centralized)
   */
  async _sendPresence(sock, presence, chatJid = null) {
    try {
      if (chatJid) {
        await sock.sendPresenceUpdate(presence, chatJid)
      } else {
        await sock.sendPresenceUpdate(presence)
      }
    } catch (error) {
      logger.debug(`Presence update failed (${presence}):`, error.message)
    }
  }

  /**
   * Extract telegram ID from session ID
   */
  _extractTelegramId(sessionId) {
    const match = sessionId.match(/session_(-?\d+)/)
    return match ? parseInt(match[1]) : null
  }

  /**
   * Sleep helper
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Cleanup timers for a session
   */
  cleanup(sessionId) {
    // Clear all timers for this session
    for (const [key, timer] of this.activeTypingTimers.entries()) {
      if (key.startsWith(sessionId)) {
        clearTimeout(timer)
        this.activeTypingTimers.delete(key)
      }
    }

    for (const [key, timer] of this.activeRecordingTimers.entries()) {
      if (key.startsWith(sessionId)) {
        clearTimeout(timer)
        this.activeRecordingTimers.delete(key)
      }
    }
  }
}

// Singleton instance
let presenceManagerInstance = null

/**
 * Get presence manager instance
 */
export function getPresenceManager() {
  if (!presenceManagerInstance) {
    presenceManagerInstance = new PresenceManager()
  }
  return presenceManagerInstance
}

/**
 * Initialize presence manager for session
 */
export async function initializePresenceForSession(sock, sessionId) {
  const manager = getPresenceManager()
  await manager.initializePresence(sock, sessionId)
}

/**
 * Handle presence before message send
 */
export async function handlePresenceBeforeSend(sock, sessionId, chatJid) {
  const manager = getPresenceManager()
  await manager.beforeSendMessage(sock, sessionId, chatJid)
}

/**
 * Handle presence after message send
 */
export async function handlePresenceAfterSend(sock, sessionId) {
  const manager = getPresenceManager()
  await manager.afterSendMessage(sock, sessionId)
}

/**
 * Handle presence on message received
 */
export async function handlePresenceOnReceive(sock, sessionId, m) {
  const manager = getPresenceManager()
  await manager.onMessageReceived(sock, sessionId, m)
}