import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries } from "../../database/query.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"
import { downloadMediaMessage } from "@nexustechpro/baileys"

const logger = createComponentLogger("SETGROUPPP")

export default {
  name: "Set Group Profile Picture",
  description: "Change the group's profile picture",
  commands: ["setgrouppp", "setpp", "setgroupicon", "setgcpp"],
  category: "group",
  adminOnly: true,
  usage: "• Reply to an image with `.setgrouppp` - Set that image as group profile picture\n• `.setgrouppp` with attached image - Set attached image as group profile picture",

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
          text: "❌ Bot needs to be a group admin to change the profile picture!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
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