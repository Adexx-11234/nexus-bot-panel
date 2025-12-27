import { createComponentLogger } from "../../utils/logger.js"
import { downloadMediaMessage } from "@whiskeysockets/baileys"

const logger = createComponentLogger("SETGROUPPP")

export default {
  name: "Set Group Profile Picture",
  description: "Change the group's profile picture",
  commands: ["setgrouppp", "setpp", "setgroupicon", "setgcpp"],
  category: "groupmenu",
  permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage: "• Reply to an image with `.setgrouppp` - Set that image as group profile picture\n• `.setgrouppp` with attached image - Set attached image as group profile picture",

  /**
   * Main command execution
   */
  async execute(sock, sessionId, args, m) {
    try {
      const groupJid = m.chat
      // Get image buffer from message or quoted message
      const imageBuffer = await this.getImageBuffer(sock, m)

      if (!imageBuffer) {
        await sock.sendMessage(groupJid, {
          text: "❌ Please reply to an image or send an image with this command!\n\n" +
                "Usage:\n" +
                "• Reply to an image with `.setgrouppp`\n" +
                "• Send an image with caption `.setgrouppp`\n\n" +
                "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Update group profile picture
      await this.updateGroupPicture(sock, groupJid, imageBuffer, m)

    } catch (error) {
      logger.error("Error executing setgrouppp command:", error)
      await sock.sendMessage(m.chat, {
        text: "❌ Error setting group profile picture. Make sure:\n" +
              "• Bot is a group admin\n" +
              "• Image is valid (JPG/PNG)\n" +
              "• Image size is reasonable\n\n" +
              "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  },

  // ===================
  // IMAGE PROCESSING
  // ===================

  /**
   * Get image buffer from message or quoted message
   */
  async getImageBuffer(sock, m) {
    try {
      // Check if current message has image
      if (m.message?.imageMessage) {
        return await downloadMediaMessage(m, "buffer", {})
      }

      // Check quoted message for image
      const quotedMsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage
      if (quotedMsg?.imageMessage) {
        const quotedM = {
          message: quotedMsg,
          key: m.message.extendedTextMessage.contextInfo.stanzaId || m.key
        }
        return await downloadMediaMessage(quotedM, "buffer", {})
      }

      return null
    } catch (error) {
      logger.error("Error getting image buffer:", error)
      return null
    }
  },

  /**
   * Update group profile picture
   */
  async updateGroupPicture(sock, groupJid, imageBuffer, m) {
    try {
      // Send processing message
      const processingMsg = await sock.sendMessage(groupJid, {
        text: "⏳ Updating group profile picture...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })

      // Update the profile picture
      await sock.updateProfilePicture(groupJid, imageBuffer)

      // Send success message
      await sock.sendMessage(groupJid, {
        text: "✅ Group profile picture updated successfully!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        edit: processingMsg.key
      })

      logger.info(`Group profile picture updated for ${groupJid}`)
    } catch (error) {
      logger.error("Error updating group picture:", error)
      throw error
    }
  }
}