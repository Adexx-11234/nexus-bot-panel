import { createComponentLogger } from '../../utils/logger.js'
import { TelegramKeyboards, TelegramMessages } from '../ui/index.js'

const logger = createComponentLogger('CALLBACK_HANDLER')

/**
 * CallbackHandler - Handles callback query (button presses)
 */
export class CallbackHandler {
  constructor(bot, connectionHandler) {
    this.bot = bot
    this.connectionHandler = connectionHandler
  }

  /**
   * Handle callback query
   */
  async handleCallback(query) {
    const data = query.data
    const chatId = query.message.chat.id
    const messageId = query.message.message_id
    const userId = query.from.id

    logger.debug(`Callback: ${data} from user: ${userId}`)

    try {
      switch (data) {
        // Connection actions
        case 'connect':
          await this._deleteMessage(chatId, messageId)
          await this.connectionHandler.handleConnect(chatId, userId, query.from)
          break

        case 'status':
          await this._deleteMessage(chatId, messageId)
          await this.connectionHandler.handleStatus(chatId, userId)
          break

        case 'disconnect':
          await this._deleteMessage(chatId, messageId)
          await this.connectionHandler.handleDisconnect(chatId, userId)
          break

        case 'disconnect_confirm':
          await this._deleteMessage(chatId, messageId)
          await this.connectionHandler.confirmDisconnect(chatId, userId)
          break

        // Navigation actions
        case 'main_menu':
          await this._showMainMenu(chatId, messageId, query.from)
          break

        case 'help':
          await this._showHelp(chatId, messageId)
          break

        case 'cancel':
          await this._showMainMenu(chatId, messageId, query.from)
          break

        default:
          logger.warn(`Unknown callback: ${data}`)
      }

    } catch (error) {
      logger.error('Callback handling error:', error)
      await this.bot.answerCallbackQuery(query.id, {
        text: 'An error occurred',
        show_alert: true
      })
    }
  }

  /**
   * Show main menu
   * @private
   */
  async _showMainMenu(chatId, messageId, userInfo) {
    const menuText = userInfo
      ? TelegramMessages.welcome(userInfo.first_name || 'there')
      : 'Choose an option:'

    const options = {
      parse_mode: userInfo ? 'Markdown' : undefined,
      reply_markup: TelegramKeyboards.mainMenu()
    }

    try {
      await this.bot.editMessageText(menuText, {
        chat_id: chatId,
        message_id: messageId,
        ...options
      })
    } catch (error) {
      await this._deleteMessage(chatId, messageId)
      await this.bot.sendMessage(chatId, menuText, options)
    }
  }

  /**
   * Show help
   * @private
   */
  async _showHelp(chatId, messageId) {
    const helpText = TelegramMessages.help()

    try {
      await this.bot.editMessageText(helpText, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: TelegramKeyboards.backButton('main_menu')
      })
    } catch (error) {
      await this._deleteMessage(chatId, messageId)
      await this.bot.sendMessage(chatId, helpText, {
        parse_mode: 'Markdown',
        reply_markup: TelegramKeyboards.backButton('main_menu')
      })
    }
  }

  /**
   * Delete message helper
   * @private
   */
  async _deleteMessage(chatId, messageId) {
    try {
      await this.bot.deleteMessage(chatId, messageId)
    } catch (error) {
      logger.debug('Could not delete message:', error.message)
    }
  }
}