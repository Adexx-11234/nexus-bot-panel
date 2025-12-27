import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, WarningQueries, ViolationQueries } from "../../database/query.js"

const logger = createComponentLogger("ANTI-TAG")

export default {
  name: "Anti-Tag",
  description: "Detect and prevent excessive tagging with configurable limits",
  commands: ["antitag"],
  category: "groupmenu",
  permissions: {
    adminRequired: true, // User must be group admin (only applies in groups)
    botAdminRequired: true, // Bot must be group admin (only applies in groups)
    groupOnly: true, // Can only be used in groups
  },
  usage:
    "• .antitag on/off/status\n• .antitag limit [1-20]\n• .antitag warn [0-10]\n• .antitag reset @user\n• .antitag list/stats",

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat

    try {
      switch (action) {
        case "on":
          await GroupQueries.setAntiCommand(groupJid, "antitag", true)
          const tagLimit = (await GroupQueries.getTagLimit(groupJid)) || 5
          const warnLimit = (await GroupQueries.getAntiCommandWarningLimit(groupJid, "antitag")) || 4
          return { response: `✅ Anti-tag enabled (limit: ${tagLimit} tags, ${warnLimit} warnings)` }

        case "off":
          await GroupQueries.setAntiCommand(groupJid, "antitag", false)
          return { response: "❌ Anti-tag disabled" }

        case "limit":
          if (args.length < 2) {
            const currentLimit = (await GroupQueries.getTagLimit(groupJid)) || 5
            return { response: `Current tag limit: ${currentLimit}\n\nUsage: .antitag limit [1-20]` }
          }

          const newTagLimit = Number.parseInt(args[1])
          if (isNaN(newTagLimit) || newTagLimit < 1 || newTagLimit > 20) {
            return { response: "❌ Limit must be 1-20" }
          }

          await GroupQueries.setTagLimit(groupJid, newTagLimit)
          return { response: `✅ Tag limit set to ${newTagLimit} users per message` }

        case "warn":
          if (args.length < 2) {
            const currentLimit = (await GroupQueries.getAntiCommandWarningLimit(groupJid, "antitag")) || 4
            return { response: `Current warning limit: ${currentLimit}\n\nUsage: .antitag warn [0-10]` }
          }

          const newWarnLimit = Number.parseInt(args[1])
          if (isNaN(newWarnLimit) || newWarnLimit < 0 || newWarnLimit > 10) {
            return { response: "❌ Warning limit must be 0-10 (0 = instant kick)" }
          }

          await GroupQueries.setAntiCommandWarningLimit(groupJid, "antitag", newWarnLimit)
          const actionType = newWarnLimit === 0 ? "instant removal" : `${newWarnLimit} warnings before removal`
          return { response: `✅ Anti-tag set to ${actionType}` }

        case "status":
          const status = await GroupQueries.isAntiCommandEnabled(groupJid, "antitag")
          const currentTagLimit = (await GroupQueries.getTagLimit(groupJid)) || 5
          const warningLimit = (await GroupQueries.getAntiCommandWarningLimit(groupJid, "antitag")) || 4
          const warningStats = await WarningQueries.getWarningStats(groupJid, "antitag")
          return {
            response: `🔖 Anti-Tag Status\n\nStatus: ${status ? "✅ Enabled" : "❌ Disabled"}\nTag limit: ${currentTagLimit} users\nWarning limit: ${warningLimit}\nActive warnings: ${warningStats.totalUsers} users\nTotal warnings: ${warningStats.totalWarnings}`,
          }

        case "reset":
          const targetUser = await this.extractTargetUser(m, args)
          if (!targetUser) {
            return { response: "❌ Usage: .antitag reset @user or reply to user's message" }
          }

          await WarningQueries.resetUserWarnings(groupJid, targetUser, "antitag")
          return { response: `✅ Warnings reset for @${targetUser.split("@")[0]}`, mentions: [targetUser] }

        case "list":
          const warningList = await WarningQueries.getWarningList(groupJid, "antitag")
          if (warningList.length === 0) {
            return { response: "📋 No active warnings" }
          }

          const limit = (await GroupQueries.getAntiCommandWarningLimit(groupJid, "antitag")) || 4
          let listResponse = "📋 Active Anti-Tag Warnings\n\n"
          warningList.forEach((warn, index) => {
            const userNumber = warn.user_jid.split("@")[0]
            listResponse += `${index + 1}. @${userNumber} - ${warn.warning_count}/${limit}\n`
          })

          return { response: listResponse, mentions: warningList.map((w) => w.user_jid) }

        case "stats":
          const violationStats = await ViolationQueries.getViolationStats(groupJid, "antitag", 7)
          const weekStats = violationStats[0] || { unique_violators: 0, warnings: 0, kicks: 0 }
          return {
            response: `📊 Anti-Tag Stats (7 days)\n\n👥 Users warned: ${weekStats.unique_violators}\n⚠️ Warnings: ${weekStats.warnings}\n🚪 Kicks: ${weekStats.kicks}`,
          }

        default:
          const currentStatus = await GroupQueries.isAntiCommandEnabled(groupJid, "antitag")
          const currentLimit = (await GroupQueries.getTagLimit(groupJid)) || 5
          const currentWarnLimit = (await GroupQueries.getAntiCommandWarningLimit(groupJid, "antitag")) || 4
          return {
            response: `🔖 Anti-Tag Commands\n\n• .antitag on - Enable\n• .antitag off - Disable\n• .antitag limit [1-20] - Set tag limit\n• .antitag warn [0-10] - Set warning limit\n• .antitag status - Check status\n• .antitag reset @user - Reset warnings\n• .antitag list - Show warnings\n• .antitag stats - Statistics\n\nStatus: ${currentStatus ? "✅ Enabled" : "❌ Disabled"}\nTag limit: ${currentLimit}\nWarning limit: ${currentWarnLimit}`,
          }
      }
    } catch (error) {
      logger.error("Error in antitag command:", error)
      return { response: "❌ Error managing anti-tag settings" }
    }
  },

  async extractTargetUser(m, args) {
    const contextInfo = m.message?.message?.extendedTextMessage?.contextInfo
    if (contextInfo?.mentionedJid && contextInfo.mentionedJid.length > 0) {
      return contextInfo.mentionedJid[0]
    }
    if (contextInfo?.quotedMessage && contextInfo.participant) {
      return contextInfo.participant
    }
    if (m.quoted && m.quoted.sender) {
      return m.quoted.sender
    }
    return null
  },

  async isEnabled(groupJid) {
    try {
      return await GroupQueries.isAntiCommandEnabled(groupJid, "antitag")
    } catch (error) {
      logger.error("Error checking if antitag enabled:", error)
      return false
    }
  },

  async shouldProcess(m) {
    if (!m.isGroup || !m.text) return false
    if (m.isCommand) return false
    if (m.key?.fromMe) return false
    return this.countMentions(m) > 0
  },

  async processMessage(sock, sessionId, m) {
    try {
      await this.handleTagDetection(sock, sessionId, m)
    } catch (error) {
      logger.error("Error processing antitag message:", error)
    }
  },

  async handleTagDetection(sock, sessionId, m) {
    try {
      const groupJid = m.chat

      if (!groupJid) return

      const mentionCount = this.countMentions(m)
      const tagLimit = (await GroupQueries.getTagLimit(groupJid)) || 5

      if (mentionCount <= tagLimit) return

      const warningLimit = (await GroupQueries.getAntiCommandWarningLimit(groupJid, "antitag")) || 4

      // Delete message first
      try {
        await sock.sendMessage(groupJid, { delete: m.key })
        m._wasDeletedByAntiPlugin = true
      } catch (error) {
        logger.error("Failed to delete message:", error)
        m._wasDeletedByAntiPlugin = true
      }

      // Handle instant kick (limit = 0)
      if (warningLimit === 0) {
        await sock.groupParticipantsUpdate(groupJid, [m.sender], "remove")
        await sock.sendMessage(groupJid, {
          text: `🔖 Excessive tagging (${mentionCount} users) - @${m.sender.split("@")[0]} removed (instant kick mode)`,
          mentions: [m.sender],
        })

        await ViolationQueries.logViolation(
          groupJid,
          m.sender,
          "antitag",
          m.text,
          { mentionCount },
          "kick",
          0,
          m.key.id,
        )
        return
      }

      // Handle warnings
      const warnings = await WarningQueries.addWarning(
        groupJid,
        m.sender,
        "antitag",
        `Excessive tagging (${mentionCount} users)`,
      )

      const response = `🔖 Excessive tagging detected!\n\n👤 @${m.sender.split("@")[0]}\n🔖 Tagged ${mentionCount} users (limit: ${tagLimit})\n⚠️ Warning: ${warnings}/${warningLimit}`

      if (warnings >= warningLimit) {
        try {
          await sock.groupParticipantsUpdate(groupJid, [m.sender], "remove")
          await WarningQueries.resetUserWarnings(groupJid, m.sender, "antitag")
        } catch (error) {
          logger.error("Failed to remove user:", error)
        }
      }

      await sock.sendMessage(groupJid, {
        text: response,
        mentions: [m.sender],
      })

      await ViolationQueries.logViolation(
        groupJid,
        m.sender,
        "antitag",
        m.text,
        { mentionCount },
        warnings >= warningLimit ? "kick" : "warning",
        warnings,
        m.key.id,
      )
    } catch (error) {
      logger.error("Error handling tag detection:", error)
    }
  },

  countMentions(m) {
    if (!m.message) return 0

    if (m.message.extendedTextMessage?.contextInfo?.mentionedJid) {
      return m.message.extendedTextMessage.contextInfo.mentionedJid.length
    }

    const text = m.text || ""
    const mentionMatches = text.match(/@\d+/g) || []
    return mentionMatches.length
  },
}
