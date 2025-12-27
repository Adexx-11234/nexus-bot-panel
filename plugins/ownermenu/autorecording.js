import { generateWAMessageFromContent, WAProto as proto } from '@whiskeysockets/baileys'
import { UserQueries } from '../../database/query.js'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('AUTO_RECORDING')

export default {
  name: "Auto-Recording",
  description: "Automatically show recording indicator when receiving messages",
  commands: ["autorecording", "autorecord", "ar"],
  category: "ownermenu",
    permissions: {
    permissions: {
  ownerOnly: true,          // Only bot owner can use (overrides everything)
  privateOnly: true         // Can only be used in private chats
},          // Only bot owner can use (overrides everything)
  privateOnly: true         // Can only be used in private chats
},
  usage: "• .autorecording on/off - Enable/disable\n• .autorecording status - Check status\n• .autorecording - Show interactive menu",

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
        return await this.enableAutoRecording(telegramId, m)
      }

      if (action === 'off' || action === 'disable') {
        return await this.disableAutoRecording(telegramId, m)
      }

      if (action === 'status') {
        return await this.checkStatus(telegramId, m)
      }

      // Show interactive menu if no args
      return await this.showMenu(sock, telegramId, m)

    } catch (error) {
      logger.error('[AutoRecording] Error:', error)
      return { response: "❌ An error occurred while processing the command." }
    }
  },

  async showMenu(sock, telegramId, m) {
    try {
      const settings = await UserQueries.getPresenceSettings(telegramId)
      const currentStatus = settings.auto_recording

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
                text: `🎤 *Auto-Recording Settings*\n\n` +
                      `Current Status: ${currentStatus ? '✅ Enabled' : '❌ Disabled'}\n\n` +
                      `📱 *What it does:*\n` +
                      `• When ON: Shows "recording audio..." for 10-20 seconds when you receive messages\n` +
                      `• When OFF: No automatic recording indicator\n\n` +
                      `⚙️ *Commands:*\n` +
                      `• .autorecording on - Enable\n` +
                      `• .autorecording off - Disable\n` +
                      `• .autorecording status - Check status\n\n` +
                      `Or select an option below:` +
                      `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
              }),
              footer: proto.Message.InteractiveMessage.Footer.create({
                text: "© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
              }),
              header: proto.Message.InteractiveMessage.Header.create({
                title: "🎤 AUTO-RECORDING",
                subtitle: "Recording Indicator Settings",
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
                          title: "Auto-Recording Options",
                          highlight_label: "Current",
                          rows: [
                            {
                              header: "✅ Enable",
                              title: "Turn ON Auto-Recording",
                              description: "Show recording when receiving messages",
                              id: `${m.prefix}autorecording on`
                            },
                            {
                              header: "❌ Disable",
                              title: "Turn OFF Auto-Recording",
                              description: "No automatic recording indicator",
                              id: `${m.prefix}autorecording off`
                            },
                            {
                              header: "📊 Status",
                              title: "Check Current Status",
                              description: "View your current auto-recording setting",
                              id: `${m.prefix}autorecording status`
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

      logger.info(`[AutoRecording] Menu sent to ${telegramId}`)
      return { success: true }
    } catch (error) {
      logger.error('[AutoRecording] Menu error:', error)
      throw error
    }
  },

  async enableAutoRecording(telegramId, m) {
    try {
      await UserQueries.setAutoRecording(telegramId, true)
      logger.info(`[AutoRecording] Enabled for ${telegramId}`)

      return {
        response: 
          `✅ *Auto-Recording ENABLED*\n\n` +
          `🎤 You will now show "recording audio..." indicator when receiving messages\n` +
          `⏱️ Duration: 10-20 seconds (random)\n\n` +
          `💡 This makes your responses seem more natural\n\n` +
          `To disable, use *.autorecording off*` +
          `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[AutoRecording] Enable error:', error)
      return { response: "❌ Failed to enable auto-recording." }
    }
  },

  async disableAutoRecording(telegramId, m) {
    try {
      await UserQueries.setAutoRecording(telegramId, false)
      logger.info(`[AutoRecording] Disabled for ${telegramId}`)

      return {
        response: 
          `❌ *Auto-Recording DISABLED*\n\n` +
          `🎤 Automatic recording indicator is now turned off\n\n` +
          `💡 To enable, use *.autorecording on*` +
          `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[AutoRecording] Disable error:', error)
      return { response: "❌ Failed to disable auto-recording." }
    }
  },

  async checkStatus(telegramId, m) {
    try {
      const settings = await UserQueries.getPresenceSettings(telegramId)

      return {
        response: 
          `📊 *Auto-Recording Status*\n\n` +
          `Current Status: ${settings.auto_recording ? '✅ Enabled' : '❌ Disabled'}\n\n` +
          `${settings.auto_recording 
            ? '🎤 Recording indicator will show automatically\n⏱️ Duration: 10-20 seconds when you receive messages' 
            : '🎤 No automatic recording indicator'}\n\n` +
          `*Commands:*\n` +
          `• .autorecording on - Enable\n` +
          `• .autorecording off - Disable` +
          `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
    } catch (error) {
      logger.error('[AutoRecording] Status error:', error)
      return { response: "❌ Failed to check auto-recording status." }
    }
  }
}