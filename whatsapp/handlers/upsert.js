import { createComponentLogger } from "../../utils/logger.js"
import { recordSessionActivity } from "../utils/index.js"
import { updateSessionLastMessage } from "../../config/baileys.js"

const logger = createComponentLogger("MESSAGE_UPSERT")

// Singleton message processor
let messageProcessorInstance = null

/**
 * Get message processor instance
 */
export async function getMessageProcessor() {
  if (!messageProcessorInstance) {
    const { MessageProcessor } = await import("../messages/index.js")
    messageProcessorInstance = new MessageProcessor()
  }
  return messageProcessorInstance
}

/**
 * Handle messages upsert event
 * Main entry point for incoming messages
 */
export async function handleMessagesUpsert(sessionId, messageUpdate, sock) {
  try {

    updateSessionLastMessage(sessionId)  // This should NOT call recordActivity anymore
    const processor = await getMessageProcessor()

    // Process each message in the batch
    for (const m of messageUpdate.messages) {
      if (!m?.message) {
        continue
      }

      try {
        // Fix timestamp issue - add 1 hour for server timezone
        if (m.messageTimestamp) {
          m.messageTimestamp = Number(m.messageTimestamp) + 3600
        } else {
          m.messageTimestamp = Math.floor(Date.now() / 1000) + 3600
        }

        // Ensure basic properties
        if (!m.chat && m.key?.remoteJid) {
          m.chat = m.key.remoteJid
        }
        if (!m.sender && m.key?.participant) {
          m.sender = m.key.participant
        } else if (!m.sender && m.key?.remoteJid && !m.key.remoteJid.includes("@g.us")) {
          m.sender = m.key.remoteJid
        }

        // Validate chat
        if (typeof m.chat !== "string") {
          continue
        }

        // Add reply helper
        if (!m.reply) {
          m.reply = async (text, options = {}) => {
            try {
              const chatJid = m.chat || m.key?.remoteJid

              if (!chatJid || typeof chatJid !== "string") {
                throw new Error(`Invalid chat JID: ${chatJid}`)
              }

              const messageOptions = {
                quoted: m,
                ...options,
              }

              if (typeof text === "string") {
                return await sock.sendMessage(chatJid, { text }, messageOptions)
              } else if (typeof text === "object") {
                return await sock.sendMessage(chatJid, text, messageOptions)
              }
            } catch (error) {
              logger.error(`Error in m.reply:`, error)
              throw error
            }
          }
        }

        // ✅ NO PREFIX PASSED - Processor fetches from memory cache
        await processor.processMessage(sock, sessionId, m)
      } catch (messageError) {
        logger.error(`Error processing individual message:`, messageError)
        continue
      }
    }
  } catch (error) {
    logger.error(`Error processing messages for ${sessionId}:`, error)
  }
}

/**
 * Handle group participants update event
 * Entry point for participant changes (add, remove, promote, demote)
 */
export async function handleGroupParticipantsUpdate(sessionId, update, sock, m = null) {
  try {
    const { getGroupParticipantsHandler } = await import("../groups/index.js")
    const handler = getGroupParticipantsHandler()

    // Create default message object if not provided
    if (!m) {
      m = {
        chat: update.id,
        isGroup: true,
        sessionId: sessionId,
      }
    }

    await handler.handleParticipantsUpdate(sock, sessionId, update, m)
  } catch (error) {
    logger.error(`Error handling participants update for ${sessionId}:`, error)
  }
}

/**
 * Export message processor for backward compatibility
 */
export const messageProcessor = {
  processMessage: async (sock, sessionId, m) => {
    const processor = await getMessageProcessor()
    return await processor.processMessage(sock, sessionId, m)
  },
  getStats: async () => {
    const processor = await getMessageProcessor()
    return processor.getStats()
  },
}
