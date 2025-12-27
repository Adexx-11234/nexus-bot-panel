import { createComponentLogger } from "../../utils/logger.js"
import { ActivityQueries } from "../../database/query.js"

const logger = createComponentLogger("LISTINACTIVE")

export default {
  name: "listinactive",
  aliases: ["inactiveusers", "inactivemembers", "li", "inactive"],
  category: "groupmenu",
  description: "Show inactive group members",
  usage: "listinactive",
        permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},

  async execute(sock, sessionId, args, m) {

    try {
      // Get inactive members (compares current group members vs tracked activity)
      const inactiveMembers = await ActivityQueries.getInactiveMembers(sock, m.chat)

      if (!inactiveMembers || inactiveMembers.length === 0) {
        await sock.sendMessage(m.chat, {
          text: "🎉 All members are active! No inactive members found.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Get group name
      const groupMetadata = await sock.groupMetadata(m.chat).catch(() => null)
      const groupName = groupMetadata?.subject || "This Group"

      // Build message
      let message = `😴 *INACTIVE MEMBERS - ${groupName}*\n`
      message += `📊 Showing ${inactiveMembers.length} inactive members\n\n`

      // Show max 30 members (to avoid huge messages)
      const displayLimit = 30
      const displayMembers = inactiveMembers.slice(0, displayLimit)

      // Prepare mentions array
      const mentions = []

      for (let i = 0; i < displayMembers.length; i++) {
        const member = displayMembers[i]
        const userNumber = member.user_jid.split("@")[0]
        
        const lastSeen = this.getRelativeTime(member.last_seen)
        
        message += `${i + 1}️⃣ @${userNumber}\n`
        message += `   📨 ${member.messages} messages\n`
        message += `   ⏱️ Last seen: ${lastSeen}\n\n`
        
        // Add to mentions
        mentions.push(member.user_jid)
      }

      if (inactiveMembers.length > displayLimit) {
        message += `... and ${inactiveMembers.length - displayLimit} more\n\n`
      }

      message += `━━━━━━━━━━━━━━━━━━━━━━\n`
      message += `💡 Members who haven't sent messages\n`
      message += `📅 Updated: ${new Date().toLocaleDateString()}\n\n`
      message += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

      await sock.sendMessage(m.chat, {
        text: message,
        mentions: mentions
      }, { quoted: m })

    } catch (error) {
      logger.error("Error in listinactive command:", error)
      await sock.sendMessage(m.chat, {
        text: "❌ Failed to fetch inactive members!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
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