import { VIPQueries } from "../../database/query.js"
import { VIPHelper } from "../../whatsapp/index.js"

export default {
  name: "VIP Admin",
  description: "View all VIP users and their statistics (Default VIP only)",
  commands: ["vipadmin", "viplist-all", "vipmanage"],
  category: "vipmenu",
  usage: "• `.vipadmin` - View all VIP users and stats",
      permissions: {
  defaultVipOnly: true,
  privateOnly: true
},

  async execute(sock, sessionId, args, m) {
    try {
      // Get all VIPs
      const allVIPs = await VIPQueries.getAllVIPs()

      if (allVIPs.length === 0) {
        await sock.sendMessage(m.chat, { 
          text: "👑 *VIP Administration Panel*\n\nNo VIP users found.\n\nUse `.vippromote <phone>` to create VIP users.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return
      }

      let response = `👑 *VIP ADMINISTRATION PANEL*\n\n`
      response += `Total VIP Users: ${allVIPs.length}\n\n`

for (let i = 0; i < allVIPs.length; i++) {
  const vip = allVIPs[i]
  let phone = vip.phone
  
  // If no phone in whatsapp_users, try to get from users table
  if (!phone) {
    try {
      const userResult = await queryManager.execute(
        `SELECT phone_number FROM users WHERE telegram_id = $1 LIMIT 1`,
        [vip.telegram_id]
      )
      if (userResult.rows.length > 0 && userResult.rows[0].phone_number) {
        // Extract clean phone from format like +2349036074532:5
        phone = userResult.rows[0].phone_number.split(':')[0].replace(/[^0-9]/g, '')
      }
    } catch (err) {
      // Fallback to extracting from JID
      phone = vip.jid ? VIPHelper.extractPhone(vip.jid) : null
    }
  }
  phone = phone || vip.telegram_id || 'Unknown'
  
  const lastActivity = vip.last_activity ? new Date(vip.last_activity).toLocaleDateString() : 'Never'
  const levelEmoji = vip.is_default_vip ? '👑' : vip.vip_level === 2 ? '⭐⭐' : '⭐'
  
  response += `${i + 1}. ${levelEmoji} ${phone}\n`
  response += `   🆔 ${vip.telegram_id}\n`
  response += `   📊 Level: ${vip.vip_level}${vip.is_default_vip ? ' (Default)' : ''}\n`
  response += `   👥 Owned Users: ${vip.owned_users_count || 0}\n`
  response += `   🕒 Last Active: ${lastActivity}\n\n`
}

      response += `\n💡 *Admin Commands:*\n`
      response += `• \`.vipdetails <phone>\` - View detailed info\n`
      response += `• \`.vippromote <phone>\` - Promote to VIP\n`
      response += `• \`.vipdemote <phone>\` - Demote VIP\n`
      response += `• \`.vipreassign <user> <newvip>\` - Reassign user\n`
      response += `• \`.vipunclaim <phone>\` - Force unclaim user`

      await sock.sendMessage(m.chat, { text: response }, { quoted: m })

    } catch (error) {
      console.error("[VIPAdmin] Error:", error)
      await sock.sendMessage(m.chat, { 
        text: "❌ Error retrieving VIP administration data.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }, { quoted: m })
    }
  }
}