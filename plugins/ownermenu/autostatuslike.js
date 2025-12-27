import { generateWAMessageFromContent,WAProto as proto } from '@whiskeysockets/baileys'
import { UserQueries } from '../../database/query.js'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('AUTO_STATUS_LIKE')

export default {
  name: "Auto-Status-Like",
  description: "Automatically react to WhatsApp statuses with random emojis",
  commands: ["autostatuslike", "autolike", "asl"],
  category: "ownermenu",
    permissions: {
  ownerOnly: true,          // Only bot owner can use (overrides everything)
  privateOnly: true         // Can only be used in private chats
},
  usage: "• .autostatuslike on/off - Enable/disable\n• .autostatuslike status - Check status\n• .autostatuslike - Show interactive menu",

  async execute(sock, sessionId, args, m) {
    try {
      const telegramId = m.sessionContext?.telegram_id || null
      
      if (!telegramId) {
        return {
          response: "❌ Unable to identify your account. Please ensure you're properly connected." + `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        }
      }

      const action = args[0]?.toLowerCase()

      // Handle text commands
      if (action === 'on' || action === 'enable') {
        return await this.enableAutoStatusLike(telegramId, m)
      }

      if (action === 'off' || action === 'disable') {
        return await this.disableAutoStatusLike(telegramId, m)
      }

      if (action === 'status') {
        return await this.checkStatus(telegramId, m)
      }

      // Show interactive menu if no args
      return await this.showMenu(sock, telegramId, m)

    } catch (error) {
      logger.error('[AutoStatusLike] Error:', error)
      return { response: "❌ An error occurred while processing the command." }
    }
  },

  async showMenu(sock, telegramId, m) {
    try {
      const settings = await UserQueries.getPresenceSettings(telegramId)
      const currentStatus = settings.auto_status_like

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
                text: `❤️ *Auto-Status-Like Settings*\n\n` +
                      `Current Status: ${currentStatus ? '✅ Enabled' : '❌ Disabled'}\n\n` +
                      `📱 *What it does:*\n` +
                      `• When ON: Automatically reacts to statuses with random emojis (❤️, 🔥, 😍, 👍, 😊, 🎉)\n` +
                      `• When OFF: No automatic reactions to statuses\n\n` +
                      `⚙️ *Commands:*\n` +
                      `• .autostatuslike on - Enable\n` +
                      `• .autostatuslike off - Disable\n` +
                      `• .autostatuslike status - Check status\n\n` +
                      `Or select an option below:` +
                      `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
              }),
              footer: proto.Message.InteractiveMessage.Footer.create({
                text: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
              }),
              header: proto.Message.InteractiveMessage.Header.create({
                title: "❤️ AUTO-STATUS-LIKE",
                subtitle: "Status Reaction Settings",
                hasMediaAttachment: false
              }),
              nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                buttons: [
                  {
                    name: "single_select",
                    buttonParamsJson: JSON.stringify({
                      title: "⚙️ Select Status",
                      sections: [
                        {
                          title: "Auto-Status-Like Options",
                          highlight_label: "Current",
                          rows: [
                            {
                              header: "✅ Enable",
                              title: "Turn ON Auto-Status-Like",
                              description: "React to all statuses with random emojis",
                              id: `${m.prefix}autostatuslike on`
                            },
                            {
                              header: "❌ Disable",
                              title: "Turn OFF Auto-Status-Like",
                              description: "Don't automatically react to statuses",
                              id: `${m.prefix}autostatuslike off`
                            },
                            {
                              header: "📊 Status",
                              title: "Check Current Status",
                              description: "View your current auto-status-like setting",
                              id: `${m.prefix}autostatuslike status`
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

      logger.info(`[AutoStatusLike] Menu sent to ${telegramId}`)
      return { success: true }
    } catch (error) {
      logger.error('[AutoStatusLike] Menu error:', error)
      throw error
    }
  },

  async enableAutoStatusLike(telegramId, m) {
    try {
      await UserQueries.setAutoStatusLike(telegramId, true)
      logger.info(`[AutoStatusLike] Enabled for ${telegramId}`)

      return {
        response: 
          `✅ *Auto-Status-Like ENABLED*\n\n` +
          `❤️ All WhatsApp statuses will now be automatically reacted to\n` +
          `🎲 Random emojis will be used: ❤️, 🔥, 😍, 👍, 😊, 🎉\n` +
          `📱 Your contacts will see your reactions\n\n` +
          `💡 This happens automatically in the background\n\n` +
          `To disable, use *.autostatuslike off*` +
          `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[AutoStatusLike] Enable error:', error)
      return { response: "❌ Failed to enable auto-status-like." }
    }
  },

  async disableAutoStatusLike(telegramId, m) {
    try {
      await UserQueries.setAutoStatusLike(telegramId, false)
      logger.info(`[AutoStatusLike] Disabled for ${telegramId}`)

      return {
        response: 
          `❌ *Auto-Status-Like DISABLED*\n\n` +
          `❤️ Automatic status reactions are now turned off\n` +
          `📱 Statuses will not be reacted to automatically\n\n` +
          `💡 To enable, use *.autostatuslike on*` +
          `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[AutoStatusLike] Disable error:', error)
      return { response: "❌ Failed to disable auto-status-like." }
    }
  },

  async checkStatus(telegramId, m) {
    try {
      const settings = await UserQueries.getPresenceSettings(telegramId)

      return {
        response: 
          `📊 *Auto-Status-Like Status*\n\n` +
          `Current Status: ${settings.auto_status_like ? '✅ Enabled' : '❌ Disabled'}\n\n` +
          `${settings.auto_status_like 
            ? '❤️ Statuses are being automatically reacted to\n🎲 Random emojis: ❤️, 🔥, 😍, 👍, 😊, 🎉' 
            : '❤️ Statuses are not automatically reacted to'}\n\n` +
          `*Commands:*\n` +
          `• .autostatuslike on - Enable\n` +
          `• .autostatuslike off - Disable` +
          `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[AutoStatusLike] Status error:', error)
      return { response: "❌ Failed to check auto-status-like status." }
    }
  }
}