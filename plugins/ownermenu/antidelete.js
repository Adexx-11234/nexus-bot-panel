import { UserQueries } from "../../database/query.js"

export default {
  name: "Anti-Deleted",
  description: "Enable or disable automatic deleted message recovery and forwarding to your personal chat",
  commands: ["antidelete", "adon", "adoff"],
  category: "ownermenu", // Changed from "utility" to "ownermenu"
  ownerOnly: true, // Explicitly mark as owner-only
  usage: `• \`.antideleted on\` - Enable deleted message recovery\n• \`.antideleted off\` - Disable deleted message recovery\n• \`.antideleted status\` - Check current status`,

  _normalizeWhatsAppJid(jid) {
    if (!jid) return jid
    return jid.replace(/:\d+@/, "@")
  },

  async execute(sock, sessionId, args, m) {
    try {
      const senderJid = this._normalizeWhatsAppJid(m.sender)
      const chatJid = m.key.remoteJid

      if (chatJid?.endsWith("@g.us")) {
        return {
          response: "❌ This command can only be used in private chats. Please message me directly." + `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          mentions: [],
        }
      }

      const action = args[0]?.toLowerCase()
      if (!action || !["on", "off", "enable", "disable", "status"].includes(action)) {
        return {
          response: `❌ Invalid usage. Use:\n• \`.antideleted on\` - Enable deleted message recovery\n• \`.antideleted off\` - Disable deleted message recovery\n• \`.antideleted status\` - Check current status\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          mentions: [],
        }
      }

      const telegramId = m.sessionContext?.telegram_id || null
      if (!telegramId) {
        return {
          response: "❌ Unable to identify your Telegram account. Please ensure you're properly connected.",
          mentions: [],
        }
      }

      if (action === "status") {
        try {
          const isEnabled = await UserQueries.isAntiDeletedEnabled(senderJid, telegramId)
          return {
            response: `🔍 Anti-Deleted Status\n\nStatus: ${isEnabled ? "✅ Enabled" : "❌ Disabled"}\n\n${isEnabled 
  ? "Deleted messages from any chat will be recovered and forwarded to you." 
  : "Deleted messages will not be recovered or forwarded."}` +
              `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            mentions: [],
          }
        } catch (statusError) {
          console.error("[AntiDeleted] Status check error:", statusError)
          return {
            response: "❌ Failed to check anti-deleted status. Please try again.",
            mentions: [],
          }
        }
      }

      const enable = ["on", "enable"].includes(action)
      try {
        await UserQueries.setAntiDeleted(senderJid, enable, telegramId)
        const status = enable ? "enabled" : "disabled"
        const emoji = enable ? "✅" : "❌"
        return {
          response: `${emoji} Anti-Deleted ${status.toUpperCase()}\n\nDeleted message recovery has been ${status}.\n\n${enable 
  ? "🗑️ Deleted messages from any chat will now be recovered and forwarded to you here."
  : "⏸️ Deleted messages will no longer be recovered or forwarded."}`
          + `\n\n© 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          mentions: [],
        }
      } catch (dbError) {
        console.error("[AntiDeleted] Database error:", dbError)
        return {
          response: "❌ Failed to update anti-deleted settings. Please try again.",
          mentions: [],
        }
      }
    } catch (error) {
      console.error("[AntiDeleted] Plugin error:", error)
      return {
        response: "❌ An error occurred while processing the command.",
        mentions: [],
      }
    }
  },
}


