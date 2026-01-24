import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('MESSAGE_SERIALIZER')

/**
 * Serialize message for processing
 * Adds helper methods and properties
 */
export function serializeMessage(sock, m) {
  try {
    if (!m || !m.key) return m

    // Add basic properties
    m.chat = m.key.remoteJid
    m.fromMe = m.key.fromMe
    m.id = m.key.id
    m.isGroup = m.chat.endsWith('@g.us')
    m.sender = m.isGroup ? m.key.participant : m.chat
    
    // ✅ Ensure private message sender has proper JID format
    if (!m.isGroup && m.sender && !m.sender.includes('@')) {
      m.sender = `${m.sender}@s.whatsapp.net`
    }

    // Extract message type
    m.mtype = getMessageType(m.message)

    // Add utility methods if not present
    if (!m.reply) {
      m.reply = async (text, options = {}) => {
        const messageOptions = { quoted: m, ...options }
        
        if (typeof text === 'string') {
          return await sock.sendMessage(m.chat, { text }, messageOptions)
        } else if (typeof text === 'object') {
          return await sock.sendMessage(m.chat, text, messageOptions)
        }
      }
    }


    if (!m.download) {
      m.download = async () => {
        try {
          const { downloadContentFromMessage } = await import('@whiskeysockets/baileys')
          
          let mediaMessage = null
          if (m.message?.imageMessage) mediaMessage = m.message.imageMessage
          else if (m.message?.videoMessage) mediaMessage = m.message.videoMessage
          else if (m.message?.audioMessage) mediaMessage = m.message.audioMessage
          else if (m.message?.documentMessage) mediaMessage = m.message.documentMessage
          else if (m.message?.stickerMessage) mediaMessage = m.message.stickerMessage

          if (!mediaMessage) {
            throw new Error('No downloadable media found')
          }

          const stream = await downloadContentFromMessage(mediaMessage, m.mtype.replace('Message', ''))
          const chunks = []
          
          for await (const chunk of stream) {
            chunks.push(chunk)
          }

          return Buffer.concat(chunks)
        } catch (error) {
          logger.error('Download error:', error)
          throw error
        }
      }
    }

    return m

  } catch (error) {
    logger.error('Message serialization error:', error)
    return m
  }
}
    /**
 * Get message type from message object
 */
function getMessageType(message) {
  if (!message) return 'unknown'

  const types = [
    'conversation',
    'extendedTextMessage',
    'imageMessage',
    'videoMessage',
    'audioMessage',
    'documentMessage',
    'stickerMessage',
    'locationMessage',
    'liveLocationMessage',
    'contactMessage',
    'contactsArrayMessage',
    'groupInviteMessage',
    'listMessage',
    'listResponseMessage',
    'buttonsMessage',
    'buttonsResponseMessage',
    'templateButtonReplyMessage',
    'interactiveResponseMessage',
    'pollCreationMessage',
    'pollUpdateMessage',
    'reactionMessage',
    'viewOnceMessage',
    'viewOnceMessageV2'
  ]

  for (const type of types) {
    if (message[type]) {
      return type
    }
  }

  return 'unknown'
}
serializeMessage.getMessageType = getMessageType
