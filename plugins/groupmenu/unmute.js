import { createComponentLogger } from "../../utils/logger.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("OPEN-GROUP")

export default {
  name: "Open Group",
  description: "Reopen group immediately so all members can send messages",
  commands: ["open", "unmute"],
  category: "groupmenu",
        permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage: "• `.open` - Open group immediately (all members can send messages)",

  async execute(sock, sessionId, args, m) {
    const groupJid = m.chat

    try {
      // Set group to all-member mode
      await sock.groupSettingUpdate(groupJid, "not_announcement")

      await sock.sendMessage(groupJid, {
        text: "🔓 *Group Opened!*\n\nAll members can now send messages.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })

    } catch (error) {
      logger.error("Error opening group:", error)
      await sock.sendMessage(groupJid, {
        text: "❌ Error opening group. Make sure bot is admin.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  }
}