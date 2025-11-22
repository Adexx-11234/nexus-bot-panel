import { createComponentLogger } from '../../utils/logger.js'
import { normalizeJid } from '../utils/jid.js'
import { getDecryptionHandler } from '../core/index.js'

const logger = createComponentLogger('MESSAGE_EVENTS')

/**
 * MessageEventHandler - Handles all message-related events
 * Includes: upsert, update, delete, reactions, status messages
 */
export class MessageEventHandler {
  constructor() {
    this.decryptionHandler = getDecryptionHandler()
  }

/**
 * Handle new messages (messages.upsert)
 * Main entry point for message processing
 */
async handleMessagesUpsert(sock, sessionId, messageUpdate) {
  try {
    const { messages, type } = messageUpdate

    if (!messages || messages.length === 0) {
      return
    }

    // **HANDLE PRESENCE ON MESSAGE RECEIVED**
    try {
      const { handlePresenceOnReceive } = await import('../utils/index.js')
      for (const msg of messages) {
        if (!msg.key?.fromMe) {
          await handlePresenceOnReceive(sock, sessionId, {
            chat: msg.key?.remoteJid,
            sender: msg.key?.participant || msg.key?.remoteJid
          })
        }
      }
    } catch (presenceError) {
      // Silent fail - don't break message processing
    }

    // **HANDLE STATUS MESSAGES (Auto-view and Auto-like)**
    try {
      const { handleStatusMessage } = await import('../utils/index.js')
      for (const msg of messages) {
        // Check if it's a status message
        if (msg.key?.remoteJid === 'status@broadcast') {
          await handleStatusMessage(sock, sessionId, msg)
          // Don't process status messages further
          continue
        }
      }
    } catch (statusError) {
      logger.debug('[MessageHandler] Status handler error:', statusError.message)
      // Silent fail - don't break message processing
    }

    // Filter out invalid messages
    const validMessages = messages.filter(msg => {
      // Skip newsletter messages
     /* if (msg.key?.remoteJid?.endsWith('@newsletter')) {
        return false
      }*/

      // Skip status messages (already handled above)
      if (msg.key?.remoteJid === 'status@broadcast') {
        return false
      }

      // Skip broadcast list messages by default
      if (msg.key?.remoteJid?.endsWith('@broadcast') && msg.key?.remoteJid !== 'status@broadcast') {
        logger.debug(`Skipping broadcast message from ${msg.key?.remoteJid}`)
        return false
      }
      
      // Skip messages without content
      if (!msg.message) {
        return false
      }

      return true
    })

    if (validMessages.length === 0) {
      return
    }

    logger.debug(`Processing ${validMessages.length} messages for ${sessionId}`)

    // Process messages with LID resolution and decryption error handling
    const processedMessages = []
    for (const message of validMessages) {
      try {
        const processed = await this._processMessageWithLidResolution(sock, message)
        if (processed) {
          // Add timestamp correction (fix timezone issue)
          if (processed.messageTimestamp) {
            processed.messageTimestamp = Number(processed.messageTimestamp) + 3600 // Add 1 hour
          } else {
            processed.messageTimestamp = Math.floor(Date.now() / 1000) + 3600
          }
          
          processedMessages.push(processed)
        }
      } catch (error) {
        // Handle decryption errors with the decryption handler
        const result = await this.decryptionHandler.handleDecryptionError(
          sock,
          sessionId,
          error,
          message
        )

        if (result.shouldSkip) {
          logger.debug(
            `Skipping message ${message.key?.id} - Reason: ${result.reason}`
          )
          continue
        }

        if (result.recovered) {
          logger.info(
            `Decryption recovered for ${message.key?.id} - Reason: ${result.reason}. Message will be redelivered.`
          )
          continue
        }

        // If not a decryption error or unrecoverable, log it
        logger.error(`Failed to process message ${message.key?.id}:`, error)
      }
    }

    if (processedMessages.length === 0) {
      return
    }

    // Pass to main message handler
    const { handleMessagesUpsert } = await import('../handlers/upsert.js')
    await handleMessagesUpsert(sessionId, { 
      messages: processedMessages, 
      type 
    }, sock)

  } catch (error) {
    logger.error(`Messages upsert error for ${sessionId}:`, error)
  }
}

  /**
   * Check if a message is a status or broadcast message
   * @private
   */
  _isStatusOrBroadcastMessage(remoteJid) {
    if (!remoteJid) return false

    // Status messages: status@broadcast
    if (remoteJid === 'status@broadcast') {
      return true
    }

    // Broadcast lists: [timestamp]@broadcast
    // Example: 1234567890@broadcast
    if (remoteJid.endsWith('@broadcast') && remoteJid !== 'status@broadcast') {
      return true
    }

    return false
  }

  /**
   * Get the type of broadcast message
   * @private
   */
  _getBroadcastType(remoteJid) {
    if (!remoteJid) return null

    if (remoteJid === 'status@broadcast') {
      return 'status'
    }

    if (remoteJid.endsWith('@broadcast')) {
      return 'broadcast_list'
    }

    return null
  }

  /**
   * Handle status messages specifically
   * This can be called when processStatusMessages config is enabled
   */
  async handleStatusMessage(sock, sessionId, message) {
    try {
      logger.debug(`Processing status message from ${message.key?.participant || 'unknown'}`)

      // Status messages contain:
      // - message.key.remoteJid = 'status@broadcast'
      // - message.key.participant = sender's JID
      // - message.message = actual message content (image, video, text, etc.)
      // - message.messageTimestamp = when status was posted

      const statusData = {
        id: message.key.id,
        sender: message.key.participant,
        content: message.message,
        timestamp: message.messageTimestamp,
        type: this._getStatusMessageType(message.message),
        // Additional metadata
        fromMe: message.key.fromMe || false,
        pushName: message.pushName
      }

      logger.info(`Status from ${statusData.sender}: ${statusData.type}`)

      // TODO: Implement status processing logic here
      // Examples:
      // - Store status in database
      // - Trigger webhook for status updates
      // - Auto-view status
      // - Download status media

      return statusData

    } catch (error) {
      logger.error('Status message processing error:', error)
      return null
    }
  }

  /**
   * Get the type of status message
   * @private
   */
  _getStatusMessageType(messageContent) {
    if (!messageContent) return 'unknown'

    if (messageContent.imageMessage) return 'image'
    if (messageContent.videoMessage) return 'video'
    if (messageContent.extendedTextMessage || messageContent.conversation) return 'text'
    if (messageContent.audioMessage) return 'audio'
    if (messageContent.documentMessage) return 'document'
    
    return 'other'
  }

  /**
   * Handle broadcast list messages
   * This can be called when processing broadcast messages
   */
  async handleBroadcastMessage(sock, sessionId, message) {
    try {
      const broadcastId = message.key.remoteJid
      logger.debug(`Processing broadcast list message from ${broadcastId}`)

      // Broadcast list messages contain:
      // - message.key.remoteJid = '[timestamp]@broadcast'
      // - message.message = actual message content
      // - message.messageTimestamp = when message was sent

      const broadcastData = {
        id: message.key.id,
        broadcastId: broadcastId,
        content: message.message,
        timestamp: message.messageTimestamp,
        fromMe: message.key.fromMe || false
      }

      logger.info(`Broadcast message from ${broadcastId}`)

      // TODO: Implement broadcast processing logic here
      // Examples:
      // - Store broadcast message
      // - Track broadcast delivery status
      // - Get broadcast list info

      return broadcastData

    } catch (error) {
      logger.error('Broadcast message processing error:', error)
      return null
    }
  }

  /**
   * Process message and resolve LIDs to actual JIDs
   */
  async _processMessageWithLidResolution(sock, message) {
    try {
      if (!message?.key) {
        return message
      }

      const isGroup = message.key.remoteJid?.endsWith('@g.us')
      
      // Resolve participant LID if present
      if (message.key.participant?.endsWith('@lid') && isGroup) {
        const { resolveLidToJid } = await import('../groups/lid-resolver.js')
        
        const actualJid = await resolveLidToJid(
          sock,
          message.key.remoteJid,
          message.key.participant
        )
        
        message.key.participant = actualJid
        message.participant = actualJid
        
        logger.debug(`Resolved LID ${message.key.participant} to ${actualJid}`)
      } else {
        message.participant = message.key.participant
      }

      // Resolve quoted message participant LID if present
      const quotedParticipant = 
        message.message?.contextInfo?.participant ||
        message.message?.extendedTextMessage?.contextInfo?.participant

      if (quotedParticipant?.endsWith('@lid') && isGroup) {
        const { resolveLidToJid } = await import('../groups/lid-resolver.js')
        
        const actualJid = await resolveLidToJid(
          sock,
          message.key.remoteJid,
          quotedParticipant
        )

        // Update all contextInfo references
        if (message.message?.contextInfo) {
          message.message.contextInfo.participant = actualJid
        }
        if (message.message?.extendedTextMessage?.contextInfo) {
          message.message.extendedTextMessage.contextInfo.participant = actualJid
        }
        
        message.quotedParticipant = actualJid
      }

      return message

    } catch (error) {
      logger.error('LID resolution error:', error)
      return message // Return original message on error
    }
  }

  /**
   * Handle message updates (edits, delivery status)
   */
  async handleMessagesUpdate(sock, sessionId, updates) {
    try {
      if (!updates || updates.length === 0) {
        return
      }

      logger.debug(`Processing ${updates.length} message updates for ${sessionId}`)

      for (const update of updates) {
        try {
          // Skip own messages
          if (update.key?.fromMe) {
            continue
          }

          // Skip status/broadcast updates by default
          // TODO: Add config check for processStatusMessages
          if (this._isStatusOrBroadcastMessage(update.key?.remoteJid)) {
            continue
          }

          // Resolve LID if present
          if (update.key?.participant?.endsWith('@lid')) {
            const { resolveLidToJid } = await import('../groups/lid-resolver.js')
            
            const actualJid = await resolveLidToJid(
              sock,
              update.key.remoteJid,
              update.key.participant
            )
            
            update.key.participant = actualJid
            update.participant = actualJid
          }

          // Process update (can be extended to handle specific update types)
          await this._handleMessageUpdate(sock, sessionId, update)

        } catch (error) {
          logger.error(`Failed to process message update:`, error)
        }
      }

    } catch (error) {
      logger.error(`Messages update error for ${sessionId}:`, error)
    }
  }

  /**
   * Handle individual message update
   */
  async _handleMessageUpdate(sock, sessionId, update) {
    try {
      // Check update type
      const { key, update: updateData } = update

      if (updateData?.status) {
        // Delivery status update
        logger.debug(`Message ${key.id} status: ${updateData.status}`)
      }

      if (updateData?.pollUpdates) {
        // Poll vote update
        logger.debug(`Poll update for message ${key.id}`)
      }

      // Can be extended to update message in database
      // const { MessageQueries } = await import('../../database/query.js')
      // await MessageQueries.updateMessage(key.id, updateData)

    } catch (error) {
      logger.error('Message update processing error:', error)
    }
  }

  /**
   * Handle message deletions
   */
  async handleMessagesDelete(sock, sessionId, deletions) {
    try {
      // Ensure deletions is an array
      const deletionArray = Array.isArray(deletions) ? deletions : [deletions]

      if (deletionArray.length === 0) {
        return
      }

      logger.debug(`Processing ${deletionArray.length} message deletions for ${sessionId}`)

      for (const deletion of deletionArray) {
        try {
          // Skip status/broadcast deletions by default
          // TODO: Add config check for processStatusMessages
          if (this._isStatusOrBroadcastMessage(deletion.key?.remoteJid)) {
            continue
          }

          // Resolve LID if present
          if (deletion.key?.participant?.endsWith('@lid')) {
            const { resolveLidToJid } = await import('../groups/lid-resolver.js')
            
            const actualJid = await resolveLidToJid(
              sock,
              deletion.key.remoteJid,
              deletion.key.participant
            )
            
            deletion.key.participant = actualJid
            deletion.participant = actualJid
          }

          await this._handleMessageDeletion(sock, sessionId, deletion)

        } catch (error) {
          logger.error('Failed to process message deletion:', error)
        }
      }

    } catch (error) {
      logger.error(`Messages delete error for ${sessionId}:`, error)
    }
  }

  /**
   * Handle individual message deletion
   */
  async _handleMessageDeletion(sock, sessionId, deletion) {
    try {
      const { key } = deletion

      logger.debug(`Message deleted: ${key.id} from ${key.remoteJid}`)

      // Can be extended to mark message as deleted in database
      // const { MessageQueries } = await import('../../database/query.js')
      // await MessageQueries.markAsDeleted(key.id)

    } catch (error) {
      logger.error('Message deletion processing error:', error)
    }
  }

  /**
   * Handle message reactions
   */
  async handleMessagesReaction(sock, sessionId, reactions) {
    try {
      if (!reactions || reactions.length === 0) {
        return
      }

      logger.debug(`Processing ${reactions.length} reactions for ${sessionId}`)

      for (const reaction of reactions) {
        try {
          // Skip status/broadcast reactions by default
          // TODO: Add config check for processStatusMessages
          if (this._isStatusOrBroadcastMessage(reaction.key?.remoteJid)) {
            continue
          }

          // Resolve LID if present
          if (reaction.key?.participant?.endsWith('@lid')) {
            const { resolveLidToJid } = await import('../groups/lid-resolver.js')
            
            const actualJid = await resolveLidToJid(
              sock,
              reaction.key.remoteJid,
              reaction.key.participant
            )
            
            reaction.key.participant = actualJid
            reaction.participant = actualJid
          }

          await this._handleMessageReaction(sock, sessionId, reaction)

        } catch (error) {
          logger.error('Failed to process reaction:', error)
        }
      }

    } catch (error) {
      logger.error(`Messages reaction error for ${sessionId}:`, error)
    }
  }

  /**
   * Handle individual message reaction
   */
  async _handleMessageReaction(sock, sessionId, reaction) {
    try {
      const { key, reaction: reactionData } = reaction

      logger.debug(
        `Reaction ${reactionData.text || 'removed'} on message ${key.id} ` +
        `by ${reaction.participant || key.participant}`
      )

      // Can be extended to store reactions in database
      // const { MessageQueries } = await import('../../database/query.js')
      // await MessageQueries.storeReaction(key.id, reactionData)

    } catch (error) {
      logger.error('Reaction processing error:', error)
    }
  }

  /**
   * Handle read receipts (usually disabled)
   */
  async handleReceiptUpdate(sock, sessionId, receipts) {
    try {
      // Usually not needed - can be implemented if required
      logger.debug(`Receipt updates for ${sessionId}`)
    } catch (error) {
      logger.error(`Receipt update error:`, error)
    }
  }
}