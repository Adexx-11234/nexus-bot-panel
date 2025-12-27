import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("CLOSE-GROUP")

export default {
  name: "Close Group",
  description: "Set group to admin-only mode immediately",
  commands: ["close", "mute"],
  category: "group",
        permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage: "• `.close` - Close group immediately (only admins can send messages)",

  async execute(sock, sessionId, args, m) {
    const groupJid = m.chat


    try {


      // Set group to admin-only mode
      await sock.groupSettingUpdate(groupJid, 'announcement')
      
      await sock.sendMessage(groupJid, {
        text: `🔒 *Group Closed!*\n\n` +
              `Only admins can send messages.\n` +
              `Use .open to reopen the group.\n\n` +
              `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

    } catch (error) {
      logger.error("Error closing group:", error)
      await sock.sendMessage(groupJid, {
        text: "❌ Error closing group. Make sure bot is admin.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  }
}