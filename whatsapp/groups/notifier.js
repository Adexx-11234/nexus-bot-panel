import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('GROUP_NOTIFIER')

/**
 * GroupNotifier - Sends welcome, goodbye, promotion, demotion messages
 * Checks database settings before sending
 */
export class GroupNotifier {
  constructor() {
    // No state needed
  }

  /**
   * Send welcome messages
   */
  async sendWelcomeMessages(sock, groupJid, detailedMessages) {
    try {
      // Check if welcome messages are enabled
      const { GroupQueries } = await import('../../database/query.js')
      const isEnabled = await GroupQueries.isAntiCommandEnabled(groupJid, 'welcome')

      if (!isEnabled) {
        logger.debug(`Welcome messages disabled for ${groupJid}`)
        return
      }

      // Send messages
      for (const messageData of detailedMessages) {
        if (!messageData?.message || !messageData?.participant) {
          continue
        }

        try {
          await this._sendEnhancedMessage(sock, groupJid, messageData)
        } catch (error) {
          logger.error(`Failed to send welcome message:`, error)
        }
      }

    } catch (error) {
      logger.error('Error sending welcome messages:', error)
    }
  }

  /**
   * Send goodbye messages
   */
  async sendGoodbyeMessages(sock, groupJid, detailedMessages) {
    try {
      // Check if goodbye messages are enabled
      const { GroupQueries } = await import('../../database/query.js')
      const isEnabled = await GroupQueries.isAntiCommandEnabled(groupJid, 'goodbye')

      if (!isEnabled) {
        logger.debug(`Goodbye messages disabled for ${groupJid}`)
        return
      }

      // Send messages
      for (const messageData of detailedMessages) {
        if (!messageData?.message || !messageData?.participant) {
          continue
        }

        try {
          await this._sendEnhancedMessage(sock, groupJid, messageData)
        } catch (error) {
          logger.error(`Failed to send goodbye message:`, error)
        }
      }

    } catch (error) {
      logger.error('Error sending goodbye messages:', error)
    }
  }

  /**
   * Send promotion messages
   */
  async sendPromotionMessages(sock, groupJid, detailedMessages) {
    try {
      // Check if welcome messages are enabled (promotions use welcome setting)
      const { GroupQueries } = await import('../../database/query.js')
      const isEnabled = await GroupQueries.isAntiCommandEnabled(groupJid, 'welcome')

      if (!isEnabled) {
        logger.debug(`Promotion messages disabled for ${groupJid}`)
        return
      }

      // Send messages
      for (const messageData of detailedMessages) {
        if (!messageData?.message || !messageData?.participant) {
          continue
        }

        try {
          await this._sendEnhancedMessage(sock, groupJid, messageData)
        } catch (error) {
          logger.error(`Failed to send promotion message:`, error)
        }
      }

    } catch (error) {
      logger.error('Error sending promotion messages:', error)
    }
  }

  /**
   * Send demotion messages
   */
  async sendDemotionMessages(sock, groupJid, detailedMessages) {
    try {
      // Check if goodbye messages are enabled (demotions use goodbye setting)
      const { GroupQueries } = await import('../../database/query.js')
      const isEnabled = await GroupQueries.isAntiCommandEnabled(groupJid, 'goodbye')

      if (!isEnabled) {
        logger.debug(`Demotion messages disabled for ${groupJid}`)
        return
      }

      // Send messages
      for (const messageData of detailedMessages) {
        if (!messageData?.message || !messageData?.participant) {
          continue
        }

        try {
          await this._sendEnhancedMessage(sock, groupJid, messageData)
        } catch (error) {
          logger.error(`Failed to send demotion message:`, error)
        }
      }

    } catch (error) {
      logger.error('Error sending demotion messages:', error)
    }
  }

  /**
   * Send enhanced message with mentions
   * ✅ FIXED: Removed contextInfo to avoid triggering groupMetadata calls
   * @private
   */
  async _sendEnhancedMessage(sock, groupJid, messageData) {
    try {
      const { message, participant, canvasImage, shouldUseCanvas } = messageData

      if (!message || !participant) {
        logger.error('Missing required fields:', { hasMessage: !!message, hasParticipant: !!participant })
        throw new Error('Invalid message data')
      }

      // ✅ FIXED: Send simple message with mentions only (no contextInfo)
      // This prevents Baileys from calling groupMetadata internally
      
      if (shouldUseCanvas && canvasImage) {
        logger.info(`Sending canvas image for large group (900+ members)`)
        
        // Send image with caption and mention
        await sock.sendMessage(groupJid, {
          image: canvasImage,
          caption: message,
          mentions: [participant] // ✅ Simple mentions array - no contextInfo
        })
      } else {
        // For small groups or other actions (goodbye, promote, demote) - send text only
        logger.debug(`Sending text-only message (small group or non-welcome action)`)
        
        await sock.sendMessage(groupJid, {
          text: message,
          mentions: [participant] // ✅ Simple mentions array - no contextInfo
        })
      }

      logger.info(`Enhanced message sent for ${participant}`)

    } catch (error) {
      logger.error('Error sending enhanced message:', error)
      
      // ✅ Fallback: Try sending without mentions if rate-limited
      if (error.message?.includes('rate-overlimit')) {
        logger.warn('Rate limited, retrying without mentions...')
        
        try {
          if (messageData.shouldUseCanvas && messageData.canvasImage) {
            await sock.sendMessage(groupJid, {
              image: messageData.canvasImage,
              caption: messageData.message
            })
          } else {
            await sock.sendMessage(groupJid, {
              text: messageData.message
            })
          }
          logger.info('Fallback message sent successfully')
        } catch (fallbackError) {
          logger.error('Fallback message also failed:', fallbackError)
          throw fallbackError
        }
      } else {
        throw error
      }
    }
  }

  /**
   * Send simple text message (fallback)
   */
  async sendSimpleMessage(sock, groupJid, text, mentions = []) {
    try {
      const messageOptions = {
        text: text
      }

      if (mentions.length > 0) {
        messageOptions.mentions = mentions
      }

      await sock.sendMessage(groupJid, messageOptions)
      logger.debug(`Simple message sent to ${groupJid}`)

    } catch (error) {
      logger.error('Error sending simple message:', error)
      throw error
    }
  }
}

// Singleton instance
let notifierInstance = null

/**
 * Get notifier singleton
 */
export function getGroupNotifier() {
  if (!notifierInstance) {
    notifierInstance = new GroupNotifier()
  }
  return notifierInstance
}