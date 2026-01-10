import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('MESSAGE_EVENTS')

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
 * Processes: new messages, updates, deletions, reactions, status messages
 */
export class MessageEventHandler {
  constructor() {
    this.statusBroadcastJid = 'status@broadcast'
  }

  /**
   * Main message handler with deduplication and CIPHERTEXT retry
   */
  async handleMessagesUpsert(sock, sessionId, messageUpdate) {
    try {
      const { messages, type } = messageUpdate

      if (!messages || messages.length === 0) {
        logger.debug(`[${sessionId}] Empty messages.upsert`)
        return
      }

      // Handle presence updates
      await this._handlePresenceUpdates(sock, sessionId, messages)

      // Handle status messages (auto-view/like)
      await this._handleStatusMessages(sock, sessionId, messages)

      // Filter and categorize messages
      const { validMessages, ciphertextMessages, filterStats } = 
        await this._filterMessages(sessionId, messages)

      // Request retry for CIPHERTEXT messages
      if (ciphertextMessages.length > 0) {
        await this._requestMessageRetries(sock, sessionId, ciphertextMessages)
      }

      // Log filtering summary
      if (validMessages.length === 0) {
        this._logFilterSummary(sessionId, messages.length, ciphertextMessages.length, filterStats)
        return
      }

      logger.debug(`[${sessionId}] Processing ${validMessages.length}/${messages.length} messages`)

      // Process valid messages
      await this._processValidMessages(sock, sessionId, validMessages)

    } catch (error) {
      logger.error(`[${sessionId}] Messages upsert handler error:`, error)
    }
  }

  /**
   * Handle presence updates for received messages
   */
  async _handlePresenceUpdates(sock, sessionId, messages) {
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
    } catch (error) {
      logger.debug(`[${sessionId}] Presence handler error:`, error.message)
    }
  }

  /**
   * Handle status broadcast messages
   */
  async _handleStatusMessages(sock, sessionId, messages) {
    try {
      const { handleStatusMessage } = await import('../utils/index.js')
      
      for (const msg of messages) {
        if (msg.key?.remoteJid === this.statusBroadcastJid) {
          await handleStatusMessage(sock, sessionId, msg)
        }
      }
    } catch (error) {
      logger.debug(`[${sessionId}] Status handler error:`, error.message)
    }
  }

  /**
   * Filter messages and categorize them
   */
  async _filterMessages(sessionId, messages) {
    const { getMessageDeduplicator } = await import('../utils/index.js')
    const deduplicator = getMessageDeduplicator()
    
    const validMessages = []
    const ciphertextMessages = []
    const filterStats = {
      duplicates: 0,
      statusBroadcast: 0,
      broadcasts: 0,
      noMessage: 0
    }

    for (const msg of messages) {
      // Check for duplicates
      if (deduplicator.isDuplicate(msg.key?.remoteJid, msg.key?.id, sessionId)) {
        filterStats.duplicates++
        continue
      }

      // Skip status broadcast
      if (msg.key?.remoteJid === this.statusBroadcastJid) {
        filterStats.statusBroadcast++
        continue
      }

      // Skip other broadcasts
      if (msg.key?.remoteJid?.endsWith('@broadcast')) {
        filterStats.broadcasts++
        continue
      }

      // Handle messages without content
      if (!msg.message) {
        filterStats.noMessage++
        
        // CIPHERTEXT messages (stub type 2)
        if (msg.messageStubType === 2) {
          ciphertextMessages.push(msg)
        }
        continue
      }

      validMessages.push(msg)
    }

    return { validMessages, ciphertextMessages, filterStats }
  }

  /**
   * Request retry for CIPHERTEXT or failed messages
   */
  async _requestMessageRetries(sock, sessionId, ciphertextMessages) {
    logger.debug(`[${sessionId}] Requesting retry for ${ciphertextMessages.length} CIPHERTEXT messages`)

    for (const cipherMsg of ciphertextMessages) {
      if (!cipherMsg.key) continue

      // Validate key structure
      const retryKey = {
        remoteJid: cipherMsg.key.remoteJid,
        id: cipherMsg.key.id,
        fromMe: cipherMsg.key.fromMe || false,
        participant: cipherMsg.key.participant || undefined
      }

      if (!retryKey.remoteJid || !retryKey.id) {
        logger.debug(`[${sessionId}] Invalid key for retry: ${JSON.stringify(retryKey)}`)
        continue
      }

      // Try sendRetryRequest first, fallback to requestPlaceholderResend
      let retrySuccess = false

      if (sock.sendRetryRequest) {
        try {
          await sock.sendRetryRequest(retryKey)
          logger.debug(`[${sessionId}] Retry requested (sendRetryRequest): ${retryKey.id}`)
          retrySuccess = true
        } catch (error) {
          logger.debug(`[${sessionId}] sendRetryRequest failed for ${retryKey.id}: ${error.message}`)
        }
      }

      if (!retrySuccess && sock.requestPlaceholderResend) {
        try {
          await sock.requestPlaceholderResend(retryKey)
          logger.debug(`[${sessionId}] Retry requested (requestPlaceholderResend): ${retryKey.id}`)
        } catch (error) {
          logger.debug(`[${sessionId}] requestPlaceholderResend failed for ${retryKey.id}: ${error.message}`)
        }
      }
    }
  }

  /**
   * Log filtering summary
   */
  _logFilterSummary(sessionId, totalMessages, ciphertextCount, filterStats) {
    const summary = [
      ciphertextCount > 0 && `${ciphertextCount} CIPHERTEXT`,
      filterStats.statusBroadcast > 0 && `${filterStats.statusBroadcast} status`,
      filterStats.broadcasts > 0 && `${filterStats.broadcasts} broadcasts`,
      filterStats.duplicates > 0 && `${filterStats.duplicates} duplicates`,
      (filterStats.noMessage - ciphertextCount) > 0 && 
        `${filterStats.noMessage - ciphertextCount} empty`
    ].filter(Boolean).join(', ')

    logger.debug(`[${sessionId}] Filtered ${totalMessages} messages (${summary})`)
  }

  /**
   * Process valid messages
   */
  async _processValidMessages(sock, sessionId, validMessages) {
    const { getMessageDeduplicator } = await import('../utils/index.js')
    const deduplicator = getMessageDeduplicator()
    const processor = await getMessageProcessor()

    for (const message of validMessages) {
      try {
        // Lock message to prevent duplicate processing
        if (!deduplicator.tryLock(message.key?.remoteJid, message.key?.id, sessionId)) {
          continue
        }

        // Resolve LID to JID
        const processed = await this._processMessageWithLidResolution(sock, message)
        if (!processed) continue

        // Fix timestamp (timezone correction)
        processed.messageTimestamp = processed.messageTimestamp 
          ? Number(processed.messageTimestamp) + 3600 
          : Math.floor(Date.now() / 1000) + 3600

        // Set chat property
        if (!processed.chat && processed.key?.remoteJid) {
          processed.chat = processed.key.remoteJid
        }

        // Set sender property
        this._setSenderProperty(processed)

        // Validate chat
        if (typeof processed.chat !== 'string') continue

        // Add reply helper function
        processed.reply = this._createReplyFunction(sock, processed)

        // Process the message
        await processor.processMessage(sock, sessionId, processed)

      } catch (error) {
        logger.error(`[${sessionId}] Failed to process message ${message.key?.id}:`, error.message)

        // Retry on Bad MAC error
        if (this._isBadMacError(error) && message.key) {
          await this._requestMessageRetries(sock, sessionId, [message])
        }
      }
    }
  }

  /**
   * Set sender property with proper JID format
   */
  _setSenderProperty(processed) {
    if (!processed.sender) {
      if (processed.key?.participant) {
        processed.sender = processed.key.participant
      } else if (processed.key?.remoteJid && !processed.key.remoteJid.includes('@g.us')) {
        let sender = processed.key.remoteJid
        if (!sender.includes('@')) {
          sender = `${sender}@s.whatsapp.net`
        }
        processed.sender = sender
      }
    }
  }

  /**
   * Create reply helper function
   */
  _createReplyFunction(sock, processed) {
    return async (text, options = {}) => {
      try {
        const chatJid = processed.chat || processed.key?.remoteJid

        if (!chatJid || typeof chatJid !== 'string') {
          throw new Error(`Invalid chat JID: ${chatJid}`)
        }

        const messageOptions = { quoted: processed, ...options }

        if (typeof text === 'string') {
          return await sock.sendMessage(chatJid, { text }, messageOptions)
        } else if (typeof text === 'object') {
          return await sock.sendMessage(chatJid, text, messageOptions)
        }
      } catch (error) {
        logger.error(`Reply error:`, error)
        throw error
      }
    }
  }

  /**
   * Check if error is Bad MAC error
   */
  _isBadMacError(error) {
    return error.message?.includes('Bad MAC') || 
           error.message?.includes('decrypt')
  }

  /**
   * Resolve LID to actual JID for messages
   */
  async _processMessageWithLidResolution(sock, message) {
    try {
      if (!message?.key) return message

      const isGroup = message.key.remoteJid?.endsWith('@g.us')
      const { resolveLidToJid } = await import('../groups/index.js')

      // Resolve participant LID
      if (message.key.participant?.endsWith('@lid')) {
        const actualJid = await resolveLidToJid(
          sock,
          message.key.remoteJid,
          message.key.participant
        )
        message.key.participant = actualJid
        message.participant = actualJid
      } else {
        message.participant = message.key.participant
      }

      // Resolve private message sender LID
      if (!isGroup && message.key.remoteJid?.endsWith('@lid')) {
        const actualJid = await resolveLidToJid(
          sock,
          'temp-group',
          message.key.remoteJid
        )
        message.key.remoteJid = actualJid
        message.chat = actualJid
      }

      // Resolve quoted message participant LID
      const quotedParticipant = 
        message.message?.contextInfo?.participant ||
        message.message?.extendedTextMessage?.contextInfo?.participant

      if (isGroup && quotedParticipant?.endsWith('@lid')) {
        const actualJid = await resolveLidToJid(
          sock,
          message.key.remoteJid,
          quotedParticipant
        )

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
   * Handle message updates (delivery status, edits)
   */
  async handleMessagesUpdate(sock, sessionId, updates) {
    try {
      if (!updates || updates.length === 0) return

      logger.debug(`[${sessionId}] Processing ${updates.length} message updates`)

      for (const update of updates) {
        try {
          if (update.key?.fromMe) continue
          if (update.key?.remoteJid === this.statusBroadcastJid) continue
          if (update.key?.remoteJid?.endsWith('@broadcast')) continue

          // Resolve LID if needed
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
      logger.error(`[${sessionId}] Messages update error:`, error)
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

      if (deletionArray.length === 0) return

      logger.debug(`[${sessionId}] Processing ${deletionArray.length} message deletions`)

      for (const deletion of deletionArray) {
        try {
          if (deletion.key?.remoteJid === this.statusBroadcastJid) continue
          if (deletion.key?.remoteJid?.endsWith('@broadcast')) continue

          // Resolve LID if needed
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
      logger.error(`[${sessionId}] Messages delete error:`, error)
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
      if (!reactions || reactions.length === 0) return

      logger.debug(`[${sessionId}] Processing ${reactions.length} reactions`)

      for (const reaction of reactions) {
        try {
          if (reaction.key?.remoteJid === this.statusBroadcastJid) continue
          if (reaction.key?.remoteJid?.endsWith('@broadcast')) continue

          // Resolve LID if needed
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
      logger.error(`[${sessionId}] Messages reaction error:`, error)
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

  /**
   * Handle receipt updates (read receipts)
   */
  async handleReceiptUpdate(sock, sessionId, receipts) {
    try {
      logger.debug(`[${sessionId}] Receipt updates received`)
    } catch (error) {
      logger.error(`Receipt update error:`, error)
    }
  }

  /**
   * Handle status message specifically
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

      return statusData

    } catch (error) {
      logger.error('Status message processing error:', error)
      return null
    }
  }

  /**
   * Get status message content type
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

      return broadcastData

    } catch (error) {
      logger.error('Broadcast message processing error:', error)
      return null
    }
  }
}