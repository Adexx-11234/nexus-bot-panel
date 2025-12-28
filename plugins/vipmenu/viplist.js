import { VIPQueries } from "../../database/query.js"
import { VIPHelper } from "../../whatsapp/index.js"

export default {
  name: "VIP List",
  description: "List all users you control",
  commands: ["viplist", "vipowned", "myusers"],
  category: "vipmenu",
  usage: "• `.viplist` - View all your claimed users",

  async execute(sock, sessionId, args, m) {
    try {
      const vipTelegramId = VIPHelper.fromSessionId(sessionId)
      if (!vipTelegramId) {
        await sock.sendMessage(m.chat, { text: "❌ Could not identify your session\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
        return
      }

      const vipStatus = await VIPQueries.isVIP(vipTelegramId)
      if (!vipStatus.isVIP) {
        await sock.sendMessage(m.chat, { 
          text: "❌ You don't have VIP access.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return
      }

      const ownedUsers = await VIPQueries.getOwnedUsers(vipTelegramId)

      if (ownedUsers.length === 0) {
        await sock.sendMessage(m.chat, { 
          text: "📋 *Your VIP List*\n\nYou don't have any claimed users yet.\n\nUse `.vipadd <phone>` to claim a user.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return
      }

      let response = `📋 *Your VIP List*\n\n`
      response += `Total Users: ${ownedUsers.length}\n\n`

      ownedUsers.forEach((user, index) => {
        const phone = user.owned_phone || VIPHelper.extractPhone(user.owned_jid) || user.owned_telegram_id || 'Unknown'
        const claimedDate = new Date(user.claimed_at).toLocaleDateString()
        const lastUsed = user.last_used_at ? new Date(user.last_used_at).toLocaleDateString() : 'Never'
        
        response += `${index + 1}. 📱 ${phone}\n`
        response += `   🆔 ${user.owned_telegram_id}\n`
        response += `   📅 Claimed: ${claimedDate}\n`
        response += `   🔄 Last Used: ${lastUsed}\n`
        response += `   📊 Takeovers: ${user.takeovers_count || 0}\n\n`
      })

      response += `\n💡 Commands:\n`
      response += `• \`.vipgroups <phone>\` - View user's groups\n`
      response += `• \`.vipremove <phone>\` - Release a user`

      await sock.sendMessage(m.chat, { text: response }, { quoted: m })

    } catch (error) {
      console.error("[VIPList] Error:", error)
      await sock.sendMessage(m.chat, { 
        text: "❌ Error retrieving your VIP list.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }, { quoted: m })
    }
  }
}