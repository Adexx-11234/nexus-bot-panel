import { createComponentLogger } from "../../utils/logger.js"
import { WarningQueries } from "../../database/query.js"

const logger = createComponentLogger("UNWARN")

export default {
  name: "unwarn",
  aliases: ["delwarn", "removewarn", "clearwarn"],
  category: "groupmenu",
  description: "Remove warnings from a user",
  usage: "unwarn <number> or reply to user",
 permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},

  async execute(sock, sessionId, args, m) {

    // Extract target user
    let targetNumber = await this.extractTargetUser(m, args)
    
    if (!targetNumber) {
      await sock.sendMessage(m.chat, {
        text: "❌ Please provide a number or reply to a user!\n\nExample: `.unwarn 1234567890`\nor reply to a message with `.unwarn`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
      return
    }

    try {
      // Get current warning count before resetting
      const currentWarnings = await WarningQueries.getWarningCount(m.chat, targetNumber, "manual")
      
      // Reset all manual warnings for this user
      const resetCount = await WarningQueries.resetUserWarnings(m.chat, targetNumber, "manual")
      
      const userNumber = targetNumber.split("@")[0]

      if (resetCount > 0 || currentWarnings > 0) {
        await sock.sendMessage(m.chat, {
          text: `✅ Successfully removed all warnings from @${userNumber}!\n\n` +
                `Previous warnings: ${currentWarnings}\n\n` +
                `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          mentions: [targetNumber]
        })
      } else {
        await sock.sendMessage(m.chat, {
          text: `ℹ️ @${userNumber} has no warnings to remove.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          mentions: [targetNumber]
        })
      }
    } catch (error) {
      logger.error("Error in unwarn command:", error)
      await sock.sendMessage(m.chat, {
        text: "❌ Failed to remove warnings! Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  },

  // Helper function to extract target user from mentions or replies
  async extractTargetUser(m, args) {
    // Method 1: Check for mentions in the message
    const contextInfo = m.message?.extendedTextMessage?.contextInfo
    if (contextInfo?.mentionedJid && contextInfo.mentionedJid.length > 0) {
      return contextInfo.mentionedJid[0]
    }

    // Method 2: Check if it's a reply to someone's message
    if (contextInfo?.quotedMessage && contextInfo.participant) {
      return contextInfo.participant
    }

    // Method 3: Check for mentions in different message types
    const messageContent = m.message
    if (messageContent) {
      // Check in conversation (regular text)
      if (messageContent.conversation && contextInfo?.mentionedJid) {
        return contextInfo.mentionedJid[0]
      }
      
      // Check in extended text message
      if (messageContent.extendedTextMessage?.contextInfo?.mentionedJid) {
        return messageContent.extendedTextMessage.contextInfo.mentionedJid[0]
      }
    }

    // Method 4: Try to extract from raw message structure
    if (m.mentionedJid && m.mentionedJid.length > 0) {
      return m.mentionedJid[0]
    }

    // Method 5: Check if user provided a phone number manually
    if (args.length > 0) {
      const phoneArg = args[0].replace(/[@\s\-+]/g, '')
      if (/^\d{10,15}$/.test(phoneArg)) {
        return `${phoneArg}@s.whatsapp.net`
      }
    }

    // Method 6: Check if replying to a message (alternative approach)
    if (m.quoted && m.quoted.sender) {
      return m.quoted.sender
    }

    return null
  }
}