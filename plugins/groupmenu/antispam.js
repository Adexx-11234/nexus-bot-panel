import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, ViolationQueries, VIPQueries } from "../../database/query.js"
import { analyzeMessage, isSpamMessage } from "../../whatsapp/index.js"

const logger = createComponentLogger("ANTI-SPAM")

// Spam detection thresholds - ONLY for messages with links
const SPAM_THRESHOLDS = [
  { messages: 8, seconds: 10 },
  { messages: 13, seconds: 20 },
  { messages: 20, seconds: 30 },
]

const recentMessages = new Map()
const linkMessageTracking = new Map()
const MAX_RECENT_MESSAGES = 10

export default {
  name: "Anti-Spam",
  description: "Automatically detect and prevent link spam and virtex attacks",
  commands: ["antispam"],
  category: "groupmenu",
  permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage: "• .antispam on/off/kick/status\n• .antispam warn [0-10]\n• .antispam stats",

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat

    try {
      switch (action) {
        case "on":
          await GroupQueries.setAntiCommand(groupJid, "antispam", true)
          const currentLimit = await GroupQueries.getAntiCommandWarningLimit(groupJid, "antispam")
          const actionText = currentLimit === 0 ? "instant removal" : `${currentLimit} warnings before removal`
          return { response: `✅ Antispam enabled (${actionText})` }

        case "off":
          await GroupQueries.setAntiCommand(groupJid, "antispam", false)
          return { response: "❌ Antispam disabled" }

        case "kick":
          await GroupQueries.setAntiCommand(groupJid, "antispam", true)
          await GroupQueries.setAntiCommandWarningLimit(groupJid, "antispam", 0)
          return { response: "✅ Antispam set to instant removal (0 warnings)" }

        case "warn":
          if (args.length < 2) {
            const currentLimit = await GroupQueries.getAntiCommandWarningLimit(groupJid, "antispam")
            return { response: `Current limit: ${currentLimit} (0 = instant kick, 1-10 = warnings)\n\nUsage: .antispam warn [0-10]` }
          }

          const newLimit = parseInt(args[1])
          if (isNaN(newLimit) || newLimit < 0 || newLimit > 10) {
            return { response: "❌ Limit must be 0-10 (0 = instant kick)" }
          }

          await GroupQueries.setAntiCommand(groupJid, "antispam", true)
          await GroupQueries.setAntiCommandWarningLimit(groupJid, "antispam", newLimit)
          const actionType = newLimit === 0 ? "instant removal" : `${newLimit} warnings before removal`
          return { response: `✅ Antispam set to ${actionType}` }

        case "status":
          const status = await GroupQueries.isAntiCommandEnabled(groupJid, "antispam")
          const warningLimit = await GroupQueries.getAntiCommandWarningLimit(groupJid, "antispam")
          const action = warningLimit === 0 ? "Instant kick + lock group" : `${warningLimit} warnings`
          return { 
            response: `🛡️ Antispam Status\n\nStatus: ${status ? "✅ Enabled" : "❌ Disabled"}\nAction: ${action}\nDetection: Link spam + Virtex` 
          }

        case "stats":
          const weekStats = await this.getSpamStats(groupJid, 7)
          const monthStats = await this.getSpamStats(groupJid, 30)
          return { 
            response: `📊 Antispam Stats\n\n7 days:\n👥 Spammers: ${weekStats.spammers || 0}\n📨 Spam messages: ${weekStats.messages || 0}\n🚪 Kicks: ${weekStats.kicks || 0}\n🔒 Locks: ${weekStats.locks || 0}\n\n30 days:\n👥 Spammers: ${monthStats.spammers || 0}\n📨 Messages: ${monthStats.messages || 0}` 
          }

        default:
          const currentStatus = await GroupQueries.isAntiCommandEnabled(groupJid, "antispam")
          const currentWarnLimit = await GroupQueries.getAntiCommandWarningLimit(groupJid, "antispam")
          return { 
            response: `🛡️ Antispam Commands\n\n• .antispam on - Enable\n• .antispam off - Disable\n• .antispam kick - Instant removal\n• .antispam warn [0-10] - Set limit\n• .antispam status - Check status\n• .antispam stats - Statistics\n\nStatus: ${currentStatus ? "✅ Enabled" : "❌ Disabled"}\nLimit: ${currentWarnLimit} warnings\n\nNote: Link spam always locks group` 
          }
      }
    } catch (error) {
      logger.error("Error in antispam command:", error)
      return { response: "❌ Error managing antispam settings" }
    }
  },

  async getSpamStats(groupJid, days = 7) {
    try {
      const stats = await ViolationQueries.getViolationStats(groupJid, 'antispam', days)
      if (stats.length > 0) {
        return stats[0]
      }
      return { spammers: 0, messages: 0, kicks: 0, locks: 0 }
    } catch (error) {
      logger.error("Error getting spam stats:", error)
      return { spammers: 0, messages: 0, kicks: 0, locks: 0 }
    }
  },

  async isEnabled(groupJid) {
    try {
      return await GroupQueries.isAntiCommandEnabled(groupJid, "antispam")
    } catch (error) {
      logger.error("Error checking if antispam enabled:", error)
      return false
    }
  },

  async shouldProcess(m) {
    if (!m.isGroup || !m.message) return false
    if (m.isCommand) return false
    if (m.key?.fromMe) return false
    return true
  },

  async processMessage(sock, sessionId, m) {
    try {
      const virtexCheck = analyzeMessage(m.message)
      if (virtexCheck.isMalicious) {
        await this.handleVirtexDetection(sock, sessionId, m, virtexCheck.reason)
        return
      }

      const userKey = `${m.chat}_${m.sender}`
      const recentTexts = recentMessages.get(userKey) || []

      if (m.text) {
        recentTexts.push(m.text)
        if (recentTexts.length > MAX_RECENT_MESSAGES) {
          recentTexts.shift()
        }
        recentMessages.set(userKey, recentTexts)
      }

      const spamCheck = isSpamMessage(m.message, recentTexts)
      if (spamCheck.isSpam) {
        await this.handleSpamDetection(sock, sessionId, m, spamCheck.reason)
        return
      }

      if (this.detectLinks(m.text)) {
        await this.handleLinkSpamDetection(sock, sessionId, m)
      }
    } catch (error) {
      logger.error("Error processing antispam message:", error)
    }
  },

  async handleVirtexDetection(sock, sessionId, m, reason) {
    try {
      const groupJid = m.chat

      try {
        await sock.sendMessage(groupJid, { delete: m.key })
      } catch (e) {
        logger.error("Failed to delete virtex:", e)
      }

      try {
        await sock.groupParticipantsUpdate(groupJid, [m.sender], "remove")
      } catch (e) {
        logger.error("Failed to remove virtex sender:", e)
      }

      await sock.sendMessage(groupJid, {
        text: `🚨 Virtex blocked!\n\n👤 @${m.sender.split("@")[0]}\n⚠️ Threat: ${reason}\n✅ User removed`,
        mentions: [m.sender]
      })

      await ViolationQueries.logViolation(
        groupJid,
        m.sender,
        "virtex",
        reason,
        { reason },
        "kick",
        1,
        m.key.id
      )
    } catch (error) {
      logger.error("Error handling virtex:", error)
    }
  },

  async handleLinkSpamDetection(sock, sessionId, m) {
    try {
      const groupJid = m.chat

      if (!groupJid) return


      const isVIP = await VIPQueries.isVIP(
        sessionId ? parseInt(sessionId.replace("session_", "")) : null
      )
      if (isVIP.isVIP) return

      const detectedLinks = this.extractLinks(m.text)
      await this.trackLinkMessage(groupJid, m.sender, m.text, detectedLinks)

      const spamDetection = await this.checkSpamThresholds(groupJid, m.sender)

      if (spamDetection.isSpam) {
        try {
          await sock.groupSettingUpdate(groupJid, "announcement")
          await GroupQueries.setGroupClosed(groupJid, true)
        } catch (error) {
          logger.error("Failed to lock group:", error)
        }

        try {
          await sock.sendMessage(groupJid, { delete: m.key })
        } catch (error) {
          logger.error("Failed to delete spam:", error)
        }

        try {
          await sock.groupParticipantsUpdate(groupJid, [m.sender], "remove")
        } catch (error) {
          logger.error("Failed to remove spammer:", error)
        }

        await sock.sendMessage(groupJid, {
          text: `🚨 Link spam detected!\n\n👤 @${m.sender.split("@")[0]}\n📊 ${spamDetection.count} links in ${spamDetection.seconds}s\n\n✅ User removed\n🔒 Group locked\n\nAdmins: Use .open to unlock`,
          mentions: [m.sender]
        })

        await ViolationQueries.logViolation(
          groupJid,
          m.sender,
          "antispam",
          m.text,
          { message_count: spamDetection.count, time_window: spamDetection.seconds, links: detectedLinks, group_locked: true },
          "kick",
          spamDetection.count,
          m.key.id
        )

        await this.cleanupUserTracking(groupJid, m.sender)
      }
    } catch (error) {
      logger.error("Error handling link spam:", error)
    }
  },

  async handleSpamDetection(sock, sessionId, m, reason) {
    try {
      const groupJid = m.chat
      if (!groupJid) return
      

      try {
        await sock.sendMessage(groupJid, { delete: m.key })
      } catch (e) {
        logger.error("Failed to delete spam:", e)
      }

      await sock.sendMessage(groupJid, {
        text: `⚠️ Spam warning\n\n@${m.sender.split("@")[0]}, stop spamming.\nReason: ${reason}`,
        mentions: [m.sender]
      })

      const userKey = `${m.chat}_${m.sender}`
      recentMessages.delete(userKey)
    } catch (error) {
      logger.error("Error handling spam:", error)
    }
  },

  async trackLinkMessage(groupJid, userJid, messageText, detectedLinks) {
    try {
      const now = Date.now()
      const userKey = `${groupJid}_${userJid}`
      
      if (!linkMessageTracking.has(userKey)) {
        linkMessageTracking.set(userKey, [])
      }
      
      const messages = linkMessageTracking.get(userKey)
      messages.push({ timestamp: now, text: messageText, links: detectedLinks })
      
      const cutoff = now - 60000
      const filtered = messages.filter(msg => msg.timestamp >= cutoff)
      linkMessageTracking.set(userKey, filtered)
    } catch (error) {
      logger.error("Error tracking link message:", error)
    }
  },

  async checkSpamThresholds(groupJid, userJid) {
    try {
      const now = Date.now()
      const userKey = `${groupJid}_${userJid}`
      const messages = linkMessageTracking.get(userKey) || []

      for (const threshold of SPAM_THRESHOLDS) {
        const windowStart = now - (threshold.seconds * 1000)
        const count = messages.filter(msg => msg.timestamp >= windowStart).length

        if (count >= threshold.messages) {
          return {
            isSpam: true,
            count: count,
            seconds: threshold.seconds,
            threshold: threshold.messages
          }
        }
      }

      return { isSpam: false }
    } catch (error) {
      logger.error("Error checking spam thresholds:", error)
      return { isSpam: false }
    }
  },

  async cleanupUserTracking(groupJid, userJid) {
    try {
      const userKey = `${groupJid}_${userJid}`
      linkMessageTracking.delete(userKey)
      recentMessages.delete(userKey)
    } catch (error) {
      logger.error("Error cleaning up tracking:", error)
    }
  },

  detectLinks(text) {
    if (!text) return false
    const cleanText = text.trim().replace(/\s+/g, " ")

    const linkPatterns = [
      /https?:\/\/(?:[-\w.])+(?::[0-9]+)?(?:\/[^\s]*)?/gi,
      /\bwww\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?/gi,
      /\bt\.me\/[a-zA-Z0-9_]+/gi,
      /\bwa\.me\/[0-9]+/gi
    ]

    return linkPatterns.some(pattern => pattern.test(cleanText))
  },

  extractLinks(text) {
    const links = new Set()
    const cleanText = text.trim().replace(/\s+/g, " ")

    const linkPatterns = [
      /https?:\/\/(?:[-\w.])+(?::[0-9]+)?(?:\/[^\s]*)?/gi,
      /\bwww\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?/gi,
      /\bt\.me\/[a-zA-Z0-9_]+/gi,
      /\bwa\.me\/[0-9]+/gi
    ]

    linkPatterns.forEach(pattern => {
      let match
      pattern.lastIndex = 0
      while ((match = pattern.exec(cleanText)) !== null) {
        links.add(match[0].trim())
      }
    })

    return Array.from(links)
  }
}