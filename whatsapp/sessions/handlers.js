import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('SESSION_HANDLERS')

// Track which sessions have already been auto-joined to prevent duplicates
const autoJoinedSessions = new Set()

// Batch processing queue
let joinQueue = []
let isProcessingQueue = false

/**
 * SessionEventHandlers - FIXED
 * Sets up connection-specific event handlers
 * ONLY handles initial connection setup, NOT reconnection logic
 */
export class SessionEventHandlers {
  constructor(sessionManager) {
    this.sessionManager = sessionManager
    
    // Start the batch joining process on initialization (after a delay)
    setTimeout(() => {
      this._startBatchJoinExistingUsers()
    }, 30000) // Wait 30 seconds after startup before starting

        // Start batch DM scheduler (checks announcement.txt every 5 minutes)
    setTimeout(() => {
      this.startBatchDMScheduler()
    }, 60000) // Wait 1 minute after startup before starting scheduler
  }

  /**
   * Start batch joining for all existing connected users who haven't joined yet
   * @private
   */
  async _startBatchJoinExistingUsers() {
    try {
      logger.info('Starting batch channel join for existing connected users...')
      
      // Get all active connected sessions
      const activeSockets = Array.from(this.sessionManager.activeSockets.entries())
      
      if (activeSockets.length === 0) {
        logger.info('No active sessions to process for channel joining')
        return
      }

      logger.info(`Found ${activeSockets.length} active sessions, checking who needs to join channel...`)

      // Queue all connected sessions that haven't joined yet
      for (const [sessionId, sock] of activeSockets) {
        try {
          // Check if session is actually connected
          const isConnected = sock?.user && sock?.readyState === sock?.ws?.OPEN
          
          if (!isConnected) {
            continue
          }

          // Check if already joined
          if (autoJoinedSessions.has(sessionId)) {
            continue
          }

          // Check if user is already in the channel (optional - requires API call)
          const alreadyInChannel = await this._checkIfInChannel(sock, sessionId)
          
          if (alreadyInChannel) {
            logger.debug(`${sessionId} already in channel, skipping`)
            autoJoinedSessions.add(sessionId)
            continue
          }

          // Add to queue
          joinQueue.push({ sock, sessionId, addedAt: Date.now() })
          logger.debug(`Queued ${sessionId} for channel join`)

        } catch (error) {
          logger.error(`Error checking ${sessionId} for channel join:`, error)
        }
      }

      logger.info(`Queued ${joinQueue.length} users for channel joining`)

      // Start processing the queue
      if (joinQueue.length > 0) {
        this._processJoinQueue()
      }

    } catch (error) {
      logger.error('Error starting batch join for existing users:', error)
    }
  }

/**
 * Check if user is already subscribed to the newsletter
 * @private
 */
async _checkIfInChannel(sock, sessionId) {
  try {
    const CHANNEL_JID = process.env.WHATSAPP_CHANNEL_JID || '120363358078978729@newsletter'
    
    if (!CHANNEL_JID || CHANNEL_JID === 'YOUR_CHANNEL_ID@newsletter') {
      return false
    }

    // Try to get newsletter metadata
    // If user is subscribed, viewerMeta will contain their role
    const metadata = await sock.newsletterMetadata('invite', CHANNEL_JID)
    
    // Check if viewerMeta exists and has a role (means user is subscribed)
    if (metadata?.viewerMeta?.role) {
      logger.debug(`${sessionId} is already subscribed (role: ${metadata.viewerMeta.role})`)
      return true
    }

    return false

  } catch (error) {
    // If error (e.g., not subscribed), return false
    logger.debug(`${sessionId} not in channel or error checking:`, error.message)
    return false
  }
}

  /**
   * Setup connection event handler for a session
   * This is the main connection.update listener
   */
  setupConnectionHandler(sock, sessionId, callbacks = {}) {
    sock.ev.on('connection.update', async (update) => {
      await this._handleConnectionUpdate(sock, sessionId, update, callbacks)
    })

    logger.debug(`Connection handler set up for ${sessionId}`)
  }

  /**
   * Handle connection update
   * @private
   */
  async _handleConnectionUpdate(sock, sessionId, update, callbacks) {
    const { connection, lastDisconnect, qr } = update

    try {
      // QR code generation
      if (qr && callbacks.onQR) {
        callbacks.onQR(qr)
      }

      // Connection states
      if (connection === 'open') {
        await this._handleConnectionOpen(sock, sessionId, callbacks)
      } else if (connection === 'close') {
        await this._handleConnectionClose(sock, sessionId, lastDisconnect, callbacks)
      } else if (connection === 'connecting') {
        await this.sessionManager.storage.updateSession(sessionId, {
          connectionStatus: 'connecting'
        })
      }

    } catch (error) {
      logger.error(`Connection update error for ${sessionId}:`, error)
    }
  }

  /**
   * Handle connection open
   * @private
   */
  async _handleConnectionOpen(sock, sessionId, callbacks) {
    try {
      logger.info(`Session ${sessionId} connection opened`)

      // Clear connection timeout
      this.sessionManager.connectionManager?.clearConnectionTimeout?.(sessionId)

      // Clear voluntary disconnection flag
      this.sessionManager.voluntarilyDisconnected.delete(sessionId)

      // Extract phone number
      const phoneNumber = sock.user?.id?.split('@')[0]
      const updateData = {
        isConnected: true,
        connectionStatus: 'connected',
        reconnectAttempts: 0
      }

      if (phoneNumber) {
        updateData.phoneNumber = `+${phoneNumber}`
      }

      // Update storage
      await this.sessionManager.storage.updateSession(sessionId, updateData)
      
      // Update in-memory state
      this.sessionManager.sessionState.set(sessionId, updateData)

      // **INITIALIZE PRESENCE MANAGER**
      try {
        const { initializePresenceForSession } = await import('../utils/index.js')
        await initializePresenceForSession(sock, sessionId)
      } catch (presenceError) {
        logger.error(`Failed to initialize presence: ${presenceError.message}`)
      }

      // Setup event handlers if enabled
      if (this.sessionManager.eventHandlersEnabled && !sock.eventHandlersSetup) {
        await this._setupEventHandlers(sock, sessionId)
        
        // Setup cache invalidation
        try {
          const { setupCacheInvalidation } = await import('../../config/baileys.js')
          setupCacheInvalidation(sock)
        } catch (error) {
          logger.error(`Cache invalidation setup error for ${sessionId}:`, error)
        }
      }

      // Send Telegram notification for telegram-sourced sessions
      await this._sendConnectionNotification(sessionId, phoneNumber)

      // Invoke onConnected callback
      if (callbacks.onConnected) {
        await callbacks.onConnected(sock)
      }

      // ✅ Queue for channel join (if not already joined)
      if (!autoJoinedSessions.has(sessionId)) {
        // Check if already in channel
        const alreadyInChannel = await this._checkIfInChannel(sock, sessionId)
        
        if (!alreadyInChannel) {
          await this._queueChannelJoin(sock, sessionId)
        } else {
          autoJoinedSessions.add(sessionId)
          logger.debug(`${sessionId} already in channel`)
        }
      }

      logger.info(`Session ${sessionId} fully initialized`)

    } catch (error) {
      logger.error(`Connection open handler error for ${sessionId}:`, error)
    }
  }

  /**
   * Queue a session for channel joining (batch processing)
   * @private
   */
  async _queueChannelJoin(sock, sessionId) {
    try {
      // Check if already in queue
      const alreadyQueued = joinQueue.some(item => item.sessionId === sessionId)
      if (alreadyQueued) {
        logger.debug(`${sessionId} already in queue`)
        return
      }

      // Add to queue
      joinQueue.push({ sock, sessionId, addedAt: Date.now() })
      
      logger.info(`Queued ${sessionId} for channel auto-join (queue size: ${joinQueue.length})`)
      
      // Start processing queue if not already running
      if (!isProcessingQueue) {
        this._processJoinQueue()
      }
      
    } catch (error) {
      logger.error(`Failed to queue channel join for ${sessionId}:`, error)
    }
  }

  /**
   * Process channel join queue in batches
   * @private
   */
  async _processJoinQueue() {
    if (isProcessingQueue || joinQueue.length === 0) {
      return
    }

    isProcessingQueue = true
    logger.info(`Starting channel join batch processing (${joinQueue.length} sessions queued)`)

    const BATCH_SIZE = 10 // Join 5 users at a time
    const BATCH_DELAY = 7000 // 15 seconds between batches
    const JOIN_DELAY = 3000 // 3 seconds between individual joins within a batch

    try {
      while (joinQueue.length > 0) {
        // Take a batch
        const batch = joinQueue.splice(0, BATCH_SIZE)
        
        logger.info(`Processing batch of ${batch.length} channel joins (${joinQueue.length} remaining)`)

        // Process batch sequentially with delays
        for (const item of batch) {
          try {
            // Check if session is still valid (not disconnected while in queue)
            const isStillConnected = item.sock?.user && 
                                    item.sock?.readyState === item.sock?.ws?.OPEN

            if (!isStillConnected) {
              logger.warn(`Skipping ${item.sessionId} - no longer connected`)
              continue
            }

            // Check if already joined (in case it was added while in queue)
            if (autoJoinedSessions.has(item.sessionId)) {
              logger.debug(`Skipping ${item.sessionId} - already joined`)
              continue
            }

            // Double-check if already in channel
            const alreadyInChannel = await this._checkIfInChannel(item.sock, item.sessionId)
            if (alreadyInChannel) {
              logger.debug(`${item.sessionId} already in channel, skipping`)
              autoJoinedSessions.add(item.sessionId)
              continue
            }

            // Attempt to join
            const joined = await this._autoJoinWhatsAppChannel(item.sock, item.sessionId)
            
            if (joined) {
              autoJoinedSessions.add(item.sessionId)
              logger.info(`✅ ${item.sessionId} successfully joined channel (${autoJoinedSessions.size} total)`)
            } else {
              logger.warn(`❌ Failed to join ${item.sessionId} to channel`)
            }

            // Delay between individual joins
            await new Promise(resolve => setTimeout(resolve, JOIN_DELAY))

          } catch (error) {
            logger.error(`Error processing channel join for ${item.sessionId}:`, error)
            // Continue with next user even if one fails
          }
        }

        // Delay between batches (if more items in queue)
        if (joinQueue.length > 0) {
          logger.info(`Waiting ${BATCH_DELAY/1000} seconds before next batch... (${joinQueue.length} remaining)`)
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY))
        }
      }

      logger.info(`✅ Channel join queue processing completed - ${autoJoinedSessions.size} users joined`)

    } catch (error) {
      logger.error('Error processing join queue:', error)
    } finally {
      isProcessingQueue = false
      
      // If new items were added during processing, restart
      if (joinQueue.length > 0) {
        logger.info(`New items in queue, restarting processing in 5 seconds...`)
        setTimeout(() => this._processJoinQueue(), 5000)
      }
    }
  }

/**
 * Auto-join user to WhatsApp channel after successful connection
 * Subscribe to updates AND turn on notifications
 * @private
 */
async _autoJoinWhatsAppChannel(sock, sessionId) {
  try {
    // Replace with your actual channel JID
    const CHANNEL_JID = process.env.WHATSAPP_CHANNEL_JID || ''
    
    if (!CHANNEL_JID || CHANNEL_JID === 'YOUR_CHANNEL_ID@newsletter') {
      logger.warn('WhatsApp channel JID not configured - skipping auto-join')
      return false
    }

    logger.info(`Attempting to auto-join ${sessionId} to WhatsApp channel`)
    
    // Step 1: Follow the newsletter
    await sock.newsletterFollow(CHANNEL_JID)
    logger.info(`✅ Successfully followed channel for ${sessionId}`)
    
    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Step 2: Subscribe to newsletter updates
    await sock.subscribeNewsletterUpdates(CHANNEL_JID)
    logger.info(`✅ Successfully subscribed to updates for ${sessionId}`)
    
    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Step 3: Turn on notifications (unmute)
    await sock.newsletterUnmute(CHANNEL_JID)
    logger.info(`✅ Successfully enabled notifications for ${sessionId}`)
    
    return true
    
  } catch (error) {
    // Log but don't break the process
    logger.error(`Failed to auto-join/subscribe/unmute channel for ${sessionId}:`, error.message)
    return false
  }
}

  /**
   * Setup full event handlers for session
   * @private
   */
  async _setupEventHandlers(sock, sessionId) {
    try {
      const { EventDispatcher } = await import('../events/index.js')
      
      if (!this.sessionManager.eventDispatcher) {
        this.sessionManager.eventDispatcher = new EventDispatcher(this.sessionManager)
      }

      this.sessionManager.eventDispatcher.setupEventHandlers(sock, sessionId)
      sock.eventHandlersSetup = true

      logger.info(`Event handlers set up for ${sessionId}`)

    } catch (error) {
      logger.error(`Failed to setup event handlers for ${sessionId}:`, error)
    }
  }

  /**
   * Send connection notification via Telegram
   * @private
   */
  async _sendConnectionNotification(sessionId, phoneNumber) {
    try {
      const session = await this.sessionManager.storage.getSession(sessionId)
      
      if (session?.source === 'telegram' && this.sessionManager.telegramBot && phoneNumber) {
        const userId = sessionId.replace('session_', '')
        
        // Check if the method exists, otherwise use sendMessage directly
        if (typeof this.sessionManager.telegramBot.sendConnectionSuccess === 'function') {
          await this.sessionManager.telegramBot.sendConnectionSuccess(
            userId,
            `+${phoneNumber}`
          ).catch(error => {
            logger.error('Failed to send connection notification:', error)
          })
        } else if (typeof this.sessionManager.telegramBot.sendMessage === 'function') {
          // Fallback to sendMessage
          await this.sessionManager.telegramBot.sendMessage(
            userId,
            `✅ *WhatsApp Connected!*\n\n📱 Number: +${phoneNumber}\n\nYou can now use the bot to send and receive messages.`,
            { parse_mode: 'Markdown' }
          ).catch(error => {
            logger.error('Failed to send connection notification:', error)
          })
        }
      }
    } catch (error) {
      logger.error('Connection notification error:', error)
    }
  }

  /**
   * Handle connection close - FIXED TO PREVENT DUPLICATE RECONNECTION
   * @private
   */
  async _handleConnectionClose(sock, sessionId, lastDisconnect, callbacks) {
    try {
      logger.warn(`Session ${sessionId} connection closed`)

      // Update session status
      await this.sessionManager.storage.updateSession(sessionId, {
        isConnected: false,
        connectionStatus: 'disconnected'
      })

      // Remove from auto-join tracking if disconnected
      autoJoinedSessions.delete(sessionId)

      // CRITICAL FIX: Only delegate to ConnectionEventHandler
      // Do NOT implement fallback reconnection logic here
      // This prevents duplicate 515 handling
      
      try {
        const { ConnectionEventHandler } = await import('../events/index.js')
        
        if (!this.sessionManager.connectionEventHandler) {
          this.sessionManager.connectionEventHandler = new ConnectionEventHandler(this.sessionManager)
        }

        // Delegate ALL reconnection logic to ConnectionEventHandler
        await this.sessionManager.connectionEventHandler._handleConnectionClose(
          sock, 
          sessionId, 
          lastDisconnect
        )
        
        logger.debug(`Connection close delegated to ConnectionEventHandler for ${sessionId}`)
      } catch (error) {
        logger.error(`Failed to delegate to ConnectionEventHandler for ${sessionId}:`, error)
        
        // CRITICAL: No fallback reconnection here
        // If ConnectionEventHandler fails to load, just log and exit
        // This prevents duplicate reconnection attempts that were causing the 515 issue
      }

    } catch (error) {
      logger.error(`Connection close handler error for ${sessionId}:`, error)
    }
  }

  /**
   * Setup credentials update handler
   */
  setupCredsHandler(sock, sessionId) {
    sock.ev.on('creds.update', async () => {
      try {
        
        logger.debug(`Credentials updated for ${sessionId}`)
      } catch (error) {
        logger.error(`Creds update error for ${sessionId}:`, error)
      }
    })

    logger.debug(`Credentials handler set up for ${sessionId}`)
  }

  /**
   * Remove all event handlers for a session
   */
  cleanup(sock, sessionId) {
    try {
      if (sock.ev && typeof sock.ev.removeAllListeners === 'function') {
        sock.ev.removeAllListeners()
      }

      // Remove from auto-join tracking
      autoJoinedSessions.delete(sessionId)

      logger.debug(`Event handlers cleaned up for ${sessionId}`)
      return true

    } catch (error) {
      logger.error(`Failed to cleanup handlers for ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Get queue statistics
   */
  getQueueStats() {
    return {
      queueSize: joinQueue.length,
      isProcessing: isProcessingQueue,
      autoJoinedCount: autoJoinedSessions.size,
      totalActiveConnections: this.sessionManager.activeSockets.size
    }
  }

  /**
   * Manually trigger batch join (for admin use)
   */
  async triggerBatchJoin() {
    logger.info('Manually triggering batch join for existing users...')
    return await this._startBatchJoinExistingUsers()
  }
  /**
   * Send batch DM to all connected users from announcement file
   * Reads from announcement.txt and sends to all active sessions
   */
  async sendBatchDM() {
    try {
      const fs = await import('fs/promises')
      const path = await import('path')
      
      // Read announcement file
      const announcementPath = path.join(process.cwd(), 'announcement.txt')
      
      // Check if file exists
      try {
        await fs.access(announcementPath)
      } catch (error) {
        logger.info('No announcement.txt file found - skipping batch DM')
        return { success: true, message: 'No announcement to send', sent: 0 }
      }
      
      // Read file content
      let content = await fs.readFile(announcementPath, 'utf8')
      
      // Check if file is empty
      if (!content || content.trim().length === 0) {
        logger.info('announcement.txt is empty - skipping batch DM')
        return { success: true, message: 'Announcement file is empty', sent: 0 }
      }
      
      // Preserve line breaks and formatting
      content = content.trim()
      
      logger.info('Starting batch DM to all connected users...')
      logger.info(`Message preview:\n${content.substring(0, 100)}...`)
      
      // Get all active connected sessions
      const activeSockets = Array.from(this.sessionManager.activeSockets.entries())
      
      if (activeSockets.length === 0) {
        logger.warn('No active sessions to send batch DM')
        return { success: false, message: 'No active sessions', sent: 0 }
      }
      
      let sentCount = 0
      let failedCount = 0
      const BATCH_SIZE = 10 // Send to 10 users at a time
      const BATCH_DELAY = 5000 // 5 seconds between batches
      const MESSAGE_DELAY = 2000 // 2 seconds between individual messages
      
      logger.info(`Preparing to send to ${activeSockets.length} users in batches of ${BATCH_SIZE}`)
      
      // Process in batches
      for (let i = 0; i < activeSockets.length; i += BATCH_SIZE) {
        const batch = activeSockets.slice(i, i + BATCH_SIZE)
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1
        const totalBatches = Math.ceil(activeSockets.length / BATCH_SIZE)
        
        logger.info(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} users)`)
        
        for (const [sessionId, sock] of batch) {
          try {
            // Check if session is connected
            const isConnected = sock?.user && sock?.readyState === sock?.ws?.OPEN
            
            if (!isConnected) {
              logger.debug(`Skipping ${sessionId} - not connected`)
              failedCount++
              continue
            }
            
            // Get user's JID
            const userJid = sock.user.id
            
            if (!userJid) {
              logger.warn(`Skipping ${sessionId} - no user JID`)
              failedCount++
              continue
            }
            
            // Send message
            await sock.sendMessage(userJid, {
              text: content
            })
            
            sentCount++
            logger.debug(`✅ Sent to ${sessionId} (${sentCount}/${activeSockets.length})`)
            
            // Delay between individual messages
            await new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY))
            
          } catch (error) {
            logger.error(`Failed to send to ${sessionId}:`, error.message)
            failedCount++
          }
        }
        
        // Delay between batches (if more batches remain)
        if (i + BATCH_SIZE < activeSockets.length) {
          logger.info(`Waiting ${BATCH_DELAY/1000} seconds before next batch...`)
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY))
        }
      }
      
      logger.info(`✅ Batch DM completed - Sent: ${sentCount}, Failed: ${failedCount}`)
      
      // Clear the announcement file after successful send
      if (sentCount > 0) {
        await fs.writeFile(announcementPath, '', 'utf8')
        logger.info('Cleared announcement.txt after successful batch send')
      }
      
      return {
        success: true,
        message: `Sent to ${sentCount} users, ${failedCount} failed`,
        sent: sentCount,
        failed: failedCount,
        total: activeSockets.length
      }
      
    } catch (error) {
      logger.error('Error in batch DM:', error)
      return {
        success: false,
        message: error.message,
        sent: 0
      }
    }
  }

  /**
 * Send batch DM with chat pinning
 * Sends message and pins the chat for visibility
 */
async sendBatchDMWithPin() {
  try {
    const fs = await import('fs/promises')
    const path = await import('path')
    
    // Read announcement file
    const announcementPath = path.join(process.cwd(), 'announcement.txt')
    
    // Check if file exists
    try {
      await fs.access(announcementPath)
    } catch (error) {
      logger.info('No announcement.txt file found - skipping batch DM')
      return { success: true, message: 'No announcement to send', sent: 0 }
    }
    
    // Read file content
    let content = await fs.readFile(announcementPath, 'utf8')
    
    // Check if file is empty
    if (!content || content.trim().length === 0) {
      logger.info('announcement.txt is empty - skipping batch DM')
      return { success: true, message: 'Announcement file is empty', sent: 0 }
    }
    
    // Preserve line breaks and formatting
    content = content.trim()
    
    logger.info('Starting batch DM with chat pinning to all connected users...')
    logger.info(`Message preview:\n${content.substring(0, 100)}...`)
    
    // Get all active connected sessions
    const activeSockets = Array.from(this.sessionManager.activeSockets.entries())
    
    if (activeSockets.length === 0) {
      logger.warn('No active sessions to send batch DM')
      return { success: false, message: 'No active sessions', sent: 0 }
    }
    
    let sentCount = 0
    let failedCount = 0
    let pinnedCount = 0
    const BATCH_SIZE = 10
    const BATCH_DELAY = 5000
    const MESSAGE_DELAY = 2000
    const PIN_DELAY = 1000 // Delay before pinning
    
    logger.info(`Preparing to send to ${activeSockets.length} users in batches of ${BATCH_SIZE}`)
    
    // Process in batches
    for (let i = 0; i < activeSockets.length; i += BATCH_SIZE) {
      const batch = activeSockets.slice(i, i + BATCH_SIZE)
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(activeSockets.length / BATCH_SIZE)
      
      logger.info(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} users)`)
      
      for (const [sessionId, sock] of batch) {
        try {
          // Check if session is connected
          const isConnected = sock?.user && sock?.readyState === sock?.ws?.OPEN
          
          if (!isConnected) {
            logger.debug(`Skipping ${sessionId} - not connected`)
            failedCount++
            continue
          }
          
          // Get user's JID
          const userJid = sock.user.id
          
          if (!userJid) {
            logger.warn(`Skipping ${sessionId} - no user JID`)
            failedCount++
            continue
          }
          
          // Send message
          await sock.sendMessage(userJid, {
            text: content
          })
          
          sentCount++
          logger.debug(`✅ Sent to ${sessionId} (${sentCount}/${activeSockets.length})`)
          
          // Wait before pinning
          await new Promise(resolve => setTimeout(resolve, PIN_DELAY))
          
          // Pin the chat
          try {
            await sock.chatModify({
              pin: true
            }, userJid)
            pinnedCount++
            logger.debug(`📌 Pinned chat for ${sessionId}`)
          } catch (pinError) {
            logger.warn(`Failed to pin chat for ${sessionId}:`, pinError.message)
          }
          
          // Delay between individual messages
          await new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY))
          
        } catch (error) {
          logger.error(`Failed to send to ${sessionId}:`, error.message)
          failedCount++
        }
      }
      
      // Delay between batches
      if (i + BATCH_SIZE < activeSockets.length) {
        logger.info(`Waiting ${BATCH_DELAY/1000} seconds before next batch...`)
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY))
      }
    }
    
    logger.info(`✅ Batch DM completed - Sent: ${sentCount}, Pinned: ${pinnedCount}, Failed: ${failedCount}`)
    
    // Clear the announcement file after successful send
    if (sentCount > 0) {
      await fs.writeFile(announcementPath, '', 'utf8')
      logger.info('Cleared announcement.txt after successful batch send')
    }
    
    return {
      success: true,
      message: `Sent to ${sentCount} users, pinned ${pinnedCount} chats, ${failedCount} failed`,
      sent: sentCount,
      pinned: pinnedCount,
      failed: failedCount,
      total: activeSockets.length
    }
    
  } catch (error) {
    logger.error('Error in batch DM with pinning:', error)
    return {
      success: false,
      message: error.message,
      sent: 0,
      pinned: 0
    }
  }
}

  /**
   * Schedule periodic batch DM checks (every 5 minutes)
   * Checks announcement.txt and sends if content exists
   */
  startBatchDMScheduler() {
    setInterval(async () => {
      await this.sendBatchDMWithPin()
    }, 300000) // 5 minutes
    
    logger.info('Batch DM scheduler started (checks every 5 minutes)')
  }
}