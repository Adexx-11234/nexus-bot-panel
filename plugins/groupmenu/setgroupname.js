import { createComponentLogger } from "../../utils/logger.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("SETGROUPNAME")

export default {
  name: "Set Group Name",
  description: "Change the group's name/subject",
  commands: ["setgroupname", "setname", "setsubject", "setgcname"],
  category: "group",
  adminOnly: true,
  usage: "• `.setgroupname <new name>` - Change the group name",

  /**
   * Main command execution
   */
  async execute(sock, sessionId, args, m) {
    try {
      const groupJid = m.chat

      // Ensure this is a group
      if (!this.isGroupMessage(m)) {
        await sock.sendMessage(groupJid, {
          text: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Check admin permissions
      if (!(await this.checkAdminPermission(sock, groupJid, m.sender, m))) return

      // Check if bot has admin permissions
      if (!(await this.checkBotAdminPermission(sock, groupJid, m))) return

      // Validate new name
      const newName = args.join(" ").trim()
      
      if (!newName) {
        await sock.sendMessage(groupJid, {
          text: "❌ Please provide a new name for the group!\n\n" +
                "Usage: `.setgroupname <new name>`\n\n" +
                "Example:\n" +
                "• `.setgroupname Cool Squad`\n" +
                "• `.setgroupname Team Alpha 2024`\n\n" +
                "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Validate name length (WhatsApp limit is 25 characters)
      if (newName.length > 25) {
        await sock.sendMessage(groupJid, {
          text: `❌ Group name is too long! (${newName.length}/25 characters)\n\n` +
                "WhatsApp groups have a 25 character limit.\n\n" +
                "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Update group name
      await this.updateGroupName(sock, groupJid, newName, m)

    } catch (error) {
      logger.error("Error executing setgroupname command:", error)
      await sock.sendMessage(m.chat, {
        text: "❌ Error setting group name. Make sure:\n" +
              "• Bot is a group admin\n" +
              "• New name is valid\n" +
              "• Name is under 25 characters\n\n" +
              "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  },

  // ===================
  // VALIDATION METHODS
  // ===================

  /**
   * Check if message is from a group
   */
  isGroupMessage(m) {
    return m?.isGroup === true || (m?.chat && m.chat.endsWith('@g.us'))
  },

  /**
   * Check if user is admin
   */
  async isUserAdmin(sock, groupJid, userJid) {
    try {
      const adminChecker = new AdminChecker()
      return await adminChecker.isGroupAdmin(sock, groupJid, userJid)
    } catch (error) {
      logger.error("Error checking user admin status:", error)
      return false
    }
  },

  /**
   * Check admin permission for command execution
   */
  async checkAdminPermission(sock, groupJid, userJid, m) {
    const isAdmin = await this.isUserAdmin(sock, groupJid, userJid)
    if (!isAdmin) {
      await sock.sendMessage(groupJid, {
        text: "❌ Only group admins can use this command!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
      return false
    }
    return true
  },

  /**
   * Check if bot has admin permissions
   */
  async checkBotAdminPermission(sock, groupJid, m) {
    try {
      const adminChecker = new AdminChecker()
      const botIsAdmin = await adminChecker.isBotAdmin(sock, groupJid)
      
      if (!botIsAdmin) {
        await sock.sendMessage(groupJid, {
          text: "❌ Bot needs to be a group admin to change the group name!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return false
      }
      return true
    } catch (error) {
      logger.error("Error checking bot admin permission:", error)
      return false
    }
  },

  // ===================
  // GROUP NAME UPDATE
  // ===================

  /**
   * Update group name/subject
   */
  async updateGroupName(sock, groupJid, newName, m) {
    try {
      // Get current name for reference
      const groupMetadata = await sock.groupMetadata(groupJid)
      const oldName = groupMetadata.subject

      // Update the group name
      await sock.groupUpdateSubject(groupJid, newName)

      // Send success message
      await sock.sendMessage(groupJid, {
        text: `✅ Group name updated successfully!\n\n` +
              `📝 Old Name: ${oldName}\n` +
              `📝 New Name: ${newName}\n\n` +
              `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      logger.info(`Group name updated for ${groupJid}: "${oldName}" → "${newName}"`)

    } catch (error) {
      logger.error("Error updating group name:", error)
      throw error
    }
  }
}