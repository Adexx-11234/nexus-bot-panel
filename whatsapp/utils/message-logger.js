import { promises as fs } from 'fs'
import path from 'path'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('MESSAGE_LOGGER')

const MESSAGES_DIR = path.join(process.cwd(), 'messages')

/**
 * Ensure messages directory exists
 */
async function ensureMessagesDir() {
  try {
    await fs.mkdir(MESSAGES_DIR, { recursive: true })
  } catch (error) {
    logger.error('Failed to create messages directory:', error)
  }
}

/**
 * Convert a message object to a serializable format
 * (handles Uint8Array and other non-JSON types)
 */
function serializeMessage(message) {
  const seen = new Set()
  
  const replacer = (key, value) => {
    // Prevent circular references
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]'
      }
      seen.add(value)
    }

    // Handle Uint8Array and Buffer
    if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
      return value.toString('base64')
    }

    // Handle BigInt
    if (typeof value === 'bigint') {
      return value.toString()
    }

    return value
  }

  return JSON.stringify(message, replacer, 2)
}

/**
 * Save a received message to a JSON file
 * File name: message_<messageId>.json
 */
export async function logReceivedMessage(messageUpdate) {
  try {
    await ensureMessagesDir()

    const { messages, type } = messageUpdate

    if (!messages || messages.length === 0) {
      return
    }

    for (const msg of messages) {
      try {
        const messageId = msg.key?.id
        if (!messageId) {
          logger.debug('Message without ID, skipping')
          continue
        }

        const filename = `message_${messageId}.json`
        const filepath = path.join(MESSAGES_DIR, filename)

        // Serialize the entire message with metadata
        const logData = {
          timestamp: new Date().toISOString(),
          type: type,
          message: msg,
          metadata: {
            fromMe: msg.key?.fromMe,
            remoteJid: msg.key?.remoteJid,
            participant: msg.key?.participant,
            messageTimestamp: msg.messageTimestamp,
            status: msg.status
          }
        }

        const serialized = serializeMessage(logData)
        await fs.writeFile(filepath, serialized, 'utf8')

        logger.debug(`✅ Logged message: ${filename}`)
      } catch (error) {
        logger.error(`Error logging individual message:`, error.message)
      }
    }
  } catch (error) {
    logger.error('Error in logReceivedMessage:', error)
  }
}

/**
 * Batch log multiple messages
 */
export async function logReceivedMessages(messages, type) {
  try {
    await ensureMessagesDir()

    if (!messages || messages.length === 0) {
      return
    }

    for (const msg of messages) {
      try {
        const messageId = msg.key?.id
        if (!messageId) {
          continue
        }

        const filename = `message_${messageId}.json`
        const filepath = path.join(MESSAGES_DIR, filename)

        const logData = {
          timestamp: new Date().toISOString(),
          type: type,
          message: msg,
          metadata: {
            fromMe: msg.key?.fromMe,
            remoteJid: msg.key?.remoteJid,
            participant: msg.key?.participant,
            messageTimestamp: msg.messageTimestamp,
            status: msg.status
          }
        }

        const serialized = serializeMessage(logData)
        await fs.writeFile(filepath, serialized, 'utf8')
      } catch (error) {
        logger.debug(`Error logging message:`, error.message)
      }
    }

    logger.debug(`✅ Logged ${messages.length} messages`)
  } catch (error) {
    logger.error('Error in logReceivedMessages:', error)
  }
}
