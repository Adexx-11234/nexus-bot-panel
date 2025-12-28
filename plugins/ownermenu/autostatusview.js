import { generateWAMessageFromContent, WAProto as proto } from '@whiskeysockets/baileys'
import { UserQueries } from '../../database/query.js'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('AUTO_STATUS_VIEW')

export default {
  name: "Auto-Status-View",
  description: "Automatically view WhatsApp statuses",
  commands: ["autostatusview", "autoview", "asv"],
  category: "ownermenu",
  ownerOnly: true,
  usage: "• .autostatusview on/off - Enable/disable\n• .autostatusview status - Check status\n• .autostatusview - Show interactive menu",

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
        return await this.enableAutoStatusView(telegramId, m)
      }

      if (action === 'off' || action === 'disable') {
        return await this.disableAutoStatusView(telegramId, m)
      }

      if (action === 'status') {
        return await this.checkStatus(telegramId, m)
      }

      // Show interactive menu if no args
      return await this.showMenu(sock, telegramId, m)

    } catch (error) {
      logger.error('[AutoStatusView] Error:', error)
      return { response: "❌ An error occurred while processing the command." + `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`}
    }
  },

  async showMenu(sock, telegramId, m) {
    try {
      const settings = await UserQueries.getPresenceSettings(telegramId)
      const currentStatus = settings.auto_status_view

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
                text: `👁️ *Auto-Status-View Settings*\n\n` +
                      `Current Status: ${currentStatus ? '✅ Enabled' : '❌ Disabled'}\n\n` +
                      `📱 *What it does:*\n` +
                      `• When ON: Automatically views all WhatsApp statuses posted by your contacts\n` +
                      `• When OFF: Statuses are not automatically viewed\n\n` +
                      `⚙️ *Commands:*\n` +
                      `• .autostatusview on - Enable\n` +
                      `• .autostatusview off - Disable\n` +
                      `• .autostatusview status - Check status\n\n` +
                      `Or select an option below:` +
                      `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
              }),
              footer: proto.Message.InteractiveMessage.Footer.create({
                text: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
              }),
              header: proto.Message.InteractiveMessage.Header.create({
                title: "👁️ AUTO-STATUS-VIEW",
                subtitle: "Status Viewing Settings",
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
                          title: "Auto-Status-View Options",
                          highlight_label: "Current",
                          rows: [
                            {
                              header: "✅ Enable",
                              title: "Turn ON Auto-Status-View",
                              description: "Automatically view all statuses",
                              id: `${m.prefix}autostatusview on`
                            },
                            {
                              header: "❌ Disable",
                              title: "Turn OFF Auto-Status-View",
                              description: "Don't automatically view statuses",
                              id: `${m.prefix}autostatusview off`
                            },
                            {
                              header: "📊 Status",
                              title: "Check Current Status",
                              description: "View your current auto-status-view setting",
                              id: `${m.prefix}autostatusview status`
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

      logger.info(`[AutoStatusView] Menu sent to ${telegramId}`)
      return { success: true }
    } catch (error) {
      logger.error('[AutoStatusView] Menu error:', error)
      throw error
    }
  },

  async enableAutoStatusView(telegramId, m) {
    try {
      await UserQueries.setAutoStatusView(telegramId, true)
      logger.info(`[AutoStatusView] Enabled for ${telegramId}`)

      return {
        response: 
          `✅ *Auto-Status-View ENABLED*\n\n` +
          `👁️ All WhatsApp statuses will now be automatically viewed\n` +
          `📱 Your contacts will see that you've viewed their status\n\n` +
          `💡 This happens automatically in the background\n\n` +
          `To disable, use *.autostatusview off*` +
          `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[AutoStatusView] Enable error:', error)
      return { response: "❌ Failed to enable auto-status-view." }
    }
  },

  async disableAutoStatusView(telegramId, m) {
    try {
      await UserQueries.setAutoStatusView(telegramId, false)
      logger.info(`[AutoStatusView] Disabled for ${telegramId}`)

      return {
        response: 
          `❌ *Auto-Status-View DISABLED*\n\n` +
          `👁️ Automatic status viewing is now turned off\n` +
          `📱 Statuses will not be viewed automatically\n\n` +
          `💡 To enable, use *.autostatusview on*` +
          `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[AutoStatusView] Disable error:', error)
      return { response: "❌ Failed to disable auto-status-view." }
    }
  },

  async checkStatus(telegramId, m) {
    try {
      const settings = await UserQueries.getPresenceSettings(telegramId)

      return {
        response: 
          `📊 *Auto-Status-View Status*\n\n` +
          `Current Status: ${settings.auto_status_view ? '✅ Enabled' : '❌ Disabled'}\n\n` +
          `${settings.auto_status_view 
            ? '👁️ All statuses are being automatically viewed' 
            : '👁️ Statuses are not automatically viewed'}\n\n` +
          `*Commands:*\n` +
          `• .autostatusview on - Enable\n` +
          `• .autostatusview off - Disable` +
          `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[AutoStatusView] Status error:', error)
      return { response: "❌ Failed to check auto-status-view status." }
    }
  }
}