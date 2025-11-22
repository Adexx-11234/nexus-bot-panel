import { createComponentLogger } from '../../utils/logger.js'
import { UserQueries } from '../../database/query.js'

const logger = createComponentLogger('STATUS_HANDLER')

/**
 * StatusHandler - Handles automatic status viewing and reactions
 */
export class StatusHandler {
  constructor() {
    this.processedStatuses = new Set()
    this.reactionEmojis = ['❤️', '🔥', '😍', '👍', '😊', '🎉', '💯', '✨', '👏', '🥰']
  }

  /**
   * Handle incoming status message
   */
  async handleStatusMessage(sock, sessionId, message) {
    try {
      // Check if this is a status message
      if (!this.isStatusMessage(message)) {
        return
      }

      const messageId = message.key?.id
      const statusSender = message.key?.participant

      if (!statusSender) {
        logger.debug('[StatusHandler] No participant in status message')
        return
      }

      // Validate message key structure
      if (!message.key || !message.key.remoteJid || !message.key.participant) {
        logger.warn('[StatusHandler] Invalid message key structure')
        return
      }

      // Skip if already processed
      if (this.processedStatuses.has(messageId)) {
        return
      }

      this.processedStatuses.add(messageId)

      // Extract telegram ID from session
      const telegramId = this._extractTelegramId(sessionId)
      if (!telegramId) return

      // Get user settings
      const settings = await UserQueries.getPresenceSettings(telegramId)

      logger.info(`[StatusHandler] Status from ${statusSender}, View: ${settings.auto_status_view}, Like: ${settings.auto_status_like}`)

      // Auto-view status (this works - sends read receipt)
      if (settings.auto_status_view) {
        await this.viewStatus(sock, message)
      }

      // Auto-like status with delay
      if (settings.auto_status_like) {
        // Add small delay to make it more natural
        setTimeout(async () => {
          await this.likeStatus(sock, message)
        }, 2000 + Math.random() * 3000) // 2-5 seconds delay
      }

    } catch (error) {
      logger.error('[StatusHandler] Error handling status:', error)
    }
  }

  /**
   * Check if message is a status
   */
  isStatusMessage(message) {
    const remoteJid = message.key?.remoteJid
    return remoteJid === 'status@broadcast'
  }

  /**
   * View a status (send read receipt)
   */
  async viewStatus(sock, message) {
    try {
      const statusSender = message.key?.participant
      
      // Send read receipt to view the status
      await sock.readMessages([message.key])
      
      logger.info(`[StatusHandler] ✅ Viewed status from ${statusSender}`)
    } catch (error) {
      logger.error('[StatusHandler] Error viewing status:', error)
    }
  }

  /**
   * React to a status with random emoji
   * CORRECT IMPLEMENTATION: Using statusJidList option from Baileys documentation
   */
  async likeStatus(sock, message) {
    try {
      const statusSender = message.key?.participant
      
      if (!statusSender) {
        logger.warn('[StatusHandler] Cannot react - no participant')
        return
      }

      // Validate sock.user exists
      if (!sock.user || !sock.user.id) {
        logger.warn('[StatusHandler] Cannot react - sock.user not available')
        return
      }

      // Pick random emoji
      const randomEmoji = this.reactionEmojis[Math.floor(Math.random() * this.reactionEmojis.length)]
      
      // CORRECT WAY: Use statusJidList option as per Baileys documentation
      // Reference: https://github.com/WhiskeySockets/Baileys/issues/
      await sock.sendMessage(
        message.key.remoteJid, // 'status@broadcast'
        {
          react: {
            text: randomEmoji,
            key: message.key
          }
        },
        {
          statusJidList: [message.key.participant, sock.user.id]
        }
      )
      
      logger.info(`[StatusHandler] ✅ Reacted to status from ${statusSender} with ${randomEmoji}`)
      
    } catch (error) {
      logger.error('[StatusHandler] Error reacting to status:', error)
      
      // Log detailed error for debugging
      if (error.message && error.message.includes('EKEYTYPE')) {
        logger.error('[StatusHandler] EKEYTYPE error - Key is undefined')
        logger.debug('[StatusHandler] Message key:', JSON.stringify(message.key))
        logger.debug('[StatusHandler] Sock user:', JSON.stringify(sock.user))
      }
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
   * Cleanup old processed statuses (prevent memory leak)
   */
  cleanup() {
    // Keep only last 1000 entries
    if (this.processedStatuses.size > 1000) {
      const entries = Array.from(this.processedStatuses)
      this.processedStatuses.clear()
      // Keep only the last 500
      entries.slice(-500).forEach(id => this.processedStatuses.add(id))
    }
  }

  /**
   * Get stats for debugging
   */
  getStats() {
    return {
      processedStatuses: this.processedStatuses.size,
      reactionEmojis: this.reactionEmojis.length
    }
  }
}

// Singleton instance
let statusHandlerInstance = null

/**
 * Get status handler instance
 */
export function getStatusHandler() {
  if (!statusHandlerInstance) {
    statusHandlerInstance = new StatusHandler()
  }
  return statusHandlerInstance
}

/**
 * Handle status message
 */
export async function handleStatusMessage(sock, sessionId, message) {
  const handler = getStatusHandler()
  await handler.handleStatusMessage(sock, sessionId, message)
}