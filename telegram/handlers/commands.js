/**
 * Command Handler
 * Handles command routing and general callbacks
 */

import { createComponentLogger } from '../../utils/logger.js'
import { TelegramMessages, TelegramKeyboards } from '../ui/index.js'

const logger = createComponentLogger('COMMAND_HANDLER')

export class CommandHandler {
  constructor(bot, connectionHandler, adminHandler) {
    this.bot = bot
    this.connectionHandler = connectionHandler
    this.adminHandler = adminHandler
  }

  /**
   * Handle command messages
   */
  async handleCommand(msg) {
    const command = msg.text.split(' ')[0].toLowerCase()
    const chatId = msg.chat.id
    const userId = msg.from.id
    
    logger.info(`Command: ${command} from user ${userId}`)
    
    // Clear any pending states
    this._clearUserStates(userId)
    
    switch (command) {
      case '/start':
        await this._handleStartCommand(msg)
        break
      case '/connect':
        await this.connectionHandler.handleConnect(chatId, userId, msg.from)
        break
      case '/status':
        await this.connectionHandler.handleStatus(chatId, userId)
        break
      case '/disconnect':
        await this.connectionHandler.handleDisconnect(chatId, userId)
        break
      case '/admin':
        await this.adminHandler.handlePanel(chatId, userId)
        break
      case '/help':
        await this._handleHelpCommand(msg)
        break
      default:
        await this._handleUnknownCommand(msg)
    }
  }

  /**
   * Handle start command
   * @private
   */
  async _handleStartCommand(msg) {
    const firstName = msg.from.first_name || 'there'
    const welcomeText = TelegramMessages.welcome(firstName)

    await this.bot.sendMessage(msg.chat.id, welcomeText, {
      parse_mode: 'Markdown',
      reply_markup: TelegramKeyboards.mainMenu()
    })
  }

  /**
   * Handle help command
   * @private
   */
  async _handleHelpCommand(msg) {
    const helpText = TelegramMessages.help()

    await this.bot.sendMessage(msg.chat.id, helpText, {
      parse_mode: 'Markdown',
      reply_markup: TelegramKeyboards.backButton()
    })
  }

  /**
   * Handle unknown command
   * @private
   */
  async _handleUnknownCommand(msg) {
    await this.bot.sendMessage(msg.chat.id, 
      'Unknown command. Use /help to see available commands.', {
      reply_markup: TelegramKeyboards.mainMenu()
    })
  }

  /**
   * Handle callback queries
   */
  async handleCallback(query) {
    const data = query.data
    const chatId = query.message.chat.id
    const userId = query.from.id
    
    logger.info(`Callback: ${data} from user ${userId}`)
    
    switch (data) {
      case 'connect':
        await this._deleteMessage(chatId, query.message.message_id)
        await this.connectionHandler.handleConnect(chatId, userId, query.from)
        break
      case 'status':
        await this._deleteMessage(chatId, query.message.message_id)
        await this.connectionHandler.handleStatus(chatId, userId)
        break
      case 'disconnect':
        await this._deleteMessage(chatId, query.message.message_id)
        await this.connectionHandler.handleDisconnect(chatId, userId)
        break
      case 'disconnect_confirm':
        await this._deleteMessage(chatId, query.message.message_id)
        await this.connectionHandler.confirmDisconnect(chatId, userId)
        break
      case 'main_menu':
        await this.showMainMenu(chatId, query.message.message_id, query.from)
        break
      case 'help':
        await this._deleteMessage(chatId, query.message.message_id)
        await this._handleHelpCommand({ chat: query.message.chat, from: query.from })
        break
      case 'cancel':
        this._clearUserStates(userId)
        await this.showMainMenu(chatId, query.message.message_id, query.from)
        break
    }
  }

  /**
   * Show main menu
   */
  async showMainMenu(chatId, messageId = null, userInfo = null) {
    const menuText = userInfo ? 
      TelegramMessages.welcome(userInfo.first_name || 'there') : 
      'Choose an option:'

    const options = {
      parse_mode: userInfo ? 'Markdown' : undefined,
      reply_markup: TelegramKeyboards.mainMenu()
    }

    if (messageId) {
      try {
        await this.bot.editMessageText(menuText, {
          chat_id: chatId,
          message_id: messageId,
          ...options
        })
      } catch (error) {
        await this.bot.sendMessage(chatId, menuText, options)
      }
    } else {
      await this.bot.sendMessage(chatId, menuText, options)
    }
  }

  /**
   * Delete message
   * @private
   */
  async _deleteMessage(chatId, messageId) {
    try {
      await this.bot.deleteMessage(chatId, messageId)
    } catch (error) {
      logger.debug('Could not delete message:', error.message)
    }
  }

  /**
   * Clear user states
   * @private
   */
  _clearUserStates(userId) {
    this.connectionHandler.clearPending(userId)
    this.adminHandler.clearPending(userId)
  }
}