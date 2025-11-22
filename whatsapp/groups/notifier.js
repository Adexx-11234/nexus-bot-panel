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
   * Send enhanced message with fake quoted context and mentions
   * @private
   */
async _sendEnhancedMessage(sock, groupJid, messageData) {
  try {
    const { message, fakeQuotedMessage, participant } = messageData

    if (!message || !participant) {
      logger.error('Missing required fields:', { hasMessage: !!message, hasParticipant: !!participant })
      throw new Error('Invalid message data')
    }

    if (!fakeQuotedMessage || !fakeQuotedMessage.message || !fakeQuotedMessage.key) {
      logger.error('Invalid fakeQuotedMessage structure')
      throw new Error('Invalid fakeQuotedMessage structure')
    }

    // NO optional chaining - direct property access
    const contextInfo = {
      mentionedJid: [participant],
      quotedMessage: fakeQuotedMessage.message,
      participant: fakeQuotedMessage.participant || participant,
      remoteJid: groupJid,
      stanzaId: fakeQuotedMessage.key.id,
      quotedMessageId: fakeQuotedMessage.key.id,
      quotedParticipant: fakeQuotedMessage.key.participant || participant
    }

    const messageOptions = {
      text: message,
      contextInfo: contextInfo
    }

    await sock.sendMessage(groupJid, messageOptions)
    logger.info(`Enhanced message sent for ${participant}`)

  } catch (error) {
    logger.error('Error sending enhanced message:', error)
    throw error
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