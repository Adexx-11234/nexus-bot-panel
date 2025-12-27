import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("GROUP-LINK")

export default {
  name: "Group-Link",
  description: "Get or reset group invite link",
  commands: ["grouplink", "link", "gc", "gclink"],
  category: "group",
    permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage: "• `.grouplink` - Get group invite link\n• `.grouplink reset` - Reset group invite link\n• `.grouplink info` - Show detailed group info",

  /**
   * Main command execution
   */
  async execute(sock, sessionId, args, m) {
    try {
      // Validate inputs
      if (!this.validateCommandInputs(sock, m)) return

      const action = args[0]?.toLowerCase()
      const groupJid = m.chat

      // Handle command actions
      switch (action) {
        case "reset":
        case "revoke":
          await this.resetGroupLink(sock, groupJid, m)
          break
        case "info":
          await this.showLinkInfo(sock, groupJid, m)
          break
        default:
          await this.sendGroupLink(sock, groupJid, m)
          break
      }
    } catch (error) {
      logger.error("Error executing grouplink command:", error)
      await this.sendErrorMessage(sock, m.chat, m)
    }
  },

  // ===================
  // VALIDATION METHODS
  // ===================

  /**
   * Validate command execution inputs
   */
  validateCommandInputs(sock, m) {
    if (!sock || !m || !m.chat || !m.sender) {
      logger.warn("Invalid command inputs provided")
      return false
    }
    return true
  },


  // ===================
  // PERMISSION METHODS
  // ===================


  // ===================
  // MAIN FUNCTIONALITY
  // ===================

  /**
   * Get and send group invite link with mentions
   */
  async sendGroupLink(sock, groupJid, m) {
    try {
      // Get group metadata
      const groupMetadata = await sock.groupMetadata(groupJid)
      
      // Get invite code
      const inviteCode = await sock.groupInviteCode(groupJid)
      const inviteLink = `https://chat.whatsapp.com/${inviteCode}`

      // Get group info
      const groupName = groupMetadata.subject || "Unknown Group"
      const groupOwner = groupMetadata.owner || groupMetadata.creator || "Unknown"
      const participantCount = groupMetadata.participants?.length || 0
      const participants = groupMetadata.participants.map(p => p.id)

      // Format owner number for display
      const ownerNumber = groupOwner.split("@")[0]
      const formattedOwner = this.formatPhoneNumber(ownerNumber)

      // Get group description if available
      const description = groupMetadata.desc || "No description"
      const descriptionPreview = description.length > 50 
        ? description.substring(0, 50) + "..." 
        : description

      // Build response message
      const response = 
        `╔═══════════════════╗\n` +
        `║   📎 GROUP INVITE LINK   ║\n` +
        `╚═══════════════════╝\n\n` +
        `🏷️ Group: ${groupName}\n` +
        `👤 Created by: ${formattedOwner}\n` +
        `👥 Members: ${participantCount}\n` +
        `📝 About: ${descriptionPreview}\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `${inviteLink}\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        `💡 Keep this private! Only share with trusted people.\n` +
        `🔄 Use \`.grouplink reset\` to generate a new link`

      // Send the message with mentions
      await sock.sendMessage(groupJid, {
        text: response,
        mentions: participants
      }, { quoted: m })

      logger.info(`Group link retrieved for: ${groupName} (${groupJid})`)

    } catch (error) {
      logger.error("Error retrieving group link:", error)
      
      // Send user-friendly error message
      await sock.sendMessage(groupJid, {
        text: "❌ Failed to retrieve group link. Please ensure:\n" +
              "• Bot has admin permissions\n" +
              "• Group settings allow link retrieval" + `

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })
    }
  },

  /**
   * Reset/revoke group invite link
   */
  async resetGroupLink(sock, groupJid, m) {
    try {
      // Get group metadata for mentions
      const groupMetadata = await sock.groupMetadata(groupJid)
      const participants = groupMetadata.participants.map(p => p.id)

      // Revoke old link and get new one
      const newInviteCode = await sock.groupRevokeInvite(groupJid)
      const newLink = `https://chat.whatsapp.com/${newInviteCode}`

      // Build response message
      const response = 
        `╔═══════════════════╗\n` +
        `║   🔄 LINK RESET SUCCESS   ║\n` +
        `╚═══════════════════╝\n\n` +
        `✅ New invite link generated!\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `${newLink}\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        `⚠️ *Important:*\n` +
        `• Previous link is now invalid\n` +
        `• Anyone using old link cannot join\n` +
        `• Share new link carefully\n\n` +
        `📊 All ${participants.length} members notified`

      // Send with mentions
      await sock.sendMessage(groupJid, {
        text: response,
        mentions: participants
      }, { quoted: m })

      logger.info(`Group link reset for: ${groupJid}`)

    } catch (error) {
      logger.error("Error resetting group link:", error)
      
      await sock.sendMessage(groupJid, {
        text: "❌ Failed to reset group link. Ensure bot has admin permissions.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  },

  /**
   * Show detailed link information
   */
  async showLinkInfo(sock, groupJid, m) {
    try {
      // Get group metadata
      const groupMetadata = await sock.groupMetadata(groupJid)
      const inviteCode = await sock.groupInviteCode(groupJid)
      const inviteLink = `https://chat.whatsapp.com/${inviteCode}`

      const groupName = groupMetadata.subject || "Unknown Group"
      const creationDate = groupMetadata.creation 
        ? new Date(groupMetadata.creation * 1000).toLocaleDateString() 
        : "Unknown"
      const participantCount = groupMetadata.participants?.length || 0
      const adminCount = groupMetadata.participants?.filter(p => p.admin).length || 0

      // Build info message
      const response = 
        `╔═══════════════════╗\n` +
        `║   📊 GROUP INFO   ║\n` +
        `╚═══════════════════╝\n\n` +
        `🏷️ *Name:* ${groupName}\n` +
        `📅 *Created:* ${creationDate}\n` +
        `👥 *Members:* ${participantCount}\n` +
        `👑 *Admins:* ${adminCount}\n\n` +
        `🔗 *Current Invite Link:*\n` +
        `${inviteLink}\n\n` +
        `*Available Commands:*\n` +
        `• \`.grouplink\` - Get link (mentions all)\n` +
        `• \`.grouplink reset\` - Generate new link\n` +
        `• \`.grouplink info\` - Show this info`

      await sock.sendMessage(groupJid, {
        text: response
      }, { quoted: m })

    } catch (error) {
      logger.error("Error showing link info:", error)
      await this.sendErrorMessage(sock, groupJid, m)
    }
  },

  /**
   * Format phone number for display
   */
  formatPhoneNumber(number) {
    if (!number) return "Unknown"
    
    // Add + prefix and format with ... for privacy
    if (number.length > 8) {
      return `+${number.substring(0, number.length - 3)}...`
    }
    return `+${number}`
  },

  /**
   * Send error message
   */
  async sendErrorMessage(sock, groupJid, m) {
    try {
      await sock.sendMessage(groupJid, {
        text: "❌ Error managing group link. Please try again later.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    } catch (error) {
      logger.error("Failed to send error message:", error)
    }
  }
}