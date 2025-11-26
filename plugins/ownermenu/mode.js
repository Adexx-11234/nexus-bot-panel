import { generateWAMessageFromContent, proto } from '@whiskeysockets/baileys'
import { UserQueries } from '../../database/query.js'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('MODE')

export default {
  name: "Mode",
  commands: ["mode", "botmode", "privacy"],
  description: "Switch between self and public mode",
  usage: "• .mode self - Only owner can use\n• .mode public - Everyone can use\n• .mode status - Check current mode\n• .mode - Show interactive menu",
  category: "ownermenu",
  ownerOnly: true,

  async execute(sock, sessionId, args, m) {
    try {
      const telegramId = m.sessionContext?.telegram_id || null
      
      if (!telegramId) {
        return {
          response: "❌ Unable to identify your account. Please ensure you're properly connected.\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        }
      }

      const action = args[0]?.toLowerCase()

      // Handle text commands
      if (action === 'self' || 'private') {
        return await this.setSelfMode(telegramId, m)
      }

      if (action === 'public') {
        return await this.setPublicMode(telegramId, m)
      }

      if (action === 'status') {
        return await this.checkStatus(telegramId, m)
      }

      // Show interactive menu if no args
      return await this.showMenu(sock, telegramId, m)

    } catch (error) {
      logger.error('[Mode] Error:', error)
      return { response: "❌ An error occurred while processing the command.\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
    }
  },

  async showMenu(sock, telegramId, m) {
    try {
      const settings = await this.getMode(telegramId)
      const currentMode = settings.mode || 'public'
      const isSelfMode = currentMode === 'self'

      const msg = generateWAMessageFromContent(m.chat, {
        viewOnceMessage: {
          message: {
            messageContextInfo: {
              deviceListMetadata: {},
              deviceListMetadataVersion: 2
            },
            interactiveMessage: proto.Message.InteractiveMessage.create({
              contextInfo: {
                mentionedJid: [m.sender],
                isForwarded: false,
              },
              body: proto.Message.InteractiveMessage.Body.create({
                text: `🔒 *Bot Mode Settings*\n\n` +
                      `Current Mode: ${isSelfMode ? '🔐 Self Mode' : '🌐 Public Mode'}\n\n` +
                      `📱 *What it does:*\n\n` +
                      `*Self Mode* 🔐\n` +
                      `• Bot only responds to owner (you)\n` +
                      `• Works in private and groups\n` +
                      `• Others cannot use bot commands\n` +
                      `• Maximum privacy\n\n` +
                      `*Public Mode* 🌐\n` +
                      `• Bot responds to everyone\n` +
                      `• Normal operation\n` +
                      `• All users can use commands\n` +
                      `• Based on permissions\n\n` +
                      `⚙️ *Commands:*\n` +
                      `• .mode self - Enable self mode\n` +
                      `• .mode public - Enable public mode\n` +
                      `• .mode status - Check status\n\n` +
                      `Or select an option below:` +
                      `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
              }),
              footer: proto.Message.InteractiveMessage.Footer.create({
                text: "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
              }),
              header: proto.Message.InteractiveMessage.Header.create({
                title: "🔒 BOT MODE",
                subtitle: "Privacy Settings",
                hasMediaAttachment: false
              }),
              nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                buttons: [
                  {
                    name: "single_select",
                    buttonParamsJson: JSON.stringify({
                      title: "⚙️ Select Mode",
                      sections: [
                        {
                          title: "Bot Mode Options",
                          highlight_label: "Current",
                          rows: [
                            {
                              header: "🔐 Self Mode",
                              title: "Enable Self Mode",
                              description: "Only you can use the bot",
                              id: `${m.prefix}mode self`
                            },
                            {
                              header: "🌐 Public Mode",
                              title: "Enable Public Mode",
                              description: "Everyone can use the bot",
                              id: `${m.prefix}mode public`
                            },
                            {
                              header: "📊 Status",
                              title: "Check Current Mode",
                              description: "View your current bot mode",
                              id: `${m.prefix}mode status`
                            }
                          ]
                        }
                      ]
                    })
                  }
                ]
              })
            })
          }
        }
      }, { quoted: m })

      await sock.relayMessage(m.chat, msg.message, {
        messageId: msg.key.id
      })

      logger.info(`[Mode] Menu sent to ${telegramId}`)
      return { success: true }
    } catch (error) {
      logger.error('[Mode] Menu error:', error)
      throw error
    }
  },

  async setSelfMode(telegramId, m) {
    try {
      await this.setMode(telegramId, 'self')
      logger.info(`[Mode] Self mode enabled for ${telegramId}`)

      return {
        response: 
          `🔐 *Self Mode ENABLED*\n\n` +
          `✅ Bot is now in self mode\n\n` +
          `📱 *What this means:*\n` +
          `• Only YOU can use bot commands\n` +
          `• Works in private chats and groups\n` +
          `• Others will be ignored\n` +
          `• Maximum privacy enabled\n\n` +
          `💡 To allow everyone again, use:\n` +
          `*.mode public*\n\n` +
          `© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[Mode] Enable self error:', error)
      return { response: "❌ Failed to enable self mode.\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
    }
  },

  async setPublicMode(telegramId, m) {
    try {
      await this.setMode(telegramId, 'public')
      logger.info(`[Mode] Public mode enabled for ${telegramId}`)

      return {
        response: 
          `🌐 *Public Mode ENABLED*\n\n` +
          `✅ Bot is now in public mode\n\n` +
          `📱 *What this means:*\n` +
          `• Everyone can use bot commands\n` +
          `• Normal operation restored\n` +
          `• Based on permissions\n` +
          `• Standard bot behavior\n\n` +
          `💡 To restrict to yourself only, use:\n` +
          `*.mode self*\n\n` +
          `© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[Mode] Enable public error:', error)
      return { response: "❌ Failed to enable public mode.\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
    }
  },

  async checkStatus(telegramId, m) {
    try {
      const settings = await this.getMode(telegramId)
      const currentMode = settings.mode || 'public'
      const isSelfMode = currentMode === 'self'

      return {
        response: 
          `📊 *Bot Mode Status*\n\n` +
          `Current Mode: ${isSelfMode ? '🔐 Self Mode' : '🌐 Public Mode'}\n\n` +
          `${isSelfMode 
            ? '🔐 *Self Mode Active*\n• Only you can use the bot\n• Maximum privacy\n• Others are ignored' 
            : '🌐 *Public Mode Active*\n• Everyone can use the bot\n• Normal operation\n• Based on permissions'}\n\n` +
          `*Commands:*\n` +
          `• .mode self - Enable self mode\n` +
          `• .mode public - Enable public mode\n\n` +
          `© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[Mode] Status error:', error)
      return { response: "❌ Failed to check mode status.\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
    }
  },

  /**
   * Set bot mode in database
   */
  async setMode(telegramId, mode) {
    try {
      await UserQueries.setBotMode(telegramId, mode)
      return true
    } catch (error) {
      logger.error('[Mode] Error setting mode:', error)
      throw error
    }
  },

  /**
   * Get bot mode from database
   */
  async getMode(telegramId) {
    try {
      const settings = await UserQueries.getBotMode(telegramId)
      return settings || { mode: 'public' }
    } catch (error) {
      logger.error('[Mode] Error getting mode:', error)
      return { mode: 'public' }
    }
  }
}