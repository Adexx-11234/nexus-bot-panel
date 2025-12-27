import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("TAG-ADMIN")

export default {
  name: "Tag Admin",
  description: "Mention all group admins",
  commands: ["tagadmin", "admins", "admin"],
  category: "group",
        permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage: "• `.tagadmin` - Mention all group admins",

  async execute(sock, sessionId, args, m) {
    const groupJid = m.chat

    try {
      // Get group metadata
      const metadata = await sock.groupMetadata(groupJid)
      const admins = metadata.participants.filter(p => 
        p.admin === 'admin' || p.admin === 'superadmin'
      )

      if (admins.length === 0) {
        await sock.sendMessage(groupJid, {
          text: "❌ No admins found in this group.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Create mention message
      let message = `👑 *Group Admins* 👑\n\n`
      admins.forEach((admin, index) => {
        const phoneNumber = admin.jid.split('@')[0]
        message += `${index + 1}. @${phoneNumber}\n`
      })

      message += `\n💡 Total: ${admins.length} admin(s)`

      // Send message with mentions
      await sock.sendMessage(groupJid, {
        text: message,
        mentions: admins.map(admin => admin.jid)
      }, { quoted: m })

    } catch (error) {
      logger.error("Error in tagadmin command:", error)
      await sock.sendMessage(groupJid, {
        text: "❌ Error fetching admin list.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  }
}