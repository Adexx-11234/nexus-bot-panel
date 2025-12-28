import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, WarningQueries, ViolationQueries } from "../../database/query.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("WARN")

export default {
  name: "warn",
  aliases: ["warning", "warnuser"],
  category: "groupmenu",
  description: "Warn a group member (configurable warnings = kick)",
  usage: "warn <number> or reply to user",
  adminOnly: true,

  async execute(sock, sessionId, args, m) {
    if (!m.isGroup) {
      await sock.sendMessage(m.chat, {
        text: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
      return
    }

    const adminChecker = new AdminChecker()
    const isAdmin = await adminChecker.isGroupAdmin(sock, m.chat, m.sender)
    
    if (!isAdmin) {
      await sock.sendMessage(m.chat, {
        text: "❌ Only group admins can use this command!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
      return
    }

    const isBotAdmin = await adminChecker.isBotAdmin(sock, m.chat)
    if (!isBotAdmin) {
      await sock.sendMessage(m.chat, {
        text: "❌ Bot needs to be admin to warn members!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
      return
    }

    // Extract target user
    let targetNumber = await this.extractTargetUser(m, args)
    
    if (!targetNumber) {
      await sock.sendMessage(m.chat, {
        text: "❌ Please provide a number or reply to a user!\n\nExample: `.warn 1234567890`\nor reply to a message with `.warn`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
      return
    }

    try {
      // Get warning limit for this group (default 4)
      const warningLimit = await GroupQueries.getGroupSettings(m.chat)
        .then(settings => settings?.warning_limit || 4)
        .catch(() => 4)

      // Check if target is admin
      const targetIsAdmin = await adminChecker.isGroupAdmin(sock, m.chat, targetNumber)
      if (targetIsAdmin) {
        await sock.sendMessage(m.chat, {
          text: "❌ Cannot warn group admins!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Add warning to database
      const newWarnings = await WarningQueries.addWarning(
        m.chat,
        targetNumber,
        "manual",
        args.slice(1).join(" ") || "Manual warning by admin"
      )

      const userNumber = targetNumber.split("@")[0]

      if (newWarnings >= warningLimit) {
        // Kick user after reaching warning limit
        try {
          await sock.groupParticipantsUpdate(m.chat, [targetNumber], "remove")
          
          // Reset warnings after kick
          await WarningQueries.resetUserWarnings(m.chat, targetNumber, "manual")

          await sock.sendMessage(m.chat, {
            text: `🚫 @${userNumber} has been removed from the group!\n\n` +
                  `Reason: Reached ${warningLimit} warnings\n\n` +
                  `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            mentions: [targetNumber]
          })

          // Log violation
          await ViolationQueries.logViolation(
            m.chat,
            targetNumber,
            "manual",
            "Reached warning limit",
            { warnings: newWarnings, limit: warningLimit },
            "kick",
            newWarnings,
            m.key.id
          )
        } catch (kickError) {
          logger.error("Failed to kick user:", kickError)
          await sock.sendMessage(m.chat, {
            text: `❌ Failed to remove user from group!\n\n` +
                  `@${userNumber} has ${newWarnings}/${warningLimit} warnings\n\n` +
                  `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            mentions: [targetNumber]
          })
        }
      } else {
        // Send warning notification
        await sock.sendMessage(m.chat, {
          text: `⚠️ Warning issued to @${userNumber}\n\n` +
                `Warnings: ${newWarnings}/${warningLimit}\n` +
                `Reason: ${args.slice(1).join(" ") || "Violating group rules"}\n\n` +
                `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          mentions: [targetNumber]
        })

        // Log violation
        await ViolationQueries.logViolation(
          m.chat,
          targetNumber,
          "manual",
          args.slice(1).join(" ") || "Manual warning",
          { warnings: newWarnings, limit: warningLimit },
          "warning",
          newWarnings,
          m.key.id
        )
      }
    } catch (error) {
      logger.error("Error in warn command:", error)
      await sock.sendMessage(m.chat, {
        text: "❌ Failed to warn user! Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
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