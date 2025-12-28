import { VIPQueries } from "../../database/query.js"
import { VIPHelper } from "../../whatsapp/index.js"

export default {
  name: "VIP Details",
  description: "View detailed information about a VIP user (Default VIP only)",
  commands: ["vipdetails", "vipinfo"],
  category: "vipmenu",
  usage: "• `.vipdetails <phone>` - View VIP user details",

  async execute(sock, sessionId, args, m) {
    try {
      const adminTelegramId = VIPHelper.fromSessionId(sessionId)
      if (!adminTelegramId) {
        await sock.sendMessage(m.chat, { text: "❌ Could not identify your session\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }, { quoted: m })
        return
      }

      // Check if user is Default VIP
      const adminStatus = await VIPQueries.isVIP(adminTelegramId)
      if (!adminStatus.isDefault && adminStatus.level !== 99) {
        await sock.sendMessage(m.chat, { 
          text: "❌ This command is only available to Default VIP (bot owner).\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return
      }

      // Parse target phone
      let targetPhone = null
      
      if (args.length > 0) {
        targetPhone = args[0].replace(/[@\s\-+]/g, '')
      }

      if (!targetPhone || !/^\d{10,15}$/.test(targetPhone)) {
        await sock.sendMessage(m.chat, { 
          text: "❌ Please provide a valid phone number.\n\nUsage: `.vipdetails 2347067023422`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return
      }

      // Convert phone to telegram ID
      const targetUser = await VIPQueries.getUserByPhone(targetPhone)

      if (!targetUser || !targetUser.telegram_id) {
        await sock.sendMessage(m.chat, { 
          text: `❌ User with phone ${targetPhone} is not registered.

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
        }, { quoted: m })
        return
      }

      const targetTelegramId = targetUser.telegram_id

      // Get VIP details
      const vipDetails = await VIPQueries.getVIPDetails(targetTelegramId)

      if (!vipDetails || !vipDetails.vip) {
        await sock.sendMessage(m.chat, { 
          text: `ℹ️ User ${targetPhone} is not a VIP user.

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
        }, { quoted: m })
        return
      }

      const vip = vipDetails.vip
      const ownedUsers = vipDetails.ownedUsers
      const recentActivity = vipDetails.recentActivity

      let response = `📊 *VIP DETAILS*\n\n`
      response += `👤 *User Information:*\n`
      response += `📱 Phone: ${targetPhone}\n`
      response += `👤 Name: ${targetUser.first_name || 'Unknown'}\n`
      response += `🆔 Telegram ID: ${vip.telegram_id}\n`
      response += `⭐ VIP Level: ${vip.vip_level}${vip.is_default_vip ? ' (Default VIP)' : ''}\n`
      response += `📅 Account Created: ${new Date(vip.created_at).toLocaleDateString()}\n\n`

      // Owned users section
      response += `👥 *Owned Users (${ownedUsers.length}):*\n`
      if (ownedUsers.length === 0) {
        response += `   No owned users\n`
      } else {
        for (let idx = 0; idx < ownedUsers.length; idx++) {
          const user = ownedUsers[idx]
          let userPhone = user.owned_phone
          
          // Try to get phone from users table if not in owned_phone
          if (!userPhone && user.owned_telegram_id) {
            try {
              const userLookup = await VIPQueries.getUserByTelegramId(user.owned_telegram_id)
              if (userLookup?.phone_number) {
                userPhone = userLookup.phone_number.split(':')[0].replace(/[^0-9]/g, '')
              }
            } catch (err) {
              // Fallback to JID extraction
              userPhone = user.owned_jid ? VIPHelper.extractPhone(user.owned_jid) : null
            }
          }
          userPhone = userPhone || user.owned_telegram_id || 'Unknown'
          
          const claimedDate = new Date(user.claimed_at).toLocaleDateString()
          response += `   ${idx + 1}. ${userPhone}\n`
          response += `      Claimed: ${claimedDate}\n`
          response += `      Takeovers: ${user.takeovers_count || 0}\n`
        }
      }

      response += `\n🕒 *Recent Activity (Last 10):*\n`
      if (recentActivity.length === 0) {
        response += `   No recent activity\n`
      } else {
        recentActivity.slice(0, 5).forEach((activity, idx) => {
          const date = new Date(activity.created_at).toLocaleString()
          const actionEmoji = {
            'claim_user': '➕',
            'takeover': '🎯',
            'view_groups': '👁️',
            'release_user': '➖'
          }
          response += `   ${actionEmoji[activity.action_type] || '•'} ${activity.action_type}\n`
          response += `      ${date}\n`
        })
      }

      response += `\n💡 *Management Commands:*\n`
      response += `• \`.vipdemote ${targetPhone}\` - Remove VIP status\n`
      response += `• \`.vipreassign <user> ${targetPhone}\` - Assign user to this VIP`

      await sock.sendMessage(m.chat, { text: response }, { quoted: m })

    } catch (error) {
      console.error("[VIPDetails] Error:", error)
      await sock.sendMessage(m.chat, { 
        text: "❌ Error retrieving VIP details.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }, { quoted: m })
    }
  }
}