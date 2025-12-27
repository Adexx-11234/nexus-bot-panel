import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, WarningQueries, ViolationQueries } from "../../database/query.js"

const logger = createComponentLogger("WARN")

export default {
  name: "warn",
  aliases: ["warning", "warnuser"],
  category: "groupmenu",
  description: "Warn a group member (configurable warnings = kick)",
  usage: "warn <number> or reply to user",
  permissions: {
    adminRequired: true,
    botAdminRequired: true,
    groupOnly: true,
  },

  async execute(sock, sessionId, args, m) {
    let targetNumber = await this.extractTargetUser(m, args)
    
    if (!targetNumber) {
      return { response: "❌ Please provide a number or reply to a user!\n\nExample: .warn 1234567890 or reply to a message" }
    }

    try {
      // Get manual warning limit for this group
      const warningLimit = await GroupQueries.getAntiCommandWarningLimit(m.chat, "manual")

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
          await WarningQueries.resetUserWarnings(m.chat, targetNumber, "manual")

          await sock.sendMessage(m.chat, {
            text: `🚫 @${userNumber} removed!\n\nReason: Reached ${warningLimit} warnings`,
            mentions: [targetNumber]
          })

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
          return { 
            response: `❌ Failed to remove user!\n\n@${userNumber} has ${newWarnings}/${warningLimit} warnings`,
            mentions: [targetNumber]
          }
        }
      } else {
        await sock.sendMessage(m.chat, {
          text: `⚠️ Warning issued to @${userNumber}\n\nWarnings: ${newWarnings}/${warningLimit}\nReason: ${args.slice(1).join(" ") || "Violating group rules"}`,
          mentions: [targetNumber]
        })

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
      return { response: "❌ Failed to warn user! Please try again." }
    }
  },

  async extractTargetUser(m, args) {
    const contextInfo = m.message?.extendedTextMessage?.contextInfo
    if (contextInfo?.mentionedJid && contextInfo.mentionedJid.length > 0) {
      return contextInfo.mentionedJid[0]
    }
    if (contextInfo?.quotedMessage && contextInfo.participant) {
      return contextInfo.participant
    }
    if (m.quoted && m.quoted.sender) {
      return m.quoted.sender
    }
    if (args.length > 0) {
      const phoneArg = args[0].replace(/[@\s\-+]/g, '')
      if (/^\d{10,15}$/.test(phoneArg)) {
        return `${phoneArg}@s.whatsapp.net`
      }
    }
    return null
  }
}