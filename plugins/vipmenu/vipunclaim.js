import { VIPQueries } from "../../database/query.js"
import { VIPHelper } from "../../whatsapp/index.js"

export default {
  name: "VIP Unclaim",
  description: "Force unclaim a user from any VIP (Default VIP only)",
  commands: ["vipunclaim", "viprelease-admin"],
  category: "vipmenu",
  usage: "• `.vipunclaim <phone>` - Force release user from VIP ownership",
        permissions: {
  ownerAndVip: true,
  privateOnly: true
},

  async execute(sock, sessionId, args, m) {
    try {

      // Parse target phone
      let targetPhone = null
      
      if (args.length > 0) {
        targetPhone = args[0].replace(/[@\s\-+]/g, '')
      }

      if (!targetPhone || !/^\d{10,15}$/.test(targetPhone)) {
        await sock.sendMessage(m.chat, { 
          text: "❌ Please provide a valid phone number.\n\nUsage: `.vipunclaim 2347067023422`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return
      }

      // Convert phone to telegram ID
      const targetUser = await VIPQueries.getUserByPhone(targetPhone)

      if (!targetUser || !targetUser.telegram_id) {
        await sock.sendMessage(m.chat, { 
          text: `❌ User with phone ${targetPhone} is not registered.\n\nThey need to connect first.

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
        }, { quoted: m })
        return
      }

      const targetTelegramId = targetUser.telegram_id

      // Find current owner
      const allVIPs = await VIPQueries.getAllVIPs()
      let currentOwner = null
      
      for (const vip of allVIPs) {
        const owned = await VIPQueries.ownsUser(vip.telegram_id, targetTelegramId)
        if (owned) {
          currentOwner = vip
          break
        }
      }

      if (!currentOwner) {
        await sock.sendMessage(m.chat, { 
          text: `ℹ️ User ${targetPhone} is not currently owned by any VIP.\n\nNothing to unclaim.

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
        }, { quoted: m })
        return
      }

      // Get owner phone
      let ownerPhone = currentOwner.phone
      if (!ownerPhone) {
        try {
          const ownerUser = await VIPQueries.getUserByPhone(currentOwner.telegram_id.toString())
          ownerPhone = ownerUser?.phone_number?.split(':')[0].replace(/[^0-9]/g, '') || currentOwner.telegram_id
        } catch (err) {
          ownerPhone = VIPHelper.extractPhone(currentOwner.jid) || currentOwner.telegram_id
        }
      }

      // Force unclaim (admin override)
      await VIPQueries.unclaimUser(targetTelegramId, null)

      // Log activity
      await VIPQueries.logActivity(adminTelegramId, 'admin_unclaim', targetTelegramId, null, { 
        targetPhone,
        previousOwner: currentOwner.telegram_id 
      })

      await sock.sendMessage(m.chat, { 
        text: 
          `✅ *User Unclaimed Successfully!*\n\n` +
          `👤 User: ${targetPhone}\n` +
          `📤 Previous Owner: ${ownerPhone}\n\n` +
          `This user is now available to be claimed by any VIP.\n\n` +
          `Any VIP can now claim them with:\n` +
          `\`.vipadd ${targetPhone}\``
      }, { quoted: m })

    } catch (error) {
      console.error("[VIPUnclaim] Error:", error)
      await sock.sendMessage(m.chat, { 
        text: "❌ Error unclaiming user.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }, { quoted: m })
    }
  }
}