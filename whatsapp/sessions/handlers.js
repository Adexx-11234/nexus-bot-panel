import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('SESSION_HANDLERS')

// Track which sessions have already been auto-joined to prevent duplicates
const autoJoinedSessions = new Set()

// Batch processing queue
let joinQueue = []
let isProcessingQueue = false

// 515 Flow Toggle - Set in environment variable
const ENABLE_515_FLOW = process.env.ENABLE_515_FLOW === 'true' // Default: false

/**
 * SessionEventHandlers
 * Sets up connection-specific event handlers
 */
export class SessionEventHandlers {
  constructor(sessionManager) {
    this.sessionManager = sessionManager
    
    logger.info(`515 Flow Mode: ${ENABLE_515_FLOW ? 'ENABLED' : 'DISABLED'}`)
    
    // Start the batch joining process on initialization (after a delay)
    setTimeout(() => {
      this._startBatchJoinExistingUsers()
    }, 30000)

    // Start batch DM scheduler
    setTimeout(() => {
      this.startBatchDMScheduler()
    }, 60000)
  }

  /**
   * Start batch joining for all existing connected users who haven't joined yet
   * @private
   */
  async _startBatchJoinExistingUsers() {
    try {
      logger.info('Starting batch channel join for existing connected users...')
      
      const activeSockets = Array.from(this.sessionManager.activeSockets.entries())
      
      if (activeSockets.length === 0) {
        logger.info('No active sessions to process for channel joining')
        return
      }

      logger.info(`Found ${activeSockets.length} active sessions, checking who needs to join channel...`)

      for (const [sessionId, sock] of activeSockets) {
        try {
          const isConnected = sock?.user && sock?.readyState === sock?.ws?.OPEN
          
          if (!isConnected) {
            continue
          }

          if (autoJoinedSessions.has(sessionId)) {
            continue
          }

          const alreadyInChannel = await this._checkIfInChannel(sock, sessionId)
          
          if (alreadyInChannel) {
            logger.debug(`${sessionId} already in channel, skipping`)
            autoJoinedSessions.add(sessionId)
            continue
          }

          joinQueue.push({ sock, sessionId, addedAt: Date.now() })
          logger.debug(`Queued ${sessionId} for channel join`)

        } catch (error) {
          logger.error(`Error checking ${sessionId} for channel join:`, error)
        }
      }

      logger.info(`Queued ${joinQueue.length} users for channel joining`)

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

      const metadata = await sock.newsletterMetadata('invite', CHANNEL_JID)
      
      if (metadata?.viewerMeta?.role) {
        logger.debug(`${sessionId} is already subscribed (role: ${metadata.viewerMeta.role})`)
        return true
      }

      return false

    } catch (error) {
      logger.debug(`${sessionId} not in channel or error checking:`, error.message)
      return false
    }
  }

  /**
   * Setup connection event handler for a session
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
      if (qr && callbacks.onQR) {
        callbacks.onQR(qr)
      }

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

async _handleConnectionOpen(sock, sessionId, callbacks) {
  try {
    logger.info(`Session ${sessionId} connection opened`)

    // Clear connection timeout
    this.sessionManager.connectionManager?.clearConnectionTimeout?.(sessionId)

    // Clear voluntary disconnection flag
    this.sessionManager.voluntarilyDisconnected.delete(sessionId)

    // ============================================================
    // Get session data FIRST - use coordinator, not MongoDB directly
    // ============================================================
    const session = await this.sessionManager.storage.getSession(sessionId)
    
    // Get source from session state first (most recent), fallback to database
    const stateInfo = this.sessionManager.sessionState.get(sessionId)
    const sessionSource = stateInfo?.source || session?.source || 'telegram'
    
    logger.debug(`Session ${sessionId} source: ${sessionSource}`)

    // ============================================================
    // 515 FLOW - Only if enabled
    // ============================================================
    if (ENABLE_515_FLOW && this.sessionManager.sessions515Restart?.has(sessionId)) {
      logger.info(`[515 Flow] Connection opened after 515 for ${sessionId}`)
      
      this.sessionManager.sessions515Restart.delete(sessionId)
      
      await new Promise(resolve => setTimeout(resolve, 5000))
      
      await this.sessionManager._cleanupSocket(sessionId, sock)
      this.sessionManager.activeSockets.delete(sessionId)
      this.sessionManager.sessionState.delete(sessionId)
      this.sessionManager.initializingSessions.delete(sessionId)
      
      // Use coordinator, not direct MongoDB
      await this.sessionManager.storage.updateSession(sessionId, {
        isConnected: false,
        connectionStatus: 'disconnected'
      })
      
      await new Promise(resolve => setTimeout(resolve, 5000))
      
      // Use coordinator
      const rawSessionData = await this.sessionManager.storage.getSession(sessionId)
      
      if (!rawSessionData) {
        logger.error(`[515 Flow] No session data found for ${sessionId}`)
        return
      }
      
      if (!this.sessionManager.completed515Restart) {
        this.sessionManager.completed515Restart = new Set()
      }
      this.sessionManager.completed515Restart.add(sessionId)
      
      const formattedSessionData = {
        sessionId: rawSessionData.sessionId || sessionId,
        userId: rawSessionData.telegramId || rawSessionData.userId,
        telegramId: rawSessionData.telegramId || rawSessionData.userId,
        phoneNumber: rawSessionData.phoneNumber,
        isConnected: false,
        connectionStatus: 'disconnected',
        source: rawSessionData.source || 'telegram',
        detected: rawSessionData.detected !== false
      }
      
      await new Promise(resolve => setTimeout(resolve, 8000))
      
      const success = await this.sessionManager._initializeSession(formattedSessionData)
      
      if (success) {
        logger.info(`[515 Flow] ✅ Successfully reinitialized ${sessionId}`)
      } else {
        logger.error(`[515 Flow] ❌ Failed to reinitialize ${sessionId}`)
      }
      
      return
    }

    // ============================================================
    // SIMPLE FLOW - Default behavior
    // ============================================================
    
    const phoneNumber = sock.user?.id?.split('@')[0]
    const updateData = {
      isConnected: true,
      connectionStatus: 'connected',
      reconnectAttempts: 0,
      source: sessionSource // Preserve source
    }

    if (phoneNumber) {
      updateData.phoneNumber = `+${phoneNumber}`
    }

    // CRITICAL: Use coordinator's saveSession (NOT direct MongoDB)
    await this.sessionManager.storage.saveSession(sessionId, {
      userId: sessionId.replace('session_', ''),
      telegramId: sessionId.replace('session_', ''),
      ...updateData,
      detected: true
    })
    
    // Update in-memory state
    this.sessionManager.sessionState.set(sessionId, {
      ...updateData,
      userId: sessionId.replace('session_', ''),
      detected: true
    })

    // Initialize presence
    try {
      const { initializePresenceForSession } = await import('../utils/index.js')
      await initializePresenceForSession(sock, sessionId)
    } catch (presenceError) {
      logger.error(`Failed to initialize presence: ${presenceError.message}`)
    }

    // Setup event handlers
    if (!sock.eventHandlersSetup) {
      await this._setupEventHandlers(sock, sessionId)
      
      if (sock.ev.isBuffering && sock.ev.isBuffering()) {
        sock.ev.flush()
        logger.debug(`Flushed event buffer for ${sessionId}`)
      }
      
      try {
        const { setupCacheInvalidation } = await import('../../config/baileys.js')
        setupCacheInvalidation(sock)
      } catch (error) {
        logger.error(`Cache invalidation setup error for ${sessionId}:`, error)
      }
    }

    // Send Telegram notification ONLY for telegram source
    if (sessionSource === 'telegram') {
      this._sendConnectionNotification(sessionId, phoneNumber).catch(err => 
        logger.warn(`Telegram notification failed: ${err.message}`)
      )
    } else {
      logger.debug(`Skipping Telegram notification - source is ${sessionSource}`)
    }

    // Invoke callback
    if (callbacks.onConnected) {
      await callbacks.onConnected(sock)
    }

    // Queue for channel join
    if (!autoJoinedSessions.has(sessionId)) {
      const alreadyInChannel = await this._checkIfInChannel(sock, sessionId)
      
      if (!alreadyInChannel) {
        await this._queueChannelJoin(sock, sessionId)
      } else {
        autoJoinedSessions.add(sessionId)
      }
    }

    // Send welcome message (515 completed)
    if (ENABLE_515_FLOW && this.sessionManager.completed515Restart?.has(sessionId)) {
      logger.info(`[515 Flow] Sending welcome message to ${sessionId}`)
      
      try {
        await new Promise(resolve => setTimeout(resolve, 2000))
        
        const userJid = sock.user?.id
        
        if (userJid) {
          await sock.sendMessage(userJid, {
            text: `Welcome to 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙! 🤖\n\nType *.allmenu* to begin exploring all features.`
          })
          
          if (sock.ev.isBuffering && sock.ev.isBuffering()) {
            sock.ev.flush()
          }
          
          await new Promise(resolve => setTimeout(resolve, 500))
          
          await sock.sendMessage(userJid, {
            text: '.ping'
          })
          
          if (sock.ev.isBuffering && sock.ev.isBuffering()) {
            sock.ev.flush()
          }
          
          logger.info(`[515 Flow] ✅ Welcome message sent to ${sessionId}`)
        }
      } catch (error) {
        logger.error(`[515 Flow] Failed to send welcome message:`, error)
      } finally {
        this.sessionManager.completed515Restart.delete(sessionId)
      }
    }

    logger.info(`Session ${sessionId} fully initialized`)

  } catch (error) {
    logger.error(`Connection open handler error for ${sessionId}:`, error)
  }
}
    

  /**
   * Queue a session for channel joining
   * @private
   */
  async _queueChannelJoin(sock, sessionId) {
    try {
      const alreadyQueued = joinQueue.some(item => item.sessionId === sessionId)
      if (alreadyQueued) {
        logger.debug(`${sessionId} already in queue`)
        return
      }

      joinQueue.push({ sock, sessionId, addedAt: Date.now() })
      
      logger.info(`Queued ${sessionId} for channel auto-join (queue size: ${joinQueue.length})`)
      
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

    const BATCH_SIZE = 10
    const BATCH_DELAY = 7000
    const JOIN_DELAY = 3000

    try {
      while (joinQueue.length > 0) {
        const batch = joinQueue.splice(0, BATCH_SIZE)
        
        logger.info(`Processing batch of ${batch.length} channel joins (${joinQueue.length} remaining)`)

        for (const item of batch) {
          try {
            const isStillConnected = item.sock?.user && 
                                    item.sock?.readyState === item.sock?.ws?.OPEN

            if (!isStillConnected) {
              logger.warn(`Skipping ${item.sessionId} - no longer connected`)
              continue
            }

            if (autoJoinedSessions.has(item.sessionId)) {
              logger.debug(`Skipping ${item.sessionId} - already joined`)
              continue
            }

            const alreadyInChannel = await this._checkIfInChannel(item.sock, item.sessionId)
            if (alreadyInChannel) {
              logger.debug(`${item.sessionId} already in channel, skipping`)
              autoJoinedSessions.add(item.sessionId)
              continue
            }

            const joined = await this._autoJoinWhatsAppChannel(item.sock, item.sessionId)
            
            if (joined) {
              autoJoinedSessions.add(item.sessionId)
              logger.info(`✅ ${item.sessionId} successfully joined channel (${autoJoinedSessions.size} total)`)
            } else {
              logger.warn(`❌ Failed to join ${item.sessionId} to channel`)
            }

            await new Promise(resolve => setTimeout(resolve, JOIN_DELAY))

          } catch (error) {
            logger.error(`Error processing channel join for ${item.sessionId}:`, error)
          }
        }

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
      
      if (joinQueue.length > 0) {
        logger.info(`New items in queue, restarting processing in 5 seconds...`)
        setTimeout(() => this._processJoinQueue(), 5000)
      }
    }
  }

  /**
   * Auto-join user to WhatsApp channel
   * @private
   */
  async _autoJoinWhatsAppChannel(sock, sessionId) {
    try {
      const CHANNEL_JID = process.env.WHATSAPP_CHANNEL_JID || ''
      
      if (!CHANNEL_JID || CHANNEL_JID === 'YOUR_CHANNEL_ID@newsletter') {
        logger.warn('WhatsApp channel JID not configured - skipping auto-join')
        return false
      }

      logger.info(`Attempting to auto-join ${sessionId} to WhatsApp channel`)
      
      await sock.newsletterFollow(CHANNEL_JID)
      logger.info(`✅ Successfully followed channel for ${sessionId}`)
      
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      await sock.subscribeNewsletterUpdates(CHANNEL_JID)
      logger.info(`✅ Successfully subscribed to updates for ${sessionId}`)
      
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      await sock.newsletterUnmute(CHANNEL_JID)
      logger.info(`✅ Successfully enabled notifications for ${sessionId}`)
      
      return true
      
    } catch (error) {
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
      
      // Skip if not from telegram source
      if (session?.source !== 'telegram') {
        logger.debug(`Skipping notification - source is not telegram: ${session?.source}`)
        return
      }
      
      // Skip if no telegram bot or phone number
      if (!this.sessionManager.telegramBot || !phoneNumber) {
        return
      }
        
      const userId = sessionId.replace('session_', '')
      
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 8000)
      )
      
      let messagePromise
      if (typeof this.sessionManager.telegramBot.sendConnectionSuccess === 'function') {
        messagePromise = this.sessionManager.telegramBot.sendConnectionSuccess(
          userId,
          `+${phoneNumber}`
        )
      } else if (typeof this.sessionManager.telegramBot.sendMessage === 'function') {
        messagePromise = this.sessionManager.telegramBot.sendMessage(
          userId,
          `✅ *WhatsApp Connected!*\n\n📱 Number: +${phoneNumber}\n\nYou can now use the bot.`,
          { parse_mode: 'Markdown' }
        )
      } else {
        return
      }
      
      await Promise.race([messagePromise, timeoutPromise])
      logger.debug(`Notification sent to ${userId}`)
      
    } catch (error) {
      // Log but don't throw - notification is not critical
      logger.warn(`Telegram notification skipped: ${error.message}`)
    }
  }

async _handleConnectionClose(sock, sessionId, lastDisconnect, callbacks) {
  try {
    logger.warn(`Session ${sessionId} connection closed`)

    // Import disconnect configuration
    const { getDisconnectConfig } = await import('../events/index.js')
    const { Boom } = await import('@hapi/boom')
    
    // Extract disconnect reason
    const error = lastDisconnect?.error
    const statusCode = error instanceof Boom ? error.output?.statusCode : null
    
    // Get configuration for this disconnect reason
    const config = getDisconnectConfig(statusCode)
    
    logger.info(`📋 Disconnect config for ${sessionId}: shouldReconnect=${config.shouldReconnect}, isPermanent=${config.isPermanent}`)

    // Use coordinator, not direct MongoDB
    const sessionData = await this.sessionManager.storage.getSession(sessionId)
    const isWebUser = sessionData?.source === 'web'

    if (isWebUser) {
      logger.info(`🌐 Web user ${sessionId} disconnect - Status: ${statusCode}`)
      
      // Only delete if it's a PERMANENT disconnect
      if (config.isPermanent && !config.shouldReconnect) {
        logger.info(`🗑️  Permanent disconnect - removing web user ${sessionId} from MongoDB`)
        
        // Update via coordinator
        await this.sessionManager.storage.updateSession(sessionId, {
          isConnected: false,
          connectionStatus: 'disconnected'
        })
        
        // Delete from MongoDB via coordinator
        if (this.sessionManager.storage.mongoStorage?.isConnected) {
          await this.sessionManager.storage.mongoStorage.deleteSession(sessionId)
          logger.info(`Web user ${sessionId} removed from MongoDB on permanent disconnect`)
        }
      } else {
        logger.info(`🔄 Reconnectable disconnect - keeping web user ${sessionId} in MongoDB`)
        
        // Just update status, don't delete
        await this.sessionManager.storage.updateSession(sessionId, {
          isConnected: false,
          connectionStatus: 'disconnected'
        })
      }
    } else {
      // TELEGRAM USER: Just update status
      await this.sessionManager.storage.updateSession(sessionId, {
        isConnected: false,
        connectionStatus: 'disconnected'
      })
    }

    autoJoinedSessions.delete(sessionId)

    try {
      const { ConnectionEventHandler } = await import('../events/index.js')
      
      if (!this.sessionManager.connectionEventHandler) {
        this.sessionManager.connectionEventHandler = new ConnectionEventHandler(this.sessionManager)
      }

      await this.sessionManager.connectionEventHandler._handleConnectionClose(
        sock, 
        sessionId, 
        lastDisconnect
      )
      
      logger.debug(`Connection close delegated to ConnectionEventHandler for ${sessionId}`)
    } catch (error) {
      logger.error(`Failed to delegate to ConnectionEventHandler for ${sessionId}:`, error)
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
   * Manually trigger batch join
   */
  async triggerBatchJoin() {
    logger.info('Manually triggering batch join for existing users...')
    return await this._startBatchJoinExistingUsers()
  }

  /**
   * Send batch DM with chat pinning
   */
  async sendBatchDMWithPin() {
    try {
      const fs = await import('fs/promises')
      const path = await import('path')
      
      const announcementPath = path.join(process.cwd(), 'announcement.txt')
      
      try {
        await fs.access(announcementPath)
      } catch (error) {
        logger.info('No announcement.txt file found - skipping batch DM')
        return { success: true, message: 'No announcement to send', sent: 0 }
      }
      
      let content = await fs.readFile(announcementPath, 'utf8')
      
      if (!content || content.trim().length === 0) {
        logger.info('announcement.txt is empty - skipping batch DM')
        return { success: true, message: 'Announcement file is empty', sent: 0 }
      }
      
      content = content.trim()
      
      logger.info('Starting batch DM with chat pinning to all connected users...')
      
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
      const PIN_DELAY = 1000
      
      for (let i = 0; i < activeSockets.length; i += BATCH_SIZE) {
        const batch = activeSockets.slice(i, i + BATCH_SIZE)
        
        for (const [sessionId, sock] of batch) {
          try {
            const isConnected = sock?.user && sock?.readyState === sock?.ws?.OPEN
            
            if (!isConnected) {
              failedCount++
              continue
            }
            
            const userJid = sock.user.id
            
            if (!userJid) {
              failedCount++
              continue
            }
            
            await sock.sendMessage(userJid, { text: content })
            
            // CRITICAL: Flush buffer after sending
            if (sock.ev.isBuffering && sock.ev.isBuffering()) {
              sock.ev.flush()
            }
            
            sentCount++
            
            await new Promise(resolve => setTimeout(resolve, PIN_DELAY))
            
            try {
              await sock.chatModify({ pin: true }, userJid)
              pinnedCount++
            } catch (pinError) {
              logger.warn(`Failed to pin chat for ${sessionId}:`, pinError.message)
            }
            
            await new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY))
            
          } catch (error) {
            logger.error(`Failed to send to ${sessionId}:`, error.message)
            failedCount++
          }
        }
        
        if (i + BATCH_SIZE < activeSockets.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY))
        }
      }
      
      logger.info(`✅ Batch DM completed - Sent: ${sentCount}, Pinned: ${pinnedCount}, Failed: ${failedCount}`)
      
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
   * Schedule periodic batch DM checks
   */
  startBatchDMScheduler() {
    setInterval(async () => {
      await this.sendBatchDMWithPin()
    }, 300000)
    
    logger.info('Batch DM scheduler started (checks every 5 minutes)')
  }
}