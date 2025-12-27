import { createComponentLogger } from "../../utils/logger.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("SETGROUPBIO")

export default {
  name: "Set Group Description",
  description: "Change the group's description/bio",
  commands: ["setgroupbio", "setdesc", "setdescription"],
  category: "group",
  permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage: "• `.setgroupbio <new description>` - Change the group description\n• `.setgroupbio clear` - Clear the group description",

  /**
   * Main command execution
   */
  async execute(sock, sessionId, args, m) {
    try {
      const groupJid = m.chat

      // Get new description
      const newDescription = args.join(" ").trim()
      
      if (!newDescription) {
        await sock.sendMessage(groupJid, {
          text: "❌ Please provide a new description for the group!\n\n" +
                "Usage:\n" +
                "• `.setgroupbio <new description>`\n" +
                "• `.setgroupbio clear` - Clear description\n\n" +
                "Example:\n" +
                "• `.setgroupbio Welcome to our awesome community!`\n" +
                "• `.setgroupbio Rules: Be respectful and have fun!`\n\n" +
                "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Handle clear command
      if (newDescription.toLowerCase() === 'clear') {
        await this.updateGroupDescription(sock, groupJid, "", m, true)
        return
      }

      // Validate description length (WhatsApp limit is 512 characters)
      if (newDescription.length > 512) {
        await sock.sendMessage(groupJid, {
          text: `❌ Group description is too long! (${newDescription.length}/512 characters)\n\n` +
                "WhatsApp groups have a 512 character limit for descriptions.\n\n" +
                "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Update group description
      await this.updateGroupDescription(sock, groupJid, newDescription, m, false)

    } catch (error) {
      logger.error("Error executing setgroupbio command:", error)
      await sock.sendMessage(m.chat, {
        text: "❌ Error setting group description. Make sure:\n" +
              "• Bot is a group admin\n" +
              "• Description is valid\n" +
              "• Description is under 512 characters\n\n" +
              "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  },


  // ===================
  // DESCRIPTION UPDATE
  // ===================

  /**
   * Update group description
   */
  async updateGroupDescription(sock, groupJid, newDescription, m, isClearing) {
    try {
      // Get current description for reference
      const groupMetadata = await sock.groupMetadata(groupJid)
      const oldDescription = groupMetadata.desc || "(No description)"

      // Update the group description
      await sock.groupUpdateDescription(groupJid, newDescription)

      // Build success message
      let message
      if (isClearing) {
        message = `✅ Group description cleared successfully!\n\n` +
                  `📝 Previous Description:\n${oldDescription}\n\n` +
                  `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      } else {
        const preview = newDescription.length > 100 
          ? newDescription.substring(0, 97) + "..." 
          : newDescription
        
        message = `✅ Group description updated successfully!\n\n` +
                  `📝 New Description:\n${preview}\n\n` +
                  `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }

      // Send success message
      await sock.sendMessage(groupJid, {
        text: message
      }, { quoted: m })

      logger.info(`Group description updated for ${groupJid}`)

    } catch (error) {
      logger.error("Error updating group description:", error)
      throw error
    }
  }
}