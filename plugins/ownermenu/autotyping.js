import { generateWAMessageFromContent, proto } from '@whiskeysockets/baileys'
import { UserQueries } from '../../database/query.js'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('AUTO_TYPING')

export default {
  name: "Auto-Typing",
  description: "Automatically show typing indicator when receiving messages",
  commands: ["autotyping", "at"],
  category: "ownermenu",
  ownerOnly: true,
  usage: "• .autotyping on/off - Enable/disable\n• .autotyping status - Check status\n• .autotyping - Show interactive menu",

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
        return await this.enableAutoTyping(telegramId, m)
      }

      if (action === 'off' || action === 'disable') {
        return await this.disableAutoTyping(telegramId, m)
      }

      if (action === 'status') {
        return await this.checkStatus(telegramId, m)
      }

      // Show interactive menu if no args
      return await this.showMenu(sock, telegramId, m)

    } catch (error) {
      logger.error('[AutoTyping] Error:', error)
      return { response: "❌ An error occurred while processing the command." + `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }
    }
  },

  async showMenu(sock, telegramId, m) {
    try {
      const settings = await UserQueries.getPresenceSettings(telegramId)
      const currentStatus = settings.auto_typing

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
                text: `⌨️ *Auto-Typing Settings*\n\n` +
                      `Current Status: ${currentStatus ? '✅ Enabled' : '❌ Disabled'}\n\n` +
                      `📱 *What it does:*\n` +
                      `• When ON: Shows "typing..." for 10-20 seconds when you receive messages\n` +
                      `• When OFF: No automatic typing indicator\n\n` +
                      `⚙️ *Commands:*\n` +
                      `• .autotyping on - Enable\n` +
                      `• .autotyping off - Disable\n` +
                      `• .autotyping status - Check status\n\n` +
                      `Or select an option below:` +
                       `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
              }),
              footer: proto.Message.InteractiveMessage.Footer.create({
                text: "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
              }),
              header: proto.Message.InteractiveMessage.Header.create({
                title: "⌨️ AUTO-TYPING",
                subtitle: "Typing Indicator Settings",
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
                          title: "Auto-Typing Options",
                          highlight_label: "Current",
                          rows: [
                            {
                              header: "✅ Enable",
                              title: "Turn ON Auto-Typing",
                              description: "Show typing when receiving messages",
                              id: `${m.prefix}autotyping on`
                            },
                            {
                              header: "❌ Disable",
                              title: "Turn OFF Auto-Typing",
                              description: "No automatic typing indicator",
                              id: `${m.prefix}autotyping off`
                            },
                            {
                              header: "📊 Status",
                              title: "Check Current Status",
                              description: "View your current auto-typing setting",
                              id: `${m.prefix}autotyping status`
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

      logger.info(`[AutoTyping] Menu sent to ${telegramId}`)
      return { success: true }
    } catch (error) {
      logger.error('[AutoTyping] Menu error:', error)
      throw error
    }
  },

  async enableAutoTyping(telegramId, m) {
    try {
      await UserQueries.setAutoTyping(telegramId, true)
      logger.info(`[AutoTyping] Enabled for ${telegramId}`)

      return {
        response: 
          `✅ *Auto-Typing ENABLED*\n\n` +
          `⌨️ You will now show "typing..." indicator when receiving messages\n` +
          `⏱️ Duration: 10-20 seconds (random)\n\n` +
          `💡 This makes your responses seem more natural\n\n` +
          `To disable, use *.autotyping off*` +
           `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[AutoTyping] Enable error:', error)
      return { response: "❌ Failed to enable auto-typing." }
    }
  },

  async disableAutoTyping(telegramId, m) {
    try {
      await UserQueries.setAutoTyping(telegramId, false)
      logger.info(`[AutoTyping] Disabled for ${telegramId}`)

      return {
        response: 
          `❌ *Auto-Typing DISABLED*\n\n` +
          `⌨️ Automatic typing indicator is now turned off\n\n` +
          `💡 To enable, use *.autotyping on*` +
          `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[AutoTyping] Disable error:', error)
      return { response: "❌ Failed to disable auto-typing." }
    }
  },

  async checkStatus(telegramId, m) {
    try {
      const settings = await UserQueries.getPresenceSettings(telegramId)

      return {
        response: 
          `📊 *Auto-Typing Status*\n\n` +
          `Current Status: ${settings.auto_typing ? '✅ Enabled' : '❌ Disabled'}\n\n` +
          `${settings.auto_typing 
            ? '⌨️ Typing indicator will show automatically\n⏱️ Duration: 10-20 seconds when you receive messages' 
            : '⌨️ No automatic typing indicator'}\n\n` +
          `*Commands:*\n` +
          `• .autotyping on - Enable\n` +
          `• .autotyping off - Disable` +
           `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[AutoTyping] Status error:', error)
      return { response: "❌ Failed to check auto-typing status." }
    }
  }
}