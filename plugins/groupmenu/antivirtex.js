import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, WarningQueries, ViolationQueries } from "../../database/query.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"
import { analyzeMessage } from "guaranteed_security"

const logger = createComponentLogger("ANTI-VIRTEX")

export default {
  name: "Anti-Virtex",
  description: "Detect and remove malicious messages with warning system",
  commands: ["antivirtex"],
  category: "group", 
  adminOnly: true,
  usage:
    "• `.antivirtex on/off` - Toggle protection\n" +
    "• `.antivirtex status` - Check status\n" +
    "• `.antivirtex warn [1-5]` - Set warning limit\n" +
    "• `.antivirtex reset @user` - Reset warnings\n" +
    "• `.antivirtex list` - Show warnings",

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat

    if (!m.isGroup) {
      return await this.sendMessage(sock, groupJid, "❌ This command can only be used in groups!", m)
    }

    // Admin check
    const adminChecker = new AdminChecker()
    const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
    if (!isAdmin) {
      return await this.sendMessage(sock, groupJid, "❌ Only group admins can use this command!", m)
    }

    try {
      switch (action) {
        case "on":
          await GroupQueries.setAntiCommand(groupJid, "antivirtex", true)
          await this.ensureWarningLimit(groupJid)
          return await this.sendMessage(sock, groupJid, 
            "🛡️ *Anti-Virtex Protection Enabled!*\n\n" +
            "✅ Malicious messages will be detected and removed\n" +
            "👑 Admins are exempt from restrictions", m)

        case "off":
          await GroupQueries.setAntiCommand(groupJid, "antivirtex", false)
          return await this.sendMessage(sock, groupJid, "🛡️ Anti-virtex protection disabled.", m)

        case "warn":
          return await this.handleWarningLimit(sock, groupJid, args, m)

        case "status":
          return await this.handleStatus(sock, groupJid, m)

        case "reset":
          return await this.handleReset(sock, groupJid, m, args)

        case "list":
          return await this.handleList(sock, groupJid, m)

        default:
          return await this.showHelp(sock, groupJid, m)
      }
    } catch (error) {
      logger.error("Error in antivirtex command:", error)
      return await this.sendMessage(sock, groupJid, "❌ Error managing anti-virtex settings", m)
    }
  },

  // Simplified helper methods
  async ensureWarningLimit(groupJid) {
    const current = await this.getWarningLimit(groupJid)
    if (!current) {
      await this.setWarningLimit(groupJid, 2)
    }
  },

  async getWarningLimit(groupJid) {
    try {
      // Use existing query system instead of raw SQL
      const group = await GroupQueries.getGroupSettings(groupJid)
      return group?.virtex_warning_limit || 2
    } catch (error) {
      logger.error("Error getting warning limit:", error)
      return 2
    }
  },

  async setWarningLimit(groupJid, limit) {
    try {
      await GroupQueries.updateGroupSetting(groupJid, 'virtex_warning_limit', limit)
      return true
    } catch (error) {
      logger.error("Error setting warning limit:", error)
      return false
    }
  },

  async handleWarningLimit(sock, groupJid, args, m) {
    if (args.length < 2) {
      const currentLimit = await this.getWarningLimit(groupJid)
      return await this.sendMessage(sock, groupJid, 
        `⚠️ *Current warning limit:* ${currentLimit}\n\nUsage: \`.antivirtex warn [1-5]\``, m)
    }

    const newLimit = parseInt(args[1])
    if (isNaN(newLimit) || newLimit < 1 || newLimit > 5) {
      return await this.sendMessage(sock, groupJid, 
        "❌ Warning limit must be between 1 and 5", m)
    }

    await this.setWarningLimit(groupJid, newLimit)
    return await this.sendMessage(sock, groupJid, 
      `✅ Warning limit set to ${newLimit} warnings before removal`, m)
  },

  async handleStatus(sock, groupJid, m) {
    const status = await GroupQueries.isAntiCommandEnabled(groupJid, "antivirtex")
    const warningStats = await WarningQueries.getWarningStats(groupJid, "antivirtex")
    const warningLimit = await this.getWarningLimit(groupJid)
    
    return await this.sendMessage(sock, groupJid,
      `🛡️ *Anti-Virtex Status*\n\n` +
      `Status: ${status ? "✅ Enabled" : "❌ Disabled"}\n` +
      `Warning Limit: ${warningLimit} warnings\n` +
      `Active Warnings: ${warningStats.totalUsers} users\n` +
      `Total Warnings: ${warningStats.totalWarnings}`, m)
  },

  async handleReset(sock, groupJid, m, args) {
    const targetUser = m.mentionedJid?.[0] || m.quoted?.sender
    if (!targetUser) {
      return await this.sendMessage(sock, groupJid, 
        "❌ Usage: `.antivirtex reset @user` or reply to a user's message", m)
    }

    const resetResult = await WarningQueries.resetUserWarnings(groupJid, targetUser, "antivirtex")
    const userNumber = targetUser.split("@")[0]
    
    const message = resetResult 
      ? `✅ Warnings reset for @${userNumber}`
      : `ℹ️ @${userNumber} had no active warnings to reset`

    return await this.sendMessage(sock, groupJid, message, m, [targetUser])
  },

  async handleList(sock, groupJid, m) {
    const warningList = await WarningQueries.getWarningList(groupJid, "antivirtex")
    if (warningList.length === 0) {
      return await this.sendMessage(sock, groupJid, "📋 No active warnings found", m)
    }

    const warningLimit = await this.getWarningLimit(groupJid)
    let listResponse = "📋 *Active Anti-Virtex Warnings*\n\n"
    warningList.forEach((warn, index) => {
      const userNumber = warn.user_jid.split("@")[0]
      listResponse += `${index + 1}. @${userNumber} - ${warn.warning_count}/${warningLimit} warnings\n`
    })

    const mentions = warningList.map((w) => w.user_jid)
    return await this.sendMessage(sock, groupJid, listResponse, m, mentions)
  },

  async showHelp(sock, groupJid, m) {
    const currentStatus = await GroupQueries.isAntiCommandEnabled(groupJid, "antivirtex")
    const currentWarnLimit = await this.getWarningLimit(groupJid)
    
    return await this.sendMessage(sock, groupJid,
      "🛡️ *Anti-Virtex Commands*\n\n" +
      "• `.antivirtex on/off` - Toggle protection\n" +
      "• `.antivirtex status` - Check status\n" +
      "• `.antivirtex warn [1-5]` - Set warning limit\n" +
      "• `.antivirtex reset @user` - Reset warnings\n" +
      "• `.antivirtex list` - Show warnings\n\n" +
      `*Current Status:* ${currentStatus ? "✅ Enabled" : "❌ Disabled"}\n` +
      `*Warning Limit:* ${currentWarnLimit} warnings`, m)
  },

  // Simplified message sender
  async sendMessage(sock, groupJid, text, originalMessage, mentions = []) {
    const messageOptions = { quoted: originalMessage }
    if (mentions.length > 0) {
      messageOptions.mentions = mentions
    }
    
    return await sock.sendMessage(groupJid, { text: text + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }, messageOptions)
  },

  // Core detection logic (simplified)
  async shouldProcess(m) {
    return m.isGroup && !m.isCommand && !m.key?.fromMe
  },

async processMessage(sock, sessionId, m) {
  if (!await this.shouldProcess(m)) return
  
  try {
    const groupJid = m.chat
    const isEnabled = await GroupQueries.isAntiCommandEnabled(groupJid, "antivirtex")
    if (!isEnabled) return

    // Skip admins
    const adminChecker = new AdminChecker()
    const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
    if (isAdmin) return

    // Analyze using security library
    const analysis = analyzeMessage(m.message)
    
    // ✅ Correct handling based on documentation
    if (!analysis.isMalicious) {
      return // Message is safe, do nothing
    }

    // Message is malicious - handle it
    await this.handleMaliciousMessage(sock, m, analysis)
    
  } catch (error) {
    logger.error("Error in antivirtex processing:", error)
    // Don't block messages if analysis fails
  }
},

  async handleMaliciousMessage(sock, m, analysis) {
    const groupJid = m.chat
    const warningLimit = await this.getWarningLimit(groupJid)
    
    // Add warning
    const warnings = await WarningQueries.addWarning(
      groupJid,
      m.sender,
      "antivirtex",
      `Virtex: ${analysis.reason}`
    )

    // Delete message
    try {
      await sock.sendMessage(groupJid, { delete: m.key })
    } catch (error) {
      logger.error("Failed to delete message:", error)
    }

    // Handle warning/removal
    let response = `🛡️ *Virtex Detected!*\n\n👤 @${m.sender.split("@")[0]}\n🔍 ${analysis.reason}\n⚠️ ${warnings}/${warningLimit}`

    if (warnings >= warningLimit) {
      try {
        await sock.groupParticipantsUpdate(groupJid, [m.sender], "remove")
        response += `\n\n❌ User removed for reaching warning limit.`
        await WarningQueries.resetUserWarnings(groupJid, m.sender, "antivirtex")
      } catch (error) {
        response += `\n\n❌ Failed to remove user.`
      }
    } else {
      response += `\n\n📝 ${warningLimit - warnings} warnings remaining.`
    }

    await this.sendMessage(sock, groupJid, response, null, [m.sender])
  }
}