import { createComponentLogger } from '../../utils/logger.js'
import { normalizeJid } from '../utils/jid.js'

const logger = createComponentLogger('MESSAGE_EVENTS')

// ✅ SINGLETON: Reuse same MessageProcessor instance
let messageProcessorInstance = null

async function getMessageProcessor() {
  if (!messageProcessorInstance) {
    const { MessageProcessor } = await import('../messages/index.js')
    messageProcessorInstance = new MessageProcessor()
    await messageProcessorInstance.initialize()
  }
  return messageProcessorInstance
}

/**
 * MessageEventHandler - Handles all message-related events
 * Includes: upsert, update, delete, reactions, status messages
 */
export class MessageEventHandler {
  constructor() {
    // No decryption handler needed
  }

  /**
 * Handle new messages (messages.upsert)
 * Main entry point for message processing - WITH DEDUPLICATION
 * ✅ FIXED: Better error handling for decryption failures
 */
async handleMessagesUpsert(sock, sessionId, messageUpdate) {
  try {
    const { messages, type } = messageUpdate

    if (!messages || messages.length === 0) {
      logger.debug(`[${sessionId}] Empty messages.upsert (length: 0)`)
      return
    }

   // logger.info(`[${sessionId}] Received messages.upsert: ${messages.length} messages (type: ${type})`)

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
      logger.debug('[MessageHandler] Presence handler error:', presenceError.message)
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

    const { getMessageDeduplicator } = await import('../utils/index.js')
    const deduplicator = getMessageDeduplicator()
    
    // ✅ ENHANCED: Track filtered messages with reasons
    const ciphertextMessages = []
    const filteredReasons = {
      duplicates: 0,
      statusBroadcast: 0,
      broadcasts: 0,
      noMessage: 0
    }
    
    // Filter out invalid messages with detailed logging
    const validMessages = messages.filter((msg, index) => {
      // ✅ Check if THIS session already processed this message
      if (deduplicator.isDuplicate(msg.key?.remoteJid, msg.key?.id, sessionId)) {
        logger.debug(`[${sessionId}] Skipping duplicate message ${msg.key?.id}`)
        filteredReasons.duplicates++
        return false
      }
      
      // Skip status messages (already handled above)
      if (msg.key?.remoteJid === 'status@broadcast') {
        logger.debug(`[${sessionId}] Skipping status@broadcast message`)
        filteredReasons.statusBroadcast++
        return false
      }

      // Skip broadcast list messages by default
      if (msg.key?.remoteJid?.endsWith('@broadcast') && msg.key?.remoteJid !== 'status@broadcast') {
        logger.debug(`[${sessionId}] Skipping broadcast message from ${msg.key?.remoteJid}`)
        filteredReasons.broadcasts++
        return false
      }
      
      // ✅ ENHANCED: Handle CIPHERTEXT messages (messageStubType = 2)
      if (!msg.message) {
        const stubType = msg.messageStubType
        filteredReasons.noMessage++
        
        // Log with helpful context
        if (stubType === 2) {
          logger.debug(`[${sessionId}] Message ${index} is CIPHERTEXT (stub type 2) - will retry`)
          ciphertextMessages.push(msg)
        } else {
          logger.debug(`[${sessionId}] Message ${index} has no content (messageStubType: ${stubType})`)
        }
        
        return false
      }

      return true
    })

    // ✅ ENHANCED: Request retry for CIPHERTEXT messages after short delay
    if (ciphertextMessages.length > 0) {
     // logger.info(`[${sessionId}] Found ${ciphertextMessages.length} CIPHERTEXT messages - requesting retry after 2s`)
      
      // Wait a bit for Signal keys to be established
      setTimeout(() => {
        for (const cipherMsg of ciphertextMessages) {
          if (cipherMsg.key && cipherMsg.key.id && sock?.requestPlaceholderResend) {
            sock.requestPlaceholderResend(cipherMsg.key)
              .then(requestId => logger.debug(`[${sessionId}] Requested placeholder resend for ${cipherMsg.key.id}, requestId: ${requestId}`))
              .catch(err => logger.debug(`[${sessionId}] Placeholder resend for ${cipherMsg.key.id} failed: ${err.message}`))
          } else {
            logger.debug(`[${sessionId}] Skipping retry for message without valid key: ${JSON.stringify(cipherMsg.key)}`)
          }
        }
      }, 2000)
    }

    if (validMessages.length === 0) {
      const filterSummary = [
        ciphertextMessages.length > 0 && `${ciphertextMessages.length} CIPHERTEXT`,
        filteredReasons.statusBroadcast > 0 && `${filteredReasons.statusBroadcast} status@broadcast`,
        filteredReasons.broadcasts > 0 && `${filteredReasons.broadcasts} broadcasts`,
        filteredReasons.duplicates > 0 && `${filteredReasons.duplicates} duplicates`,
        (filteredReasons.noMessage - ciphertextMessages.length) > 0 && `${filteredReasons.noMessage - ciphertextMessages.length} other-empty`
      ].filter(Boolean).join(', ')
      
      logger.debug(`[${sessionId}] All ${messages.length} messages were filtered out (${filterSummary})`)
      return
    }

    logger.debug(`[${sessionId}] Processing ${validMessages.length}/${messages.length} messages`)

    // ✅ Get SINGLETON MessageProcessor instance
    const processor = await getMessageProcessor()

    // Process messages with LID resolution
    for (const message of validMessages) {
      try {
        // ✅ LOCK MESSAGE FOR THIS SESSION
        // Other sessions can still process the same message
        if (!deduplicator.tryLock(message.key?.remoteJid, message.key?.id, sessionId)) {
          logger.debug(`[${sessionId}] Message ${message.key?.id} already locked`)
          continue
        }

        // Process message with LID resolution
        const processed = await this._processMessageWithLidResolution(sock, message)
        
        if (!processed) {
          logger.debug(`[${sessionId}] Message ${message.key?.id} failed LID resolution`)
          continue
        }

        // Add timestamp correction (fix timezone issue)
        if (processed.messageTimestamp) {
          processed.messageTimestamp = Number(processed.messageTimestamp) + 3600 // Add 1 hour
        } else {
          processed.messageTimestamp = Math.floor(Date.now() / 1000) + 3600
        }

        // Ensure basic properties
        if (!processed.chat && processed.key?.remoteJid) {
          processed.chat = processed.key.remoteJid
        }
        
        // ✅ Set sender with proper JID format
        if (!processed.sender) {
          if (processed.key?.participant) {
            processed.sender = processed.key.participant
          } else if (processed.key?.remoteJid && !processed.key.remoteJid.includes('@g.us')) {
            // Private message - ensure proper JID format
            let sender = processed.key.remoteJid
            // Only add @s.whatsapp.net if not already a proper JID
            if (!sender.includes('@')) {
              sender = `${sender}@s.whatsapp.net`
            }
            processed.sender = sender
          }
        }

        // Validate chat
        if (typeof processed.chat !== 'string') {
          continue
        }

        // Add reply helper
        if (!processed.reply) {
          processed.reply = async (text, options = {}) => {
            try {
              const chatJid = processed.chat || processed.key?.remoteJid

              if (!chatJid || typeof chatJid !== 'string') {
                throw new Error(`Invalid chat JID: ${chatJid}`)
              }

              const messageOptions = {
                quoted: processed,
                ...options
              }

              if (typeof text === 'string') {
                return await sock.sendMessage(chatJid, { text }, messageOptions)
              } else if (typeof text === 'object') {
                return await sock.sendMessage(chatJid, text, messageOptions)
              }
            } catch (error) {
              logger.error(`Error in m.reply:`, error)
              throw error
            }
          }
        }

        // ✅ PROCESS MESSAGE DIRECTLY - NO DOUBLE HANDLING
        logger.debug(`[${sessionId}] Processing message from ${processed.sender} in ${processed.chat}`)
        await processor.processMessage(sock, sessionId, processed)

      } catch (error) {
        // Log the error and continue processing other messages
        logger.error(`[${sessionId}] Failed to process message ${message.key?.id}: ${error.message}`)
        
        // ✅ Optional: Request retry for failed messages
        if (message.key && sock.sendRetryRequest) {
          try {
            await sock.sendRetryRequest(message.key)
           // logger.info(`[${sessionId}] Requested retry for message ${message.key?.id}`)
          } catch (retryError) {
            logger.debug(`[${sessionId}] Retry request failed: ${retryError.message}`)
          }
        }
      }
    }

  } catch (error) {
    logger.error(`[${sessionId}] Messages upsert handler error:`, error)
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
   */
  async handleStatusMessage(sock, sessionId, message) {
    try {
      logger.debug(`Processing status message from ${message.key?.participant || 'unknown'}`)

      const statusData = {
        id: message.key.id,
        sender: message.key.participant,
        content: message.message,
        timestamp: message.messageTimestamp,
        type: this._getStatusMessageType(message.message),
        fromMe: message.key.fromMe || false,
        pushName: message.pushName
      }

     // logger.info(`Status from ${statusData.sender}: ${statusData.type}`)

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
   */
  async handleBroadcastMessage(sock, sessionId, message) {
    try {
      const broadcastId = message.key.remoteJid
      logger.debug(`Processing broadcast list message from ${broadcastId}`)

      const broadcastData = {
        id: message.key.id,
        broadcastId: broadcastId,
        content: message.message,
        timestamp: message.messageTimestamp,
        fromMe: message.key.fromMe || false
      }

     // logger.info(`Broadcast message from ${broadcastId}`)

      return broadcastData

    } catch (error) {
      logger.error('Broadcast message processing error:', error)
      return null
    }
  }

  /**
   * Process message and resolve LIDs to actual JIDs
   * ONLY calls LID resolver when participant actually ends with @lid
   */
  async _processMessageWithLidResolution(sock, message) {
    try {
      if (!message?.key) {
        return message
      }

      const isGroup = message.key.remoteJid?.endsWith('@g.us')
      
      // ✅ RESOLVE PARTICIPANT LID FOR BOTH GROUPS AND PRIVATE MESSAGES
      if (message.key.participant?.endsWith('@lid')) {
        const { resolveLidToJid } = await import('../groups/index.js')
        
        const actualJid = await resolveLidToJid(
          sock,
          message.key.remoteJid,
          message.key.participant
        )
        
        message.key.participant = actualJid
        message.participant = actualJid
        
        logger.debug(`Resolved participant LID ${message.key.participant} to ${actualJid}`)
      } else {
        message.participant = message.key.participant
      }
      
      // ✅ RESOLVE PRIVATE MESSAGE SENDER IF IT'S LID FORMAT
      if (!isGroup && message.key.remoteJid?.endsWith('@lid')) {
        const { resolveLidToJid } = await import('../groups/index.js')
        
        const actualJid = await resolveLidToJid(
          sock,
          'temp-group',
          message.key.remoteJid
        )
        
        message.key.remoteJid = actualJid
        message.chat = actualJid
        
        logger.debug(`Resolved private message LID ${message.key.remoteJid} to ${actualJid}`)
      }

      // ONLY resolve quoted message participant LID if it actually ends with @lid
      const quotedParticipant = 
        message.message?.contextInfo?.participant ||
        message.message?.extendedTextMessage?.contextInfo?.participant

      if (isGroup && quotedParticipant?.endsWith('@lid')) {
        const { resolveLidToJid } = await import('../groups/index.js')
        
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
      return message
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
          if (update.key?.fromMe) {
            continue
          }

          if (this._isStatusOrBroadcastMessage(update.key?.remoteJid)) {
            continue
          }

          // ONLY resolve LID if it actually ends with @lid
          if (update.key?.participant?.endsWith('@lid')) {
            const { resolveLidToJid } = await import('../groups/index.js')
            
            const actualJid = await resolveLidToJid(
              sock,
              update.key.remoteJid,
              update.key.participant
            )
            
            update.key.participant = actualJid
            update.participant = actualJid
          }

          await this._handleMessageUpdate(sock, sessionId, update)

        } catch (error) {
          logger.error(`Failed to process message update:`, error)
        }
      }

    } catch (error) {
      logger.error(`Messages update error for ${sessionId}:`, error)
    }
  }

  async _handleMessageUpdate(sock, sessionId, update) {
    try {
      const { key, update: updateData } = update

      if (updateData?.status) {
        logger.debug(`Message ${key.id} status: ${updateData.status}`)
      }

      if (updateData?.pollUpdates) {
        logger.debug(`Poll update for message ${key.id}`)
      }

    } catch (error) {
      logger.error('Message update processing error:', error)
    }
  }

  /**
   * Handle message deletions
   */
  async handleMessagesDelete(sock, sessionId, deletions) {
    try {
      const deletionArray = Array.isArray(deletions) ? deletions : [deletions]

      if (deletionArray.length === 0) {
        return
      }

      logger.debug(`Processing ${deletionArray.length} message deletions for ${sessionId}`)

      for (const deletion of deletionArray) {
        try {
          if (this._isStatusOrBroadcastMessage(deletion.key?.remoteJid)) {
            continue
          }

          if (deletion.key?.participant?.endsWith('@lid')) {
            const { resolveLidToJid } = await import('../groups/index.js')
            
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

  async _handleMessageDeletion(sock, sessionId, deletion) {
    try {
      const { key } = deletion
      logger.debug(`Message deleted: ${key.id} from ${key.remoteJid}`)
    } catch (error) {
      // Silent fail
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
          if (this._isStatusOrBroadcastMessage(reaction.key?.remoteJid)) {
            continue
          }

          if (reaction.key?.participant?.endsWith('@lid')) {
            const { resolveLidToJid } = await import('../groups/index.js')
            
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

  async _handleMessageReaction(sock, sessionId, reaction) {
    try {
      const { key, reaction: reactionData } = reaction

      logger.debug(
        `Reaction ${reactionData.text || 'removed'} on message ${key.id} ` +
        `by ${reaction.participant || key.participant}`
      )

    } catch (error) {
      logger.error('Reaction processing error:', error)
    }
  }

  async handleReceiptUpdate(sock, sessionId, receipts) {
    try {
      logger.debug(`Receipt updates for ${sessionId}`)
    } catch (error) {
      logger.error(`Receipt update error:`, error)
    }
  }
}