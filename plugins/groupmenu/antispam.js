import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, ViolationQueries } from "../../database/query.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"
import { pool } from "../../config/database.js"
import { analyzeMessage, isSpamMessage } from "../../whatsapp/index.js"

const logger = createComponentLogger("ANTI-SPAM")

// Fixed spam detection thresholds - ONLY for messages with links
const SPAM_THRESHOLDS = [
  { messages: 8, seconds: 10 }, // 8 link messages in 10 seconds
  { messages: 13, seconds: 20 }, // 13 link messages in 20 seconds
  { messages: 20, seconds: 30 }, // 20 link messages in 30 seconds
]

const recentMessages = new Map() // groupJid_userJid -> [message texts]
const MAX_RECENT_MESSAGES = 10

export default {
  name: "Anti-Spam",
  description: "Automatically detect and prevent link spam and virtex attacks",
  commands: ["antispam"],
  category: "group",
  adminOnly: true,
  usage:
    "• `.antispam on` - Enable spam protection\n• `.antispam off` - Disable spam protection\n• `.antispam stats` - View statistics",

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat

    if (!m.isGroup) {
      await sock.sendMessage(
        groupJid,
        {
          text: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        },
        { quoted: m },
      )
      return
    }

    const adminChecker = new AdminChecker()
    const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
    if (!isAdmin) {
      return { response: "❌ Only group admins can use this command!" }
    }

    try {
      switch (action) {
        case "on":
          await GroupQueries.setAntiCommand(groupJid, "antispam", true)

          await sock.sendMessage(
            groupJid,
            {
              text:
                "✅ *Anti-spam enabled*\n\n" +
                "🛡️ Automatic link spam detection active\n" +
                "⚠️ Link spammers will trigger group lock and removal\n\n" +
                "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
            },
            { quoted: m },
          )
          break

        case "off":
          await GroupQueries.setAntiCommand(groupJid, "antispam", false)
          await sock.sendMessage(
            groupJid,
            {
              text: "🔓 Anti-spam protection disabled.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
            },
            { quoted: m },
          )
          break

        case "stats":
          const weekStats = await this.getSpamStats(groupJid, 7)
          const monthStats = await this.getSpamStats(groupJid, 30)

          await sock.sendMessage(
            groupJid,
            {
              text:
                `📊 *Anti-Spam Statistics*\n\n` +
                `*Last 7 days:*\n` +
                `👥 Link spammers: ${weekStats.spammers || 0}\n` +
                `📨 Spam messages: ${weekStats.messages || 0}\n` +
                `🚪 Users removed: ${weekStats.kicks || 0}\n` +
                `🔒 Group locks: ${weekStats.locks || 0}\n` +
                `🚧 Virtex attacks: ${weekStats.virtex_attacks || 0}\n\n` +
                `*Last 30 days:*\n` +
                `👥 Spammers: ${monthStats.spammers || 0}\n` +
                `📨 Spam messages: ${monthStats.messages || 0}\n\n` +
                `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            },
            { quoted: m },
          )
          break

        default:
          const currentStatus = await GroupQueries.isAntiCommandEnabled(groupJid, "antispam")

          await sock.sendMessage(
            groupJid,
            {
              text:
                "🛡️ *Anti-Spam Protection*\n\n" +
                "• `.antispam on` - Enable protection\n" +
                "• `.antispam off` - Disable protection\n" +
                "• `.antispam stats` - View statistics\n\n" +
                `*Current Status:* ${currentStatus ? "✅ Enabled" : "❌ Disabled"}\n\n` +
                `*Detection:* Rapid link spam detection and virtex attacks\n` +
                `*Action:* Lock group + Remove user for link spam, warn and remove for virtex\n\n` +
                `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            },
            { quoted: m },
          )
          break
      }
    } catch (error) {
      logger.error("Error in antispam command:", error)
      await sock.sendMessage(
        groupJid,
        {
          text: "❌ Error managing anti-spam settings\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
        },
        { quoted: m },
      )
    }
  },

  async getSpamStats(groupJid, days = 7) {
    try {
      const result = await pool.query(
        `SELECT 
          COUNT(DISTINCT user_jid) as spammers,
          COUNT(*) as messages,
          COUNT(*) FILTER (WHERE action_taken = 'kick') as kicks,
          COUNT(*) FILTER (WHERE (detected_content->>'group_locked')::boolean = true) as locks,
          COUNT(*) FILTER (WHERE violation_type = 'virtex') as virtex_attacks
        FROM violations 
        WHERE group_jid = $1 
          AND violation_type IN ('antispam', 'virtex')
          AND violated_at >= NOW() - INTERVAL '${days} days'`,
        [groupJid],
      )
      return result.rows[0] || { spammers: 0, messages: 0, kicks: 0, locks: 0, virtex_attacks: 0 }
    } catch (error) {
      logger.error("Error getting spam stats:", error)
      return { spammers: 0, messages: 0, kicks: 0, locks: 0, virtex_attacks: 0 }
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

      // Add current message to recent
      if (m.text) {
        recentTexts.push(m.text)
        if (recentTexts.length > MAX_RECENT_MESSAGES) {
          recentTexts.shift()
        }
        recentMessages.set(userKey, recentTexts)
      }

      // Check for repeated message spam
      const spamCheck = isSpamMessage(m.message, recentTexts)
      if (spamCheck.isSpam) {
        await this.handleSpamDetection(sock, sessionId, m, spamCheck.reason)
        return
      }

      // Original link spam detection
      if (this.detectLinks(m.text)) {
        await this.handleLinkSpamDetection(sock, sessionId, m)
      }
    } catch (error) {
      logger.error("Error processing antispam message:", error)
    }
  },

  async handleVirtexDetection(sock, sessionId, m, reason) {
    try {
      const adminChecker = new AdminChecker()
      const groupJid = m.chat

      // Check if sender is admin (admins exempt)
      const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
      if (isAdmin) return

      // Check if bot is admin
      const botIsAdmin = await adminChecker.isBotAdmin(sock, groupJid)
      if (!botIsAdmin) return

      logger.warn(`Virtex detected from ${m.sender} in ${groupJid}: ${reason}`)

      // Delete the malicious message immediately
      try {
        await sock.sendMessage(groupJid, { delete: m.key })
      } catch (e) {
        logger.error("Failed to delete virtex message:", e)
      }

      // Remove the sender
      try {
        await sock.groupParticipantsUpdate(groupJid, [m.sender], "remove")
      } catch (e) {
        logger.error("Failed to remove virtex sender:", e)
      }

      // Alert the group
      const userNumber = m.sender.split("@")[0]
      await sock.sendMessage(groupJid, {
        text:
          `🚨 *VIRTEX/MALICIOUS MESSAGE BLOCKED*\n\n` +
          `👤 User: @${userNumber}\n` +
          `⚠️ Threat: ${reason}\n` +
          `\n✅ Actions taken:\n` +
          `• Message deleted\n` +
          `• User removed from group\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        mentions: [m.sender],
      })

      // Log violation
      try {
        await ViolationQueries.logViolation(
          groupJid,
          m.sender,
          "virtex",
          reason,
          { reason, messageType: Object.keys(m.message || {})[0] },
          "kick",
          1,
          m.key.id,
        )
      } catch (e) {
        logger.error("Failed to log virtex violation:", e)
      }
    } catch (error) {
      logger.error("Error handling virtex detection:", error)
    }
  },

  async handleLinkSpamDetection(sock, sessionId, m) {
    try {
      const adminChecker = new AdminChecker()
      const groupJid = m.chat

      if (!groupJid) {
        logger.warn("No group JID available for antispam processing")
        return
      }

      const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
      if (isAdmin) {
        return
      }

      // Check if user is VIP (exempt from spam detection)
      const isVIP = await this.isUserVIP(sessionId, m.sender)
      if (isVIP) {
        return
      }

      const botIsAdmin = await adminChecker.isBotAdmin(sock, groupJid)
      if (!botIsAdmin) {
        return
      }

      // Message definitely has links (checked in shouldProcess)
      const detectedLinks = this.extractLinks(m.text)

      // Track this link message
      await this.trackLinkMessage(groupJid, m.sender, m.text, detectedLinks)

      // Check if spam threshold exceeded
      const spamDetection = await this.checkSpamThresholds(groupJid, m.sender)

      if (spamDetection.isSpam) {
        logger.warn(
          `Link spam detected: ${m.sender} sent ${spamDetection.count} link messages in ${spamDetection.seconds}s`,
        )

        // STEP 1: Lock the group FIRST (close to admins only)
        try {
          await sock.groupSettingUpdate(groupJid, "announcement")
          await GroupQueries.setGroupClosed(groupJid, true)
          logger.info(`Group ${groupJid} locked due to link spam`)
        } catch (error) {
          logger.error("Failed to lock group:", error)
        }

        // STEP 2: Delete the spam message
        try {
          await sock.sendMessage(groupJid, { delete: m.key })
        } catch (error) {
          logger.error("Failed to delete spam message:", error)
        }

        // STEP 3: Remove the spammer
        try {
          await sock.groupParticipantsUpdate(groupJid, [m.sender], "remove")
          logger.info(`Removed link spammer ${m.sender} from ${groupJid}`)
        } catch (error) {
          logger.error("Failed to remove spammer:", error)
        }

        // STEP 4: Send alert message
        const userNumber = m.sender.split("@")[0]
        await sock.sendMessage(groupJid, {
          text:
            `🚨 *LINK SPAM DETECTED - GROUP LOCKED*\n\n` +
            `👤 Spammer: @${userNumber}\n` +
            `📊 Sent ${spamDetection.count} link messages in ${spamDetection.seconds} seconds\n` +
            `🔗 Links detected in spam\n` +
            `\n✅ Actions taken:\n` +
            `• Group locked (admins only)\n` +
            `• User removed from group\n` +
            `\n⚠️ Admins: Use \`.open\` to unlock group\n\n` +
            `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          mentions: [m.sender],
        })

        // STEP 5: Log violation
        try {
          await ViolationQueries.logViolation(
            groupJid,
            m.sender,
            "antispam",
            m.text,
            {
              message_count: spamDetection.count,
              time_window: spamDetection.seconds,
              links: detectedLinks,
              group_locked: true,
              detection_method: `${spamDetection.count} link messages in ${spamDetection.seconds}s`,
            },
            "kick",
            spamDetection.count,
            m.key.id,
          )
        } catch (error) {
          logger.error("Failed to log violation:", error)
        }

        // STEP 6: Clean up spam tracking for this user
        await this.cleanupUserTracking(groupJid, m.sender)
      }
    } catch (error) {
      logger.error("Error handling link spam detection:", error)
    }
  },

  async handleSpamDetection(sock, sessionId, m, reason) {
    try {
      const adminChecker = new AdminChecker()
      const groupJid = m.chat

      const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
      if (isAdmin) return

      const botIsAdmin = await adminChecker.isBotAdmin(sock, groupJid)
      if (!botIsAdmin) return

      logger.warn(`Spam detected from ${m.sender}: ${reason}`)

      // Delete spam messages
      try {
        await sock.sendMessage(groupJid, { delete: m.key })
      } catch (e) {
        logger.error("Failed to delete spam:", e)
      }

      // Warn the user (don't kick for regular spam, just warn)
      const userNumber = m.sender.split("@")[0]
      await sock.sendMessage(groupJid, {
        text:
          `⚠️ *Spam Warning*\n\n` +
          `@${userNumber}, please stop spamming.\n` +
          `Reason: ${reason}\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        mentions: [m.sender],
      })

      // Clear their recent messages to reset
      const userKey = `${m.chat}_${m.sender}`
      recentMessages.delete(userKey)
    } catch (error) {
      logger.error("Error handling spam detection:", error)
    }
  },

  async trackLinkMessage(groupJid, userJid, messageText, detectedLinks) {
    try {
      const now = new Date()

      await pool.query(
        `INSERT INTO spam_tracking (group_jid, user_jid, message_text, links, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [groupJid, userJid, messageText, JSON.stringify(detectedLinks), now],
      )

      // Clean up messages older than 60 seconds for this user
      const cutoff = new Date(now.getTime() - 60000)
      await pool.query(
        `DELETE FROM spam_tracking 
         WHERE group_jid = $1 
           AND user_jid = $2 
           AND created_at < $3`,
        [groupJid, userJid, cutoff],
      )
    } catch (error) {
      logger.error("Error tracking link message:", error)
    }
  },

  async checkSpamThresholds(groupJid, userJid) {
    try {
      const now = new Date()

      // Check each threshold
      for (const threshold of SPAM_THRESHOLDS) {
        const windowStart = new Date(now.getTime() - threshold.seconds * 1000)

        const result = await pool.query(
          `SELECT COUNT(*) as count 
           FROM spam_tracking 
           WHERE group_jid = $1 
             AND user_jid = $2 
             AND created_at >= $3`,
          [groupJid, userJid, windowStart],
        )

        const count = Number.parseInt(result.rows[0].count)

        if (count >= threshold.messages) {
          return {
            isSpam: true,
            count: count,
            seconds: threshold.seconds,
            threshold: threshold.messages,
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
      await pool.query(`DELETE FROM spam_tracking WHERE group_jid = $1 AND user_jid = $2`, [groupJid, userJid])
      // Also clear from memory
      const userKey = `${groupJid}_${userJid}`
      recentMessages.delete(userKey)
    } catch (error) {
      logger.error("Error cleaning up user tracking:", error)
    }
  },

  async isUserVIP(sessionId, userJid) {
    try {
      const telegramId = sessionId ? Number.parseInt(sessionId.replace("session_", "")) : null
      if (!telegramId) return false

      const result = await pool.query(`SELECT is_default_vip, vip_level FROM whatsapp_users WHERE telegram_id = $1`, [
        telegramId,
      ])

      return result.rows[0]?.is_default_vip === true || result.rows[0]?.vip_level === 99
    } catch (error) {
      logger.error("Error checking VIP status:", error)
      return false
    }
  },

  detectLinks(text) {
    if (!text) return false
    const cleanText = text.trim().replace(/\s+/g, " ")

    const linkPatterns = [
      /https?:\/\/(?:[-\w.])+(?::[0-9]+)?(?:\/[^\s]*)?/gi,
      /\bwww\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?/gi,
      /\b[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.(?:com|net|org|edu|gov|mil|co|io|me|tv|info|biz|app|dev|tech|online|site|website|store|shop)\b(?:\/[^\s]*)?/gi,
      /\bt\.me\/[a-zA-Z0-9_]+/gi,
      /\byoutube\.com\/watch\?v=[a-zA-Z0-9_-]+/gi,
      /\byoutu\.be\/[a-zA-Z0-9_-]+/gi,
      /\bwa\.me\/[0-9]+/gi,
      /\binstagram\.com\/[a-zA-Z0-9_.]+/gi,
      /\bfacebook\.com\/[a-zA-Z0-9.]+/gi,
      /\btwitter\.com\/[a-zA-Z0-9_]+/gi,
      /\btiktok\.com\/@?[a-zA-Z0-9_.]+/gi,
      /\bdiscord\.gg\/[a-zA-Z0-9]+/gi,
      /\bbit\.ly\/[a-zA-Z0-9]+/gi,
      /\btinyurl\.com\/[a-zA-Z0-9]+/gi,
    ]

    return linkPatterns.some((pattern) => pattern.test(cleanText))
  },

  extractLinks(text) {
    const links = new Set()
    const cleanText = text.trim().replace(/\s+/g, " ")

    const linkPatterns = [
      /https?:\/\/(?:[-\w.])+(?::[0-9]+)?(?:\/[^\s]*)?/gi,
      /\bwww\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?/gi,
      /\b[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.(?:com|net|org|edu|gov|mil|co|io|me|tv|info|biz|app|dev|tech|online|site|website|store|shop)\b(?:\/[^\s]*)?/gi,
      /\bt\.me\/[a-zA-Z0-9_]+/gi,
      /\byoutube\.com\/watch\?v=[a-zA-Z0-9_-]+/gi,
      /\byoutu\.be\/[a-zA-Z0-9_-]+/gi,
      /\bwa\.me\/[0-9]+/gi,
      /\binstagram\.com\/[a-zA-Z0-9_.]+/gi,
      /\bfacebook\.com\/[a-zA-Z0-9.]+/gi,
      /\btwitter\.com\/[a-zA-Z0-9_]+/gi,
      /\btiktok\.com\/@?[a-zA-Z0-9_.]+/gi,
      /\bdiscord\.gg\/[a-zA-Z0-9]+/gi,
      /\bbit\.ly\/[a-zA-Z0-9]+/gi,
      /\btinyurl\.com\/[a-zA-Z0-9]+/gi,
    ]

    linkPatterns.forEach((pattern) => {
      let match
      pattern.lastIndex = 0
      while ((match = pattern.exec(cleanText)) !== null) {
        links.add(match[0].trim())
      }
    })

    return Array.from(links)
  },
}
