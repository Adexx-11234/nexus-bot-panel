import { UserQueries } from "../../database/query.js"

export default {
  name: "Anti-ViewOnce",
  description: "Enable or disable automatic ViewOnce message forwarding to your personal chat",
  commands: ["antiviewonce", "avon", "avoff"],
  category: "ownermenu", // Changed from "utility" to "ownermenu"
    permissions: {
    permissions: {
  ownerOnly: true,          // Only bot owner can use (overrides everything)
  privateOnly: true         // Can only be used in private chats
},          // Only bot owner can use (overrides everything)
  privateOnly: true         // Can only be used in private chats
},
  usage: `• \`.antiviewonce on\` - Enable forwarding\n• \`.antiviewonce off\` - Disable forwarding  \n• \`.antiviewonce status\` - Check status`,

_normalizeWhatsAppJid(jid) {
  if (!jid) return jid
  // Extract the phone number part and normalize to standard format
  const phoneNumber = jid.split('@')[0].split(':')[0]
  const domain = jid.includes('@') ? jid.split('@')[1] : 's.whatsapp.net'
  return `${phoneNumber}@${domain}`
},

  async execute(sock, sessionId, args, m) {
    try {
      const senderJid = this._normalizeWhatsAppJid(m.sender)
      const chatJid = m.key.remoteJid || m.chat

      // Check if in group (owner commands can be used in groups too)
      if (chatJid?.endsWith("@g.us")) {
        await sock.sendMessage(chatJid, {
          text: "❌ This command can only be used in private chats. Please message me directly.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      const action = args[0]?.toLowerCase()

      if (!action || !["on", "off", "enable", "disable", "status"].includes(action)) {
        const helpText = 
          `❌ Invalid usage. Use:\n` +
          `• \`.antiviewonce on\` - Enable forwarding\n` +
          `• \`.antiviewonce off\` - Disable forwarding\n` +
          `• \`.antiviewonce status\` - Check status`
        
        await sock.sendMessage(chatJid, {
          text: helpText
        }, { quoted: m })
        return
      }

      const telegramId = m.sessionContext?.telegram_id || null

      if (!telegramId) {
        await sock.sendMessage(chatJid, {
          text: "❌ Unable to identify your Telegram account. Please ensure you're properly connected.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      if (action === "status") {
        const isEnabled = await UserQueries.isAntiViewOnceEnabled(senderJid, telegramId)
        const statusText = 
          `🔍 *Anti-ViewOnce Status*\n\n` +
          `Status: ${isEnabled ? "✅ Enabled" : "❌ Disabled"}\n\n` +
          `${isEnabled ? "ViewOnce messages from anywhere will be forwarded to you." : "ViewOnce messages will not be forwarded."}`
        
        await sock.sendMessage(chatJid, {
          text: statusText
        }, { quoted: m })
        return
      }

      const enable = ["on", "enable"].includes(action)

      try {
        await UserQueries.setAntiViewOnce(senderJid, enable, telegramId)

        const status = enable ? "enabled" : "disabled"
        const emoji = enable ? "✅" : "❌"
        
        const responseText = 
          `${emoji} *Anti-ViewOnce ${status.toUpperCase()}*\n\n` +
          `ViewOnce message forwarding has been ${status}.\n\n` +
          `${enable ? "🔍 ViewOnce messages from any chat will now be forwarded to you here." : "⏸️ ViewOnce messages will no longer be forwarded."}`

        await sock.sendMessage(chatJid, {
          text: responseText
        }, { quoted: m })

      } catch (dbError) {
        console.error("[AntiViewOnce] Database error:", dbError)
        await sock.sendMessage(chatJid, {
          text: "❌ Failed to update anti-viewonce settings. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
      }

    } catch (error) {
      console.error("[AntiViewOnce] Plugin error:", error)
      await sock.sendMessage(chatJid, {
        text: "❌ An error occurred while processing the command.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  },
}