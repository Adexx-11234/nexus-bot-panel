import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, ViolationQueries } from "../../database/query.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("ANTI-BOT")

/**
 * Helper function to normalize WhatsApp IDs for comparison
 */
function normalizeWhatsAppId(id) {
  if (!id) return null
  const withoutDomain = id.split('@')[0]
  const withoutSuffix = withoutDomain.split(':')[0]
  return withoutSuffix
}

export default {
  name: "Anti-Bot",
  description: "Detect and remove Baileys/WhatsApp bots from the group (excludes all admins)",
  commands: ["antibot"],
  category: "group",
  adminOnly: true,
  usage:
    "• `.antibot on` - Enable bot protection\n• `.antibot off` - Disable bot protection\n• `.antibot status` - Check protection status",

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat

    if (!m.isGroup) {
      return { response: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
    }

    const adminChecker = new AdminChecker()
    const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
    if (!isAdmin) {
      return { response: "❌ Only group admins can use this command!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
    }
    
    try {
      switch (action) {
        case "on":
          await GroupQueries.setAntiCommand(groupJid, "antibot", true)
          return { response: "✅ Anti-bot enabled\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
        
        case "off":
          await GroupQueries.setAntiCommand(groupJid, "antibot", false)
          return { response: "🤖 Anti-bot protection disabled.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }

        case "status":
          const status = await GroupQueries.isAntiCommandEnabled(groupJid, "antibot")
          return {
            response: `🤖 *Anti-bot Status*\n\nStatus: ${status ? "✅ Enabled" : "❌ Disabled"}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }

        default:
          const currentStatus = await GroupQueries.isAntiCommandEnabled(groupJid, "antibot")
          return {
            response:
              "🤖 *Anti-Bot Commands*\n\n" +
              "• `.antibot on` - Enable protection\n" +
              "• `.antibot off` - Disable protection\n" +
              "• `.antibot status` - Check status\n\n" +
              `*Current Status:* ${currentStatus ? "✅ Enabled" : "❌ Disabled"}\n\n` +
              "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          }
      }
    } catch (error) {
      logger.error("Error in antibot command:", error)
      return { response: "❌ Error managing anti-bot settings\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
    }
  },

  async isEnabled(groupJid) {
    try {
      return await GroupQueries.isAntiCommandEnabled(groupJid, "antibot")
    } catch (error) {
      logger.error("Error checking if antibot enabled:", error)
      return false
    }
  },

  async shouldProcess(m) {
    return m.isGroup
  },

  async processMessage(sock, sessionId, m) {
    try {
      if (!await this.isEnabled(m.chat)) return
      
      // Skip if sender is protected (admin, owner, or bot itself)
      if (await this.isProtectedUser(sock, m.chat, m.sender)) {
        return
      }
      
      // Check if this message is from a bot based on message ID
      if (await this.detectBotFromMessage(m)) {
        await this.handleDetectedBot(sock, m.chat, m.sender, "message_id_pattern")
      }
    } catch (error) {
      logger.error("Error processing message for bot detection:", error)
    }
  },

  async handleDetectedBot(sock, groupJid, botJid, detectionMethod) {
    try {
      // Final protection check before removal
      if (await this.isProtectedUser(sock, groupJid, botJid)) {
        logger.warn(`Attempted to remove protected user, aborting: ${botJid}`)
        return
      }
      
      await sock.groupParticipantsUpdate(groupJid, [botJid], "remove")
      
      await sock.sendMessage(groupJid, {
        text: `🤖 *Bot Detected & Removed!*\n\n` +
          `👤 User: @${botJid.split('@')[0]}\n` +
          `⚡ Action: Automatically removed\n` +
          `📋 Reason: Unauthorized bot detected\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        mentions: [botJid]
      })
      
      // Log the violation
      await ViolationQueries.logViolation(
        groupJid,
        botJid,
        "antibot",
        `Suspected bot account (${detectionMethod})`,
        { detectionMethod },
        "kick",
        0,
        null
      )
      
    } catch (error) {
      logger.error("Failed to remove detected bot:", error)
    }
  },

  async isProtectedUser(sock, groupJid, userJid) {
    try {
      const normalizedUserJid = normalizeWhatsAppId(userJid)
      const normalizedBotId = normalizeWhatsAppId(sock.user?.id)
      
      // Skip the bot itself
      if (normalizedUserJid === normalizedBotId) {
        logger.info(`Protected: Bot itself - ${userJid}`)
        return true
      }
      
      // Check if user is admin
      const adminChecker = new AdminChecker()
      const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, userJid)
      if (isAdmin) {
        logger.info(`Protected: Admin user - ${userJid}`)
        return true
      }
      
      // Double-check with group metadata
      try {
        const groupMetadata = await sock.groupMetadata(groupJid)
        const participant = groupMetadata.participants.find(p => {
          const normalizedParticipantId = normalizeWhatsAppId(p.jid)
          return normalizedParticipantId === normalizedUserJid
        })
        
        if (participant && (participant.admin === 'admin' || participant.admin === 'superadmin')) {
          logger.info(`Protected: Admin from metadata - ${userJid}`)
          return true
        }
      } catch (error) {
        logger.error("Error getting group metadata for protection check:", error)
      }
      
      return false
    } catch (error) {
      logger.error("Error checking if user is protected:", error)
      return true // Return true on error to be safe
    }
  },

  async detectBotFromMessage(m) {
    try {
      // Skip fromMe messages (bot's own messages)
      if (m.key?.fromMe === true) {
        return false
      }
      
      // Skip if sender is a group JID
      if (m.sender && m.sender.endsWith('@g.us')) {
        return false
      }
      
      // Check message key structure
      if (m.key && m.key.id) {
        const messageId = m.key.id
        
        // Check if message ID follows Baileys pattern
        if (this.isBaileysMessageId(messageId)) {
          // If it matches Baileys pattern but DOESN'T end with NEXUSBOT, it's a foreign bot
          if (!messageId.endsWith('NEXUSBOT')) {
            logger.info(`Foreign bot detected - Baileys message ID without NEXUSBOT: ${m.sender} (ID: ${messageId})`)
            return true
          } else {
            logger.debug(`Own bot message detected (has NEXUSBOT suffix): ${messageId}`)
            return false
          }
        }
      }
      
      return false
    } catch (error) {
      logger.error("Error detecting bot from message:", error)
      return false
    }
  },

  isBaileysMessageId(messageId) {
    if (!messageId) return false
    
    // Baileys typically generates message IDs in specific patterns
    // Check for common Baileys message ID patterns (keep only most reliable)
    const baileysPatterns = [
      /^3EB[0-9A-F]{17}/i, // Common Baileys pattern (removed $ to allow NEXUSBOT suffix)
      /^BAE[0-9A-F]{17}/i, // Another Baileys pattern
      /^3A[0-9A-F]{18}/i,  // Extended pattern
    ]
    
    return baileysPatterns.some(pattern => pattern.test(messageId))
  }
}