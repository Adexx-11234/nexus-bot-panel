import { createComponentLogger } from "../../utils/logger.js"
import { ActivityQueries } from "../../database/query.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("LISTACTIVE")

export default {
  name: "listactive",
  aliases: ["activeusers", "activemembers", "la"],
  category: "groupmenu",
  description: "Show active group members",
  usage: "listactive",
  adminOnly: true,

  async execute(sock, sessionId, args, m) {
    if (!m.isGroup) {
      await sock.sendMessage(m.chat, {
        text: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
      return
    }

    const adminChecker = new AdminChecker()
    const isAdmin = await adminChecker.isGroupAdmin(sock, m.chat, m.sender)
    
    if (!isAdmin) {
      await sock.sendMessage(m.chat, {
        text: "❌ Only group admins can use this command!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
      return
    }

    try {
      // Get active members (anyone who sent a message)
      const activeMembers = await ActivityQueries.getActiveMembers(m.chat)

      if (!activeMembers || activeMembers.length === 0) {
        await sock.sendMessage(m.chat, {
          text: "😴 No active members found. No one has sent messages yet!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Get group name
      const groupMetadata = await sock.groupMetadata(m.chat).catch(() => null)
      const groupName = groupMetadata?.subject || "This Group"

      // Build message
      let message = `🏆 *ACTIVE MEMBERS - ${groupName}*\n`
      message += `📊 Showing ${activeMembers.length} active members\n\n`

      // Rank emojis
      const rankEmojis = ["👑", "🥈", "🥉"]

      for (let i = 0; i < activeMembers.length; i++) {
        const member = activeMembers[i]
        const userNumber = member.user_jid.split("@")[0]
        const userName = member.user_name || `User ${userNumber.slice(-4)}`
        
        // Crown for top 3
        const rankEmoji = i < 3 ? rankEmojis[i] : `${i + 1}️⃣`
        
        // Last seen time
        const lastSeen = this.getRelativeTime(member.last_seen)
        
        message += `${rankEmoji} *${userName}*\n`
        message += `   📨 ${member.messages} messages`
        
        if (member.media > 0) {
          message += ` | 🖼️ ${member.media} media`
        }
        
        message += `\n   ⏱️ Last seen: ${lastSeen}\n\n`
      }

      message += `━━━━━━━━━━━━━━━━━━━━━━\n`
      message += `💡 Showing all users who sent messages\n`
      message += `📅 Updated: ${new Date().toLocaleDateString()}\n\n`
      message += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

      await sock.sendMessage(m.chat, {
        text: message
      }, { quoted: m })

    } catch (error) {
      logger.error("Error in listactive command:", error)
      await sock.sendMessage(m.chat, {
        text: "❌ Failed to fetch active members!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  },

  getRelativeTime(timestamp) {
    if (!timestamp) return "Never"

    const now = new Date()
    const then = new Date(timestamp)
    const diffMs = now - then
    const diffSeconds = Math.floor(diffMs / 1000)
    const diffMinutes = Math.floor(diffSeconds / 60)
    const diffHours = Math.floor(diffMinutes / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffSeconds < 60) return "Just now"
    if (diffMinutes < 60) return `${diffMinutes} min ago`
    if (diffHours < 24) return `${diffHours} hr ago`
    return `${diffDays} days ago`
  }
}