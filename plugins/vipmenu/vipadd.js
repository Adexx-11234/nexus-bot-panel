import { VIPQueries } from "../../database/query.js"
import { VIPHelper } from "../../whatsapp/index.js"

export default {
  name: "VIP Add",
  description: "Claim a user to control their session",
  commands: ["vipadd", "vipclaim"],
  category: "vipmenu",
  usage: "• `.vipadd <phone>` - Claim a connected user\n• `.vipadd @user` - Claim by mention",
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
      } else if (m.quoted && m.quoted.sender) {
        targetPhone = VIPHelper.extractPhone(m.quoted.sender)
      }

      if (!targetPhone || !/^\d{10,15}$/.test(targetPhone)) {
        await sock.sendMessage(m.chat, { 
          text: "❌ Please provide a valid phone number.\n\nUsage:\n• `.vipadd 2347067023422`\n• Reply to a message with `.vipadd`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }, { quoted: m })
        return
      }

      // Look up user by phone number in users table
      const targetUser = await VIPQueries.getUserByPhone(targetPhone)
      
      if (!targetUser || !targetUser.telegram_id) {
        await sock.sendMessage(m.chat, { 
          text: `❌ User with phone ${targetPhone} is not registered.\n\nThey need to connect first via Telegram.

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
        }, { quoted: m })
        return
      }

      const targetTelegramId = targetUser.telegram_id
      
      // Check if target user is connected
      const targetSock = await VIPHelper.getUserSocket(targetTelegramId)
      if (!targetSock) {
        await sock.sendMessage(m.chat, { 
          text: `❌ User ${targetPhone} (${targetUser.first_name || 'Unknown'}) is not currently connected.\n\nThey need to have an active session.

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
        }, { quoted: m })
        return
      }

      // Get target JID
      const targetJid = targetSock.user?.id

      // Ensure user exists in whatsapp_users table
await VIPQueries.ensureWhatsAppUser(targetTelegramId, targetJid, targetPhone)

      // Try to claim the user
      const claimResult = await VIPQueries.claimUser(
        vipTelegramId, 
        targetTelegramId, 
        targetPhone,
        targetJid
      )

      if (!claimResult.success) {
        if (claimResult.error === 'Already claimed by another VIP') {
          await sock.sendMessage(m.chat, { 
            text: `❌ User ${targetPhone} is already claimed by another VIP.\n\nContact the bot owner if you need this user reassigned.

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
          }, { quoted: m })
        } else {
          await sock.sendMessage(m.chat, { 
            text: `❌ Failed to claim user: ${claimResult.error}

` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` 
          }, { quoted: m })
        }
        return
      }

      // Success
      await VIPQueries.logActivity(vipTelegramId, 'claim_user', targetTelegramId, null, { targetPhone })

      await sock.sendMessage(m.chat, { 
        text: `✅ *User Claimed Successfully!*\n\n` +
              `📱 Phone: ${targetPhone}\n` +
              `👤 Name: ${targetUser.first_name || 'Unknown'}\n` +
              `🆔 Telegram ID: ${targetTelegramId}\n` +
              `📲 WhatsApp JID: ${targetJid}\n\n` +
              `You can now:\n` +
              `• View their groups: \`.vipgroups ${targetPhone}\`\n` +
              `• Takeover groups: \`.viptakeover\`\n` +
              `• Release user: \`.vipremove ${targetPhone}\``
      }, { quoted: m })

    } catch (error) {
      console.error("[VIPAdd] Error:", error)
      await sock.sendMessage(m.chat, { 
        text: "❌ An error occurred while claiming user.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }, { quoted: m })
    }
  }
}