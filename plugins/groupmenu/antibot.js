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
          // Check if bot is admin before enabling
          const botIsAdmin = await adminChecker.isBotAdmin(sock, groupJid)
          if (!botIsAdmin) {
            return {
              response: "⚠️ *Cannot Enable Anti-Bot*\n\n" +
                "I need admin permissions to remove bots.\n" +
                "Please make me an admin first!\n\n" +
                "> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
            }
          }
          await GroupQueries.setAntiCommand(groupJid, "antibot", true)
          return { response: "✅ Anti-bot enabled\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
        
        case "off":
          await GroupQueries.setAntiCommand(groupJid, "antibot", false)
          return { response: "🤖 Anti-bot protection disabled.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }

        case "status":
          const status = await GroupQueries.isAntiCommandEnabled(groupJid, "antibot")
          const botAdminStatus = await adminChecker.isBotAdmin(sock, groupJid)
          return {
            response: `🤖 *Anti-bot Status*\n\n` +
              `Status: ${status ? "✅ Enabled" : "❌ Disabled"}\n` +
              `Bot Admin: ${botAdminStatus ? "✅ Yes" : "❌ No"}\n\n` +
              `${!botAdminStatus ? "⚠️ Bot needs admin permissions to remove bots!\n\n" : ""}` +
              `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
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
        await this.handleDetectedBot(sock, m.chat, m.sender, "message_id_pattern", m)
      }
    } catch (error) {
      logger.error("Error processing message for bot detection:", error)
    }
  },

  async handleDetectedBot(sock, groupJid, botJid, detectionMethod, m) {
    try {
      // Final protection check before removal
      if (await this.isProtectedUser(sock, groupJid, botJid)) {
        logger.warn(`[Anti-Bot] Attempted to remove protected user, aborting: ${botJid}`)
        return
      }

      // Check if bot has admin permissions FIRST
      const adminChecker = new AdminChecker()
      const botIsAdmin = await adminChecker.isBotAdmin(sock, groupJid)
      
      if (!botIsAdmin) {
        logger.warn(`[Anti-Bot] Bot is not admin in ${groupJid}, cannot remove ${botJid}`)
        return
      }

      logger.info(`[Anti-Bot] Attempting to remove bot: ${botJid} from ${groupJid}`)
      
      // Attempt removal with proper error handling
      try {
        await sock.groupParticipantsUpdate(groupJid, [botJid], "remove")
        logger.info(`[Anti-Bot] Successfully removed bot: ${botJid}`)
        
        // Delete the bot's message
        try {
          await sock.sendMessage(groupJid, {
            delete: m.key
          })
          logger.info(`[Anti-Bot] Deleted bot message from ${botJid}`)
        } catch (deleteError) {
          logger.error(`[Anti-Bot] Failed to delete bot message:`, deleteError)
        }
        
        // Send success confirmation
        await sock.sendMessage(groupJid, {
          text: `✅ *Bot Removed Successfully!*\n\n` +
            `👤 User: @${botJid.split('@')[0]}\n` +
            `The unauthorized bot has been removed from the group.\n\n` +
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
        
      } catch (removeError) {
        logger.error(`[Anti-Bot] Failed to remove bot ${botJid}:`, removeError)
        
        // Send failure message
        await sock.sendMessage(groupJid, {
          text: `⚠️ *Failed to Remove Bot*\n\n` +
            `User: @${botJid.split('@')[0]}\n` +
            `Reason: ${removeError.message || 'Unknown error'}\n\n` +
            `💡 Possible reasons:\n` +
            `• Bot is a group admin\n` +
            `• Bot already left\n` +
            `• Network/API issue\n\n` +
            `Please try removing manually.\n\n` +
            `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
          mentions: [botJid]
        })
      }
      
    } catch (error) {
      logger.error("[Anti-Bot] Error in handleDetectedBot:", error)
      
      // Try to send error notification
      try {
        await sock.sendMessage(groupJid, {
          text: `❌ *Anti-Bot Error*\n\n` +
            `Failed to process bot removal.\n` +
            `Error: ${error.message}\n\n` +
            `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        })
      } catch (msgError) {
        logger.error("[Anti-Bot] Failed to send error message:", msgError)
      }
    }
  },

  async isProtectedUser(sock, groupJid, userJid) {
    try {
      const normalizedUserJid = normalizeWhatsAppId(userJid)
      const normalizedBotId = normalizeWhatsAppId(sock.user?.id)
      
      // Skip the bot itself
      if (normalizedUserJid === normalizedBotId) {
        logger.info(`[Anti-Bot] Protected: Bot itself - ${userJid}`)
        return true
      }
      
      // Check if user is admin
      const adminChecker = new AdminChecker()
      const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, userJid)
      if (isAdmin) {
        logger.info(`[Anti-Bot] Protected: Admin user - ${userJid}`)
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
          logger.info(`[Anti-Bot] Protected: Admin from metadata - ${userJid}`)
          return true
        }
      } catch (error) {
        logger.error("[Anti-Bot] Error getting group metadata for protection check:", error)
      }
      
      return false
    } catch (error) {
      logger.error("[Anti-Bot] Error checking if user is protected:", error)
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
        
        // First check: Is this a Baileys bot message?
        if (this.isBaileysMessageId(messageId)) {
          // Second check: Is it OUR bot (ends with NEXUSBOT)?
          if (messageId.endsWith('NEXUSBOT')) {
            logger.debug(`[Anti-Bot] Own bot message detected (has NEXUSBOT suffix): ${messageId}`)
            return false // Our bot, don't kick
          } else {
            // Baileys bot but NOT ours - FOREIGN BOT
            logger.info(`[Anti-Bot] Foreign bot detected - Baileys ID without NEXUSBOT: ${m.sender} (ID: ${messageId})`)
            return true // Foreign bot, kick it!
          }
        }
      }
      
      return false
    } catch (error) {
      logger.error("[Anti-Bot] Error detecting bot from message:", error)
      return false
    }
  },

  isBaileysMessageId(messageId) {
    if (!messageId) return false
    
    // Baileys patterns - check if message ID STARTS with these patterns
    const baileysPatterns = [
      /^3EB[0-9A-F]+/i, // Starts with 3EB followed by hex chars
      /^BAE[0-9A-F]+/i, // Starts with BAE followed by hex chars
      /^3A[0-9A-F]+/i,  // Starts with 3A followed by hex chars
    ]
    
    // Check if messageId matches any Baileys pattern
    return baileysPatterns.some(pattern => pattern.test(messageId))
  }
}