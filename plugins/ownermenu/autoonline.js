import { generateWAMessageFromContent, proto } from '@whiskeysockets/baileys'
import { UserQueries } from '../../database/query.js'
import { createComponentLogger } from '../../utils/logger.js'
import { getPresenceManager } from '../../whatsapp/index.js'

const logger = createComponentLogger('AUTO_ONLINE')

export default {
  name: "Auto-Online",
  description: "Automatically stay online or appear offline",
  commands: ["autoonline", "ao"],
  category: "ownermenu",
  ownerOnly: true,
  usage: "• .autoonline on/off - Enable/disable\n• .autoonline status - Check status\n• .autoonline - Show interactive menu" + `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,

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
        return await this.enableAutoOnline(sock, sessionId, telegramId, m)
      }

      if (action === 'off' || action === 'disable') {
        return await this.disableAutoOnline(sock, sessionId, telegramId, m)
      }

      if (action === 'status') {
        return await this.checkStatus(telegramId, m)
      }

      // Show interactive menu if no args
      return await this.showMenu(sock, telegramId, m)

    } catch (error) {
      logger.error('[AutoOnline] Error:', error)
      return { response: "❌ An error occurred while processing the command." + `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }
    }
  },

  async showMenu(sock, telegramId, m) {
    try {
      const settings = await UserQueries.getPresenceSettings(telegramId)
      const currentStatus = settings.auto_online

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
                text: `🟢 *Auto-Online Settings*\n\n` +
                      `Current Status: ${currentStatus ? '✅ Enabled' : '❌ Disabled'}\n\n` +
                      `📱 *What it does:*\n` +
                      `• When ON: Always appear online to others\n` +
                      `• When OFF: Appear offline (default)\n\n` +
                      `⚙️ *Commands:*\n` +
                      `• .autoonline on - Enable\n` +
                      `• .autoonline off - Disable\n` +
                      `• .autoonline status - Check status\n\n` +
                      `Or select an option below:` +
                      `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
              }),
              footer: proto.Message.InteractiveMessage.Footer.create({
                text: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
              }),
              header: proto.Message.InteractiveMessage.Header.create({
                title: "🟢 AUTO-ONLINE",
                subtitle: "Presence Settings",
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
                          title: "Auto-Online Options",
                          highlight_label: "Current",
                          rows: [
                            {
                              header: "✅ Enable",
                              title: "Turn ON Auto-Online",
                              description: "Always appear online to others",
                              id: `${m.prefix}autoonline on`
                            },
                            {
                              header: "❌ Disable",
                              title: "Turn OFF Auto-Online",
                              description: "Appear offline (default mode)",
                              id: `${m.prefix}autoonline off`
                            },
                            {
                              header: "📊 Status",
                              title: "Check Current Status",
                              description: "View your current auto-online setting",
                              id: `${m.prefix}autoonline status`
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

      logger.info(`[AutoOnline] Menu sent to ${telegramId}`)
      return { success: true }
    } catch (error) {
      logger.error('[AutoOnline] Menu error:', error)
      throw error
    }
  },

  async enableAutoOnline(sock, sessionId, telegramId, m) {
    try {
      await UserQueries.setAutoOnline(telegramId, true)
      
      // Update presence immediately
      const presenceManager = getPresenceManager()
      await presenceManager._sendPresence(sock, 'available')

      logger.info(`[AutoOnline] Enabled for ${telegramId}`)

      return {
        response: 
          `✅ *Auto-Online ENABLED*\n\n` +
          `🟢 You will now always appear online to others\n` +
          `📱 Your status is now set to: *Online*\n\n` +
          `💡 To disable, use *.autoonline off*` +
          `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[AutoOnline] Enable error:', error)
      return { response: "❌ Failed to enable auto-online." }
    }
  },

  async disableAutoOnline(sock, sessionId, telegramId, m) {
    try {
      await UserQueries.setAutoOnline(telegramId, false)
      
      // Update presence immediately
      const presenceManager = getPresenceManager()
      await presenceManager._sendPresence(sock, 'unavailable')

      logger.info(`[AutoOnline] Disabled for ${telegramId}`)

      return {
        response: 
          `❌ *Auto-Online DISABLED*\n\n` +
          `⚫ You will now appear offline (default mode)\n` +
          `📱 Your status is now set to: *Offline*\n\n` +
          `💡 To enable, use *.autoonline on*` +
          `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[AutoOnline] Disable error:', error)
      return { response: "❌ Failed to disable auto-online." }
    }
  },

  async checkStatus(telegramId, m) {
    try {
      const settings = await UserQueries.getPresenceSettings(telegramId)

      return {
        response: 
          `📊 *Auto-Online Status*\n\n` +
          `Current Status: ${settings.auto_online ? '✅ Enabled' : '❌ Disabled'}\n` +
          `Current Presence: ${settings.auto_online ? '🟢 Online' : '⚫ Offline'}\n\n` +
          `${settings.auto_online 
            ? '💡 Others can see you as online' 
            : '💡 You appear offline to others'}\n\n` +
          `*Commands:*\n` +
          `• .autoonline on - Enable\n` +
          `• .autoonline off - Disable` +
          `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[AutoOnline] Status error:', error)
      return { response: "❌ Failed to check auto-online status." }
    }
  }
}