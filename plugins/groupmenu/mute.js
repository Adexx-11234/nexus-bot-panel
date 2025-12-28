import { createComponentLogger } from "../../utils/logger.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("CLOSE-GROUP")

export default {
  name: "Close Group",
  description: "Set group to admin-only mode immediately",
  commands: ["close", "mute"],
  category: "group",
  adminOnly: true,
  usage: "• `.close` - Close group immediately (only admins can send messages)",

  async execute(sock, sessionId, args, m) {
    const groupJid = m.chat

    if (!m.isGroup) {
      await sock.sendMessage(groupJid, {
        text: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
      return
    }

    try {
      const adminChecker = new AdminChecker()
      const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)

      if (!isAdmin) {
        await sock.sendMessage(groupJid, {
          text: "❌ Only admins can use this command!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

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