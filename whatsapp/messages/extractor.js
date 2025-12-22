import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('MESSAGE_EXTRACTOR')

/**
 * MessageExtractor - Extracts content from various message types
 */
export class MessageExtractor {
  constructor() {
    // No initialization needed
  }

  /**
   * Extract message body (text content)
   */
  extractMessageBody(m) {
    if (!m.message) return ''

    // Direct text messages
    if (m.message.conversation) return m.message.conversation.trim()
    if (m.message.extendedTextMessage?.text) return m.message.extendedTextMessage.text.trim()

    // Media with captions
    if (m.message.imageMessage?.caption) return m.message.imageMessage.caption.trim()
    if (m.message.videoMessage?.caption) return m.message.videoMessage.caption.trim()
    if (m.message.documentMessage?.caption) return m.message.documentMessage.caption.trim()

    // Interactive responses
    if (m.message.listResponseMessage?.singleSelectReply?.selectedRowId) {
      return m.message.listResponseMessage.singleSelectReply.selectedRowId.trim()
    }
    if (m.message.buttonsResponseMessage?.selectedButtonId) {
      return m.message.buttonsResponseMessage.selectedButtonId.trim()
    }
    if (m.message.templateButtonReplyMessage?.selectedId) {
      return m.message.templateButtonReplyMessage.selectedId.trim()
    }

    return ''
  }

  /**
   * Extract quoted message
   */
  extractQuotedMessage(m) {
    let quoted = null

    const extractFromContextInfo = (contextInfo) => {
      if (!contextInfo?.quotedMessage) return null

      return {
        key: {
          remoteJid: contextInfo.remoteJid || m.chat,
          fromMe: contextInfo.fromMe || false,
          id: contextInfo.stanzaId,
          participant: contextInfo.participant
        },
        message: contextInfo.quotedMessage,
        sender: contextInfo.participant || contextInfo.remoteJid,
        body: this.extractQuotedMessageText(contextInfo.quotedMessage)
      }
    }

    // Check extendedTextMessage first
    if (m.message?.extendedTextMessage?.contextInfo) {
      quoted = extractFromContextInfo(m.message.extendedTextMessage.contextInfo)
    }

    // Check other message types
    if (!quoted) {
      const messageTypes = [
        'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage',
        'stickerMessage', 'locationMessage', 'contactMessage'
      ]

      for (const msgType of messageTypes) {
        if (m.message?.[msgType]?.contextInfo) {
          quoted = extractFromContextInfo(m.message[msgType].contextInfo)
          if (quoted) break
        }
      }
    }

    return quoted
  }

  /**
   * Extract text from quoted message
   */
  extractQuotedMessageText(quotedMessage) {
    if (!quotedMessage) return ''

    return quotedMessage.conversation ||
           quotedMessage.extendedTextMessage?.text ||
           quotedMessage.imageMessage?.caption ||
           quotedMessage.videoMessage?.caption ||
           quotedMessage.documentMessage?.caption ||
           (quotedMessage.stickerMessage && '[Sticker]') ||
           (quotedMessage.audioMessage && '[Audio]') ||
           (quotedMessage.imageMessage && '[Image]') ||
           (quotedMessage.videoMessage && '[Video]') ||
           (quotedMessage.documentMessage && '[Document]') ||
           (quotedMessage.contactMessage && '[Contact]') ||
           (quotedMessage.locationMessage && '[Location]') ||
           ''
  }

  /**
   * Extract media data
   */
  extractMediaData(m) {
    const media =
      m.message?.imageMessage ||
      m.message?.videoMessage ||
      m.message?.audioMessage ||
      m.message?.documentMessage ||
      m.message?.stickerMessage

    return media || null
  }

  /**
   * Get media type
   */
  getMediaType(m) {
    if (m.message?.imageMessage) return 'image'
    if (m.message?.videoMessage) return 'video'
    if (m.message?.audioMessage) return 'audio'
    if (m.message?.documentMessage) return 'document'
    if (m.message?.stickerMessage) return 'sticker'
    return null
  }

  /**
   * Check if message has media
   */
  hasMedia(m) {
    return !!(
      m.message?.imageMessage ||
      m.message?.videoMessage ||
      m.message?.audioMessage ||
      m.message?.documentMessage ||
      m.message?.stickerMessage
    )
  }

  /**
   * Check if message is view once
   */
  isViewOnce(m) {
    return !!(m.message?.viewOnceMessage || m.message?.viewOnceMessageV2)
  }

  /**
   * Extract mentions from message
   */
  extractMentions(m) {
    const contextInfo = m.message?.extendedTextMessage?.contextInfo ||
                       m.message?.imageMessage?.contextInfo ||
                       m.message?.videoMessage?.contextInfo

    return contextInfo?.mentionedJid || []
  }
}

// Export convenience functions
export function extractMessageText(m) {
  const extractor = new MessageExtractor()
  return extractor.extractMessageBody(m)
}

export function extractMediaData(m) {
  const extractor = new MessageExtractor()
  return extractor.extractMediaData(m)
}

export function getMediaType(m) {
  const extractor = new MessageExtractor()
  return extractor.getMediaType(m)
}