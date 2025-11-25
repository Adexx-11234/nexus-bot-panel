import { createComponentLogger } from '../../utils/logger.js'
import { MessageLogger } from './logger.js'
import { MessagePersistence } from './persistence.js'
import { MessageExtractor } from './extractor.js'

const logger = createComponentLogger('MESSAGE_PROCESSOR')

/**
 * MessageProcessor - Main message processing pipeline
 * Handles message processing, commands, anti-plugins
 */
export class MessageProcessor {
  constructor() {
    this.isInitialized = false
    this.messageLogger = new MessageLogger()
    this.messagePersistence = new MessagePersistence()
    this.messageExtractor = new MessageExtractor()
    
    // PREFIX CACHE - Load all user prefixes into memory
    this.prefixCache = new Map() // telegramId -> prefix
    this.cacheLoadTime = null
    this.CACHE_RELOAD_INTERVAL = 10 * 60 * 1000 // Reload every 10 minutes
    
    // Plugin loader (lazy loaded)
    this.pluginLoader = null
    
    // Minimal stats tracking
    this.messageStats = {
      processed: 0,
      commands: 0,
      errors: 0
    }
  }

  /**
   * Initialize processor
   */
  async initialize() {
    if (!this.isInitialized) {
      // Lazy load plugin loader
      const pluginLoaderModule = await import('../../utils/plugin-loader.js')
      this.pluginLoader = pluginLoaderModule.default

      if (!this.pluginLoader.isInitialized) {
        await this.pluginLoader.loadPlugins()
      }

      // LOAD ALL USER PREFIXES INTO MEMORY
      await this.loadAllPrefixes()

      this.isInitialized = true
      logger.info('Message processor initialized')
    }
  }

  /**
   * Load all user prefixes from database into memory
   */
  async loadAllPrefixes() {
    try {
      const { pool } = await import('../../config/database.js')
      
      // Get ALL user prefixes in one query
      const result = await pool.query(
        `SELECT telegram_id, custom_prefix FROM whatsapp_users 
         WHERE custom_prefix IS NOT NULL`
      )
      
      // Store in Map for O(1) lookup
      this.prefixCache.clear()
      for (const row of result.rows) {
        const prefix = row.custom_prefix === 'none' ? '' : row.custom_prefix
        this.prefixCache.set(row.telegram_id, prefix)
      }
      
      this.cacheLoadTime = Date.now()
      
      logger.info(`Loaded ${result.rows.length} user prefixes into memory`)
      
      // Schedule periodic reload every 10 minutes (only once)
      if (!this.reloadInterval) {
        this._schedulePrefixReload()
      }
      
    } catch (error) {
      logger.error('Failed to load user prefixes:', error)
      // Don't throw - use default prefix if cache load fails
    }
  }

  /**
   * Schedule periodic prefix cache reload
   * @private
   */
  _schedulePrefixReload() {
    this.reloadInterval = setInterval(async () => {
      try {
        await this.loadAllPrefixes()
        logger.debug('User prefix cache reloaded')
      } catch (error) {
        logger.error('Failed to reload prefix cache:', error)
      }
    }, this.CACHE_RELOAD_INTERVAL)
  }

  /**
   * Get user prefix from memory cache (O(1) lookup, NO DATABASE QUERY!)
   * @private
   */
  _getUserPrefixFromCache(telegramId) {
    // Check if cache needs reload (fallback safety)
    if (this.cacheLoadTime && (Date.now() - this.cacheLoadTime) > 15 * 60 * 1000) {
      logger.warn('Prefix cache is stale, triggering reload')
      this.loadAllPrefixes().catch(() => {}) // Don't block, reload async
    }
    
    // O(1) memory lookup - NO DATABASE QUERY!
    const prefix = this.prefixCache.get(telegramId)
    
    // Return custom prefix or default '.'
    return prefix !== undefined ? prefix : '.'
  }

  /**
   * Update prefix cache when user changes their prefix
   * Call this from setprefix command
   */
  updatePrefixCache(telegramId, newPrefix) {
    const normalizedPrefix = newPrefix === 'none' ? '' : newPrefix
    this.prefixCache.set(telegramId, normalizedPrefix)
    logger.info(`✅ Updated prefix cache for user ${telegramId}: "${normalizedPrefix || '(none)'}"`)
  }

/**
 * Process message through pipeline
 */
async processMessage(sock, sessionId, m, prefix = null) {
  try {
    await this.initialize()

    // Validate message
    if (!m || !m.message) {
      return { processed: false, error: 'Invalid message object' }
    }

      
    const chat = m.key?.remoteJid || m.from
    const isGroup = chat && chat.endsWith('@g.us')
    
    // **FIX: Skip protocol/system messages**
    if (m.message?.protocolMessage) {
      const protocolType = m.message.protocolMessage.type
      
      // Skip these protocol message types
      const skipTypes = [
        'PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE',
        'MESSAGE_EDIT',
        'REVOKE',
        'EPHEMERAL_SETTING'
      ]
      
      if (skipTypes.includes(protocolType)) {
        logger.debug(`Skipping protocol message type: ${protocolType}`)
        return { processed: false, silent: true, protocolMessage: true }
      }
    }
      
    // **FIX: Set chat, isGroup, and sender FIRST before anything else**
    if (!m.chat) {
      m.chat = m.key?.remoteJid || m.from
    }
    if (typeof m.isGroup === 'undefined') {
      m.isGroup = m.chat && m.chat.endsWith('@g.us')
    }

    if (!m.sender) {
      if (m.isGroup) {
        m.sender = m.key?.participant || m.participant || m.key?.remoteJid
      } else {
        // In private chats:
        if (m.key?.fromMe) {
          // YOU sent it: ALWAYS use originalSelfAuthorUserJidString first
          m.sender = m.originalSelfAuthorUserJidString || sock.user?.id
        } else {
          // OTHER person sent it: use remoteJid
          m.sender = m.key?.remoteJid || m.chat
        }
      }
    }

    // **CRITICAL: If sender is still @lid and we have originalSelfAuthorUserJidString, use it**
    if (m.sender?.includes('@lid') && m.originalSelfAuthorUserJidString) {
      m.sender = m.originalSelfAuthorUserJidString
      logger.debug(`Corrected @lid sender to: ${m.sender}`)
    }
    
    // Validate critical fields before continuing
    if (!m.chat || !m.sender) {
      logger.error('Missing critical message fields:', { chat: m.chat, sender: m.sender })
      return { processed: false, error: 'Missing chat or sender information' }
    }

    // Get session context
    m.sessionContext = this._getSessionContext(sessionId)
    m.sessionId = sessionId
    
    // ✅ GET USER'S CUSTOM PREFIX FROM MEMORY CACHE (NO DATABASE QUERY!)
    const userPrefix = this._getUserPrefixFromCache(m.sessionContext.telegram_id)
    m.prefix = userPrefix
    logger.debug(`Using prefix '${m.prefix}' for user ${m.sessionContext.telegram_id}`)

    // Extract contact info
    await this._extractContactInfo(sock, m)

    // Extract quoted message
    m.quoted = this.messageExtractor.extractQuotedMessage(m)

    // **Extract message body BEFORE processing anti-plugins**
    m.body = this.messageExtractor.extractMessageBody(m)
    m.text = m.body // Add text alias for compatibility

    // Set admin status
    await this._setAdminStatus(sock, m)

    // Determine if it's a command using user's custom prefix
    // If prefix is empty string (none), ALL messages are treated as commands
    const isCommand = m.body && (m.prefix === '' || m.body.startsWith(m.prefix))
    m.isCommand = isCommand

    if (isCommand) {
      this._parseCommand(m, m.prefix) // Use user's prefix
    }

    // **Process anti-plugins AFTER body extraction and BEFORE command check**
    // Skip anti-plugin processing for commands
    if (!m.isCommand) {
      await this._processAntiPlugins(sock, sessionId, m)
      
      if (m._wasDeletedByAntiPlugin) {
        // ⚡ Fire-and-forget for persistence and logging (don't await)
        this.messagePersistence.persistMessage(sessionId, sock, m).catch(() => {})
        this.messageLogger.logEnhancedMessageEntry(sock, sessionId, m).catch(() => {})
        return { processed: true, deletedByAntiPlugin: true }
      }
    }

    // ⚡ PERFORMANCE FIX: Fire-and-forget for persistence and logging
    // Don't wait for database writes - they happen in background
    this.messagePersistence.persistMessage(sessionId, sock, m).catch(err => {
      logger.debug(`Persistence failed for ${m.key?.id}:`, err.message)
    })
    
    this.messageLogger.logEnhancedMessageEntry(sock, sessionId, m).catch(err => {
      logger.debug(`Logging failed for ${m.key?.id}:`, err.message)
    })

    // Handle interactive responses
    if (m.message?.listResponseMessage) {
      return await this._handleListResponse(sock, sessionId, m)
    }

    if (m.message?.interactiveResponseMessage || 
        m.message?.templateButtonReplyMessage || 
        m.message?.buttonsResponseMessage) {
      return await this._handleInteractiveResponse(sock, sessionId, m)
    }

    // Execute command if it's a command
    if (m.isCommand && m.body) {
      this.messageStats.commands++
      return await this._handleCommand(sock, sessionId, m)
    }

    // Process game messages (non-commands only)
    if (!m.isCommand && m.body && m.body.trim()) {
      const gameResult = await this._handleGameMessage(sock, sessionId, m)
      if (gameResult) {
        return gameResult
      }
    }

    this.messageStats.processed++
    return { processed: true }

  } catch (error) {
    logger.error('Error processing message:', error)
    this.messageStats.errors++
    return { error: error.message }
  }
}

  /**
   * Get session context
   * @private
   */
  _getSessionContext(sessionId) {
    const sessionIdMatch = sessionId.match(/session_(-?\d+)/)
    
    if (sessionIdMatch) {
      const telegramId = parseInt(sessionIdMatch[1])
      return {
        telegram_id: telegramId,
        session_id: sessionId,
        isWebSession: telegramId < 0,
        id: telegramId
      }
    }

    return {
      telegram_id: 'Unknown',
      session_id: sessionId,
      id: null
    }
  }

  /**
   * Extract contact info (push name)
   * @private
   */
  async _extractContactInfo(sock, m) {
    try {
      const { getContactResolver } = await import('../contacts/index.js')
      const resolver = getContactResolver()
      await resolver.extractPushName(sock, m)
    } catch (error) {
      logger.error('Error extracting contact info:', error)
      m.pushName = 'Unknown'
    }
  }

  /**
   * Set admin status for message
   * @private
   */
  async _setAdminStatus(sock, m) {
    try {
      // Private chats: both are admins
      if (!m.isGroup) {
        m.isAdmin = true
        m.isBotAdmin = true
        m.isCreator = this._checkIsBotOwner(sock, m.sender)
        return
      }

      // Group chats: check admin status
      const { isGroupAdmin, isBotAdmin } = await import('../groups/index.js')
      
      m.isAdmin = await isGroupAdmin(sock, m.chat, m.sender)
      m.isBotAdmin = await isBotAdmin(sock, m.chat)
      m.isCreator = this._checkIsBotOwner(sock, m.sender)

      // Get group metadata for reference
      const { getGroupMetadataManager } = await import('../groups/index.js')
      const metadataManager = getGroupMetadataManager()
      m.groupMetadata = await metadataManager.getMetadata(sock, m.chat)
      m.participants = m.groupMetadata?.participants || []

    } catch (error) {
      logger.error('Error setting admin status:', error)
      m.isAdmin = false
      m.isBotAdmin = false
      m.isCreator = this._checkIsBotOwner(sock, m.sender)
    }
  }

  /**
   * Check if user is bot owner
   * @private
   */
  _checkIsBotOwner(sock, userJid) {
    try {
      if (!sock?.user?.id || !userJid) {
        return false
      }

      const botNumber = sock.user.id.split(':')[0]
      const userNumber = userJid.split('@')[0]

      return botNumber === userNumber
    } catch (error) {
      return false
    }
  }

/**
   * Parse command from message
   * @private
   */
  _parseCommand(m, prefix) {
    // Handle 'none' prefix case (empty string)
    const commandText = prefix === '' 
      ? m.body.trim() 
      : m.body.slice(prefix.length).trim()
      
    const [cmd, ...args] = commandText.split(/\s+/)

    m.command = {
      name: cmd.toLowerCase(),
      args: args,
      raw: commandText,
      fullText: m.body
    }
  }

  /**
   * Process anti-plugins
   * @private
   */
  async _processAntiPlugins(sock, sessionId, m) {
    try {
      if (!this.pluginLoader) return

      await this.pluginLoader.processAntiPlugins(sock, sessionId, m)
    } catch (error) {
      logger.error('Error processing anti-plugins:', error)
    }
  }

/**
   * Handle game messages
   * @private
   */
  async _handleGameMessage(sock, sessionId, m) {
    try {
      const { gameManager } = await import('../../lib/game managers/game-manager.js')
      
      // Skip if no body or if it's a command with prefix
      if (!m.body || (m.prefix && m.body.startsWith(m.prefix))) return null
      if (!m.chat) return null

      // GAME DEDUPLICATION: Check if message is a game command
      const isGameCommand = await this.isGameCommand(m.body)

      if (isGameCommand) {
        // Lock game command to prevent multiple sessions from processing same game action
        const { default: pluginLoader } = await import('../../utils/plugin-loader.js')
        const messageKey = pluginLoader.deduplicator.generateKey(m.chat, m.key?.id)
        
        if (messageKey) {
          if (!pluginLoader.deduplicator.tryLockForProcessing(messageKey, sessionId, 'game-start')) {
            logger.debug('Game command already being processed by another session')
            return null // Another session is processing the game
          }
        }
      }

      const result = await gameManager.processGameMessage(sock, m.chat, m.sender, m.body)
      
      // Mark as processed if game action was successful
      if (result && result.success !== false && isGameCommand) {
        const { default: pluginLoader } = await import('../../utils/plugin-loader.js')
        const messageKey = pluginLoader.deduplicator.generateKey(m.chat, m.key?.id)
        
        if (messageKey) {
          pluginLoader.deduplicator.markAsProcessed(messageKey, sessionId, 'game-start')
        }
      }
      
      if (result && result.success !== false) {
        return { processed: true, gameMessage: true, result }
      }

      return null
    } catch (error) {
      logger.error('Error handling game message:', error)
      return null
    }
  }


  /**
   * Check if message is a game command by checking plugin loader
   * @private
   */
  async isGameCommand(messageBody) {
    try {
      if (!messageBody || typeof messageBody !== 'string') return false
      
      // Import plugin loader
      const { default: pluginLoader } = await import('../../utils/plugin-loader.js')
      
      // Extract first word as potential command
      const firstWord = messageBody.trim().split(/\s+/)[0].toLowerCase()
      
      // Check if command exists in plugin loader
      const plugin = pluginLoader.findCommand(firstWord)
      
      // Check if it's a game command (gamemenu category)
      if (plugin && plugin.category === 'gamemenu') {
        return true
      }
      
      // Also check if message contains any game-related keywords
      // This handles cases like "tictactoe start", "rps start", etc.
      const gameKeywords = ['tictactoe', 'rps', 'trivia', 'quiz', 'hangman', 'math', 'guess']
      const containsGameKeyword = gameKeywords.some(keyword => 
        messageBody.toLowerCase().includes(keyword)
      )
      
      return containsGameKeyword
    } catch (error) {
      logger.error('Error checking if message is game command:', error)
      return false
    }
  }

  /**
   * Handle interactive response (buttons, lists)
   * @private
   */
  async _handleInteractiveResponse(sock, sessionId, m) {
    try {
      let selectedCommand = null
      
      if (m.message?.interactiveResponseMessage?.nativeFlowResponseMessage) {
        const flowResponse = m.message.interactiveResponseMessage.nativeFlowResponseMessage
        const paramsJson = flowResponse.paramsJson

        if (paramsJson) {
          try {
            const params = JSON.parse(paramsJson)
            selectedCommand = params.id
          } catch (parseError) {
            // Silent fail
          }
        }
      } else if (m.message?.templateButtonReplyMessage) {
        selectedCommand = m.message.templateButtonReplyMessage.selectedId
      } else if (m.message?.buttonsResponseMessage) {
        selectedCommand = m.message.buttonsResponseMessage.selectedButtonId
      } else if (m.message?.interactiveResponseMessage) {
        const response = m.message.interactiveResponseMessage
        selectedCommand = response.selectedButtonId || response.selectedId || response.body?.text
      }

      if (selectedCommand) {
        if (selectedCommand.startsWith(m.prefix)) {
          m.body = selectedCommand
          m.isCommand = true
          this._parseCommand(m, m.prefix)
          return await this._handleCommand(sock, sessionId, m)
        } else {
          return { processed: true, buttonResponse: selectedCommand }
        }
      }

      return { processed: true, interactiveResponse: true }
    } catch (error) {
      logger.error('Error handling interactive response:', error)
      return { processed: false, error: error.message }
    }
  }

  /**
   * Handle list response
   * @private
   */
  async _handleListResponse(sock, sessionId, m) {
    const selectedRowId = m.message.listResponseMessage.singleSelectReply.selectedRowId

    if (selectedRowId?.startsWith(m.prefix)) {
      m.body = selectedRowId
      m.isCommand = true
      this._parseCommand(m, m.prefix)
      return await this._handleCommand(sock, sessionId, m)
    }

    return { processed: true, listResponse: true }
  }

  /**
   * Handle command execution
   * @private
   */
  async _handleCommand(sock, sessionId, m) {
    const command = m.command.name

    try {
      if (!this.pluginLoader) {
        throw new Error('Plugin loader not initialized')
      }

      const exec = await this.pluginLoader.executeCommand(
        sock,
        sessionId,
        command,
        m.command.args,
        m
      )

      if (exec?.ignore) {
        return { processed: true, ignored: true }
      } else if (exec?.success) {
        await this._sendCommandResponse(sock, m, exec.result || exec)
      }
    } catch (error) {
      logger.error(`Error executing command ${command}:`, error)
    }

    return { processed: true, commandExecuted: true }
  }

  /**
   * Send command response
   * @private
   */
  async _sendCommandResponse(sock, m, result) {
    if (!result?.response) return

    const messageOptions = { quoted: m }

    if (result.mentions && Array.isArray(result.mentions)) {
      messageOptions.mentions = result.mentions
    }

    try {
      if (result.isList && result.response.sections) {
        await sock.sendMessage(m.chat, result.response, messageOptions)
      } else if (result.media) {
        const mediaMessage = {
          [result.mediaType || 'image']: result.media,
          caption: result.response
        }
        await sock.sendMessage(m.chat, mediaMessage, messageOptions)
      } else {
        await sock.sendMessage(m.chat, { text: result.response }, messageOptions)
      }
    } catch (error) {
      logger.error('Failed to send response:', error)
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      isInitialized: this.isInitialized,
      messageStats: { ...this.messageStats },
      pluginStats: this.pluginLoader?.getPluginStats() || {},
      prefixCacheSize: this.prefixCache.size,
      prefixCacheAge: this.cacheLoadTime ? Math.floor((Date.now() - this.cacheLoadTime) / 1000) : 0
    }
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.messageStats = {
      processed: 0,
      commands: 0,
      errors: 0
    }
  }

  /**
   * Perform maintenance
   */
  performMaintenance() {
    // Clean up any temporary data if needed
    logger.debug('Message processor maintenance performed')
  }
}