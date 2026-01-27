/**
 * Telegram Bot - Main Bot Class
 * Handles bot initialization, polling, and message routing
 */

import TelegramBotAPI from 'node-telegram-bot-api'
import { createComponentLogger } from '../../utils/logger.js'
import { telegramConfig, validateConfig } from './index.js'

const logger = createComponentLogger('TELEGRAM_BOT')

export class TelegramBot {
  constructor(token, options = {}) {
    this.token = token || telegramConfig.token
    this.options = options
    this.bot = null
    this.isRunning = false
    this.isPolling = false
    this.isRestartingPolling = false
    this.userStates = new Map()
    
    // Handlers (lazy loaded)
    this.connectionHandler = null
    this.adminHandler = null
    this.commandHandler = null
    
    // Middleware
    this.authMiddleware = null
    this.adminMiddleware = null
  }

  /**
   * Initialize the bot
   */
  async initialize() {
    try {
      // Validate configuration
      validateConfig()
      
      logger.info('Initializing Telegram bot...')

      // Create bot instance with timeout options
      this.bot = new TelegramBotAPI(this.token, { 
        polling: false,
        request: {
          agentOptions: {
            keepAlive: true,
            keepAliveMsecs: 30000
          },
          timeout: 30000
        }
      })
      
      // Initialize handlers
      await this._initializeHandlers()
      
      // Initialize middleware
      await this._initializeMiddleware()
      
      // Clear webhook and start polling
      await this._clearWebhookAndStartPolling()
      
      // Set bot commands
      await this._setBotCommands()
      
      // Setup event listeners
      this._setupEventListeners()
      
      this.isRunning = true
      logger.info('Telegram bot initialized successfully')
      return true
      
    } catch (error) {
      logger.error('Failed to initialize Telegram bot:', error)
      throw error
    }
  }

  /**
   * Initialize handlers
   * @private
   */
  async _initializeHandlers() {
    const { ConnectionHandler, AdminHandler, CommandHandler } = await import('../handlers/index.js')
    
    this.connectionHandler = new ConnectionHandler(this.bot)
    this.adminHandler = new AdminHandler(this.bot)
    this.commandHandler = new CommandHandler(this.bot, this.connectionHandler, this.adminHandler)
    
    logger.info('Handlers initialized')
  }

  /**
   * Initialize middleware
   * @private
   */
  async _initializeMiddleware() {
    const { AuthMiddleware, AdminMiddleware } = await import('../middleware/index.js')
    
    this.authMiddleware = new AuthMiddleware()
    this.adminMiddleware = new AdminMiddleware()
    
    logger.info('Middleware initialized')
  }

  /**
   * Clear webhook and start polling
   * @private
   */
  async _clearWebhookAndStartPolling() {
    try {
      // Clear webhook with timeout to prevent hanging
      const webhookPromise = this.bot.setWebHook('')
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Webhook clear timeout')), 5000)
      )
      
      try {
        await Promise.race([webhookPromise, timeoutPromise])
        logger.info('Webhook cleared successfully')
      } catch (timeoutError) {
        logger.warn('Webhook clear timed out, continuing anyway:', timeoutError.message)
      }
      
      // Start polling without waiting - it runs in background
      this.isPolling = true
      this.bot.startPolling({ restart: true }).catch(err => {
        logger.error('Polling error:', err.message)
      })
      logger.info('Polling started successfully')
      
    } catch (error) {
      logger.warn('Standard webhook clearing failed, trying alternative method:', error.message)
      
      try {
        this.bot = new TelegramBotAPI(this.token, { 
          polling: true,
          request: {
            agentOptions: {
              keepAlive: true,
              keepAliveMsecs: 30000
            },
            timeout: 5000
          }
        })
        this.isPolling = true
        logger.info('Bot recreated with direct polling')
        
      } catch (pollingError) {
        logger.error('All polling methods failed:', pollingError.message)
        this.isPolling = false
        throw pollingError
      }
    }
  }

  /**
   * Set bot commands
   * @private
   */
  async _setBotCommands() {
    try {
      const commands = [
        { command: 'start', description: 'Start the bot and show main menu' },
        { command: 'connect', description: 'Connect your WhatsApp account' },
        { command: 'status', description: 'Check connection status' },
        { command: 'disconnect', description: 'Disconnect WhatsApp' },
        { command: 'admin', description: 'Admin panel (admins only)' },
        { command: 'help', description: 'Show help information' }
      ]
      
      await this.bot.setMyCommands(commands)
      logger.info('Bot commands set successfully')
      
    } catch (error) {
      logger.warn('Failed to set bot commands:', error.message)
    }
  }

  /**
   * Setup event listeners
   * @private
   */
  _setupEventListeners() {
    // Text messages
    this.bot.on('message', async (msg) => {
      try {
        if (!msg.text) return
        
        const chatId = msg.chat.id
        const userId = msg.from.id
        const text = msg.text.trim()
        
        logger.info(`Message from ${userId}: ${text}`)
        
        // Authenticate user
        await this.authMiddleware.authenticateUser(userId, msg.from)
        
        // Handle admin password input first
        if (this.adminHandler.isPendingInput(userId)) {
          const handled = await this.adminHandler.processInput(msg)
          if (handled) return
        }
        
        // Handle connection phone input
        if (this.connectionHandler.isPendingConnection(userId)) {
          const handled = await this.connectionHandler.handlePhoneNumber(msg)
          if (handled) return
        }
        
        // Handle commands
        if (text.startsWith('/')) {
          await this.commandHandler.handleCommand(msg)
          return
        }
        
        // Default: show main menu
        await this.commandHandler.showMainMenu(chatId, null, msg.from)
        
      } catch (error) {
        logger.error('Error handling message:', error)
        await this._sendErrorMessage(msg.chat.id)
      }
    })

    // Callback queries (button presses)
    this.bot.on('callback_query', async (query) => {
      try {
        await this.bot.answerCallbackQuery(query.id)
        
        const data = query.data
        const userId = query.from.id
        
        // Authenticate user
        await this.authMiddleware.authenticateUser(userId, query.from)
        
        // Route to appropriate handler
        if (data.startsWith('admin_')) {
          await this.adminHandler.handleAction(query)
        } else {
          await this.commandHandler.handleCallback(query)
        }
        
      } catch (error) {
        logger.error('Error handling callback query:', error)
        try {
          await this.bot.answerCallbackQuery(query.id, {
            text: 'An error occurred',
            show_alert: true
          })
        } catch (answerError) {
          logger.error('Failed to answer callback query:', answerError)
        }
      }
    })

    // Polling errors
    this.bot.on('polling_error', (error) => {
      logger.error('Polling error:', error.message)
      this._handlePollingError(error)
    })

    this.bot.on('error', (error) => {
      logger.error('Bot error:', error)
    })
    
    logger.info('Event listeners setup complete')
  }

  /**
   * Handle polling errors
   * @private
   */
  _handlePollingError(error) {
    // Check if this is a 409 Conflict error (another instance is polling)
    const is409Error = error.message && error.message.includes('409')
    
    // Don't attempt to restart if:
    // 1. Already restarting polling
    // 2. Bot is not running
    // 3. This is a 409 conflict (another instance is already polling)
    if (this.isRestartingPolling || !this.isRunning || is409Error) {
      if (is409Error) {
        logger.warn('409 Conflict detected: Another bot instance is already polling. Skipping restart attempt.')
        this.isPolling = false
      }
      return
    }

    this.isRestartingPolling = true

    setTimeout(async () => {
      try {
        if (this.bot && this.isRunning && !this.isPolling) {
          logger.info('Attempting to restart polling...')
          await this.bot.stopPolling()
          await new Promise(resolve => setTimeout(resolve, 2000))
          
          this.isPolling = true
          await this.bot.startPolling({ restart: true })
          logger.info('Polling restarted successfully')
        } else if (this.isPolling) {
          logger.debug('Polling already active, skipping restart')
        }
      } catch (restartError) {
        this.isPolling = false
        
        // Check if restart error is also a 409
        if (restartError.message && restartError.message.includes('409')) {
          logger.warn('409 Conflict on restart: Another bot instance is already polling.')
        } else {
          logger.error('Failed to restart polling:', restartError.message)
        }
      } finally {
        this.isRestartingPolling = false
      }
    }, 5000)
  }

  /**
   * Send error message
   * @private
   */
  async _sendErrorMessage(chatId) {
    try {
      const { TelegramMessages, TelegramKeyboards } = await import('../utils/index.js')
      
      await this.sendMessage(chatId, TelegramMessages.error(), {
        reply_markup: TelegramKeyboards.mainMenu()
      })
    } catch (error) {
      logger.error('Failed to send error message:', error.message)
    }
  }

  /**
   * Send message with retry logic (public API)
   */
  async sendMessage(chatId, text, options = {}, retries = 3) {
    let lastError
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Add timeout wrapper
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), 15000)
        )
        
        const sendPromise = this.bot.sendMessage(chatId, text, options)
        
        const result = await Promise.race([sendPromise, timeoutPromise])
        
        if (attempt > 1) {
          logger.info(`Message sent successfully on attempt ${attempt}`)
        }
        
        return result
        
      } catch (error) {
        lastError = error
        
        const isNetworkError = error.code === 'EFATAL' || 
                              error.code === 'ETIMEDOUT' ||
                              error.code === 'ECONNRESET' ||
                              error.code === 'ENOTFOUND' ||
                              error.message.includes('timeout') ||
                              error.message.includes('network')
        
        if (isNetworkError && attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000)
          logger.warn(`Send message attempt ${attempt} failed, retrying in ${delay}ms: ${error.message}`)
          await new Promise(resolve => setTimeout(resolve, delay))
        } else {
          break
        }
      }
    }
    
    logger.error(`Failed to send message after ${retries} attempts: ${lastError.message}`)
    throw lastError
  }

  /**
   * Delete message (public API)
   */
  async deleteMessage(chatId, messageId) {
    try {
      await this.bot.deleteMessage(chatId, messageId)
    } catch (error) {
      logger.debug('Could not delete message:', error.message)
    }
  }

  /**
   * Edit message text (public API)
   */
  async editMessageText(text, options) {
    try {
      return await this.bot.editMessageText(text, options)
    } catch (error) {
      logger.error('Failed to edit message:', error)
      throw error
    }
  }

  /**
   * Send connection success notification with retry
   */
  async sendConnectionSuccess(userId, phoneNumber) {
    try {
      const message = `✅ *WhatsApp Connected!*\n\n📱 Number: ${phoneNumber}\n\nYou can now use the bot to send and receive messages.`
      
      return await this.sendMessage(userId, message, { 
        parse_mode: 'Markdown' 
      })
    } catch (error) {
      logger.error(`Failed to send connection success to ${userId}:`, error.message)
      throw error
    }
  }

  /**
   * Get bot statistics
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      activeStates: this.userStates.size,
      hasConnectionHandler: !!this.connectionHandler,
      hasAdminHandler: !!this.adminHandler,
      hasCommandHandler: !!this.commandHandler
    }
  }

  /**
   * Get user state
   */
  getUserState(userId) {
    return this.userStates.get(userId)
  }

  /**
   * Set user state
   */
  setUserState(userId, state) {
    this.userStates.set(userId, state)
  }

  /**
   * Clear user state
   */
  clearUserState(userId) {
    this.userStates.delete(userId)
    
    if (this.connectionHandler) {
      this.connectionHandler.clearPending(userId)
    }
    if (this.adminHandler) {
      this.adminHandler.clearPending(userId)
    }
  }

  /**
   * Stop the bot
   */
  async stop() {
    try {
      this.isRunning = false
      this.isPolling = false
      this.isRestartingPolling = false
      if (this.bot) {
        await this.bot.stopPolling()
        logger.info('Telegram bot stopped successfully')
      }
    } catch (error) {
      logger.error('Error stopping bot:', error)
    }
  }

  /**
   * Check if bot is initialized
   */
  get isInitialized() {
    return this.bot !== null && this.isRunning
  }
}