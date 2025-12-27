import { createComponentLogger } from "../../utils/logger.js"
const logger = createComponentLogger("SETGROUPNAME")

export default {
  name: "Set Group Name",
  description: "Change the group's name/subject",
  commands: ["setgroupname", "setname", "setsubject", "setgcname"],
  category: "groupmenu",
  permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage: "• `.setgroupname <new name>` - Change the group name",

  /**
   * Main command execution
   */
  async execute(sock, sessionId, args, m) {
    try {
      const groupJid = m.chat

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