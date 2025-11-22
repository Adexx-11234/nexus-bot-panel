import { createComponentLogger } from '../../utils/logger.js'
import { handlePresenceBeforeSend, handlePresenceAfterSend } from './presence-manager.js'

const logger = createComponentLogger('MESSAGE_SENDER')

/**
 * Send message with automatic presence handling
 */
export async function sendMessageWithPresence(sock, sessionId, chatJid, content, options = {}) {
  try {
    // Handle presence before sending
    await handlePresenceBeforeSend(sock, sessionId, chatJid)
    
    // Send the message
    const result = await sock.sendMessage(chatJid, content, options)
    
    // Handle presence after sending
    await handlePresenceAfterSend(sock, sessionId)
    
    return result
  } catch (error) {
    logger.error('Error sending message with presence:', error)
    // Still try to reset presence
    await handlePresenceAfterSend(sock, sessionId)
    throw error
  }
}