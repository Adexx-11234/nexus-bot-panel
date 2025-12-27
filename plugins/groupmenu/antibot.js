import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, ViolationQueries } from "../../database/query.js"

const logger = createComponentLogger("ANTI-BOT")

/**
 * Helper function to normalize WhatsApp IDs for comparison
 * Handles formats like:
 * - 2347067902342@s.whatsapp.net
 * - 2347067902342:34@s.whatsapp.net
 * - 2347067902342
 */
function normalizeWhatsAppId(id) {
  if (!id) return null
  
  // Remove any suffix after @ if present
  const withoutDomain = id.split('@')[0]
  
  // Remove any suffix after : if present (like :34)
  const withoutSuffix = withoutDomain.split(':')[0]
  
  return withoutSuffix
}

export default {
  name: "Anti-Bot",
  description: "Detect and remove Baileys/WhatsApp bots from the group (excludes all admins)",
  commands: ["antibot"],
  category: "groupmenu",
  permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage:
    "• `.antibot on` - Enable bot protection\n• `.antibot off` - Disable bot protection\n• `.antibot status` - Check protection status\n• `.antibot scan` - Manually scan for bots",

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat

    
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

        case "scan":
          return await this.scanExistingMembers(sock, groupJid)

        default:
          const currentStatus = await GroupQueries.isAntiCommandEnabled(groupJid, "antibot")
          return {
            response:
              "🤖 *Anti-Bot Commands*\n\n" +
              "• `.antibot on` - Enable protection\n" +
              "• `.antibot off` - Disable protection\n" +
              "• `.antibot status` - Check status\n" +
              "• `.antibot scan` - Scan existing members\n\n" +
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
    if (!m.isGroup) return false
    
    // Process both participant updates and regular messages for bot detection
    return true
  },

async processMessage(sock, sessionId, m) {
    try {
      if (!await this.isEnabled(m.chat)) return
      
      // CRITICAL: Skip if sender is an admin, owner, or the bot itself
      if (await this.isProtectedUser(sock, m.chat, m.sender)) {
        return
      }
      
      // Check if this message shows bot characteristics
      // FIXED: Pass sock to detectBotFromMessage
      if (await this.detectBotFromMessage(sock, m)) {
        await this.handleDetectedBot(sock, m.chat, m.sender, "message_pattern")
      }
    } catch (error) {
      logger.error("Error processing message for bot detection:", error)
    }
  },

  async processParticipantUpdate(sock, sessionId, update) {
    try {
      if (update.action === 'add' && await this.isEnabled(update.jid)) {
        for (const participantJid of update.participants) {
          await this.checkNewParticipant(sock, update.jid, participantJid)
        }
      }
    } catch (error) {
      logger.error("Error processing participant update:", error)
    }
  },

  async checkNewParticipant(sock, groupJid, participantJid) {
    try {
      
      // CRITICAL: Skip if the new participant is protected (admin/owner/bot itself)
      if (await this.isProtectedUser(sock, groupJid, participantJid)) {
        logger.info(`Skipping bot check for protected user: ${participantJid}`)
        return
      }
      
      // Wait a bit for the user to potentially send a message
      setTimeout(async () => {
        // Double-check protection status before taking action
        if (await this.isProtectedUser(sock, groupJid, participantJid)) {
          return
        }
        
        const isBot = await this.detectBotFromProfile(sock, participantJid)
        if (isBot) {
          await this.handleDetectedBot(sock, groupJid, participantJid, "profile_analysis")
        }
      }, 5000) // Wait 5 seconds
      
    } catch (error) {
      logger.error("Error checking new participant:", error)
    }
  },

  async scanExistingMembers(sock, groupJid) {
    try {

      // Get group metadata
      const groupMetadata = await sock.groupMetadata(groupJid)
      const participants = groupMetadata.participants
      
      let suspiciousBots = []
      let checkedCount = 0
      let skippedProtected = 0
      
      for (const participant of participants) {
        // CRITICAL: Skip protected users (bot itself, admins, owners)
        if (await this.isProtectedUser(sock, groupJid, participant.id)) {
          skippedProtected++
          logger.info(`Skipping protected user during scan: ${participant.id}`)
          continue
        }
        
        const isBot = await this.detectBotFromProfile(sock, participant.id)
        if (isBot) {
          suspiciousBots.push(participant.id)
        }
        checkedCount++
        
        // Add delay to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      
      if (suspiciousBots.length === 0) {
        return {
          response: 
            `🤖 *Scan Complete*\n\n` +
            `Checked: ${checkedCount} members\n` +
            `Skipped protected: ${skippedProtected}\n` +
            `Bots found: 0\n\n` +
            `✅ No suspicious bots detected!\n\n` +
            `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }
      }
      
      // Remove detected bots
      let removedCount = 0
      for (const botJid of suspiciousBots) {
        try {
          // Final protection check before removal
          if (await this.isProtectedUser(sock, groupJid, botJid)) {
            logger.warn(`Attempted to remove protected user, skipping: ${botJid}`)
            continue
          }
          
          await sock.groupParticipantsUpdate(groupJid, [botJid], "remove")
          removedCount++
          
          // Log the violation
          await ViolationQueries.logViolation(
            groupJid,
            botJid,
            "antibot",
            "Suspected bot account (manual scan)",
            {},
            "kick",
            0,
            null
          )
          
          await new Promise(resolve => setTimeout(resolve, 1000))
        } catch (error) {
          logger.error("Failed to remove bot during scan:", error)
        }
      }
      
      return {
        response:
          `🤖 *Scan Complete*\n\n` +
          `Checked: ${checkedCount} members\n` +
          `Skipped protected: ${skippedProtected}\n` +
          `Bots detected: ${suspiciousBots.length}\n` +
          `Successfully removed: ${removedCount}\n` +
          `Failed to remove: ${suspiciousBots.length - removedCount}\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }
      
    } catch (error) {
      logger.error("Error scanning existing members:", error)
      return { response: "❌ Error scanning group members\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
    }
  },

  async handleDetectedBot(sock, groupJid, botJid, detectionMethod) {
    try {
      // CRITICAL: Final protection check before removal
      if (await this.isProtectedUser(sock, groupJid, botJid)) {
        logger.warn(`Attempted to remove protected user via handleDetectedBot, aborting: ${botJid}`)
        return
      }
      
      await sock.groupParticipantsUpdate(groupJid, [botJid], "remove")
      
      await sock.sendMessage(groupJid, {
        text: `🤖 *Bot Detected & Removed!*\n\n` +
          `👤 User: @${botJid.split('@')[0]}\n` +
          `⚡ Action: Automatically removed\n\n` +
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

  // CRITICAL: Enhanced method to check if user is protected from bot removal
  async isProtectedUser(sock, groupJid, userJid) {
    try {
      // Normalize the userJid for comparison
      const normalizedUserJid = normalizeWhatsAppId(userJid)
      const normalizedBotId = normalizeWhatsAppId(sock.user?.id)
      
      // Skip the bot itself - CRITICAL CHECK
      if (normalizedUserJid === normalizedBotId) {
        logger.info(`Protected: Bot itself - ${userJid}`)
        return true
      }
      
      
      // Additional check: Get group metadata to double-check admin status
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
      // Return true on error to be safe (don't remove if we can't verify)
      return true
    }
  },

  async detectBotFromMessage(sock, m) {
    try {
      // Check if message is explicitly marked as from a bot
      if (m.isBot) {
        logger.info(`Bot detected via isBot flag: ${m.sender}`)
        return true
      }
      
      // CRITICAL: Skip fromMe messages - these are from the bot itself, not other bots
      if (m.key?.fromMe === true) {
        return false
      }
      
      // Skip if sender is a group JID (not a user)
      if (m.sender && m.sender.endsWith('@g.us')) {
        return false
      }
      
      // Check message key structure (Baileys-specific patterns)
      if (m.key) {
        // Check if message ID follows Baileys pattern
        const messageId = m.key.id
        if (this.isBaileysMessageId(messageId)) {
          logger.info(`Bot detected via Baileys message ID: ${m.sender}`)
          return true
        }
        
        // Check if participant field exists and doesn't match sender (indicates forwarded bot message)
        if (m.key.participant && m.key.participant !== m.sender) {
          // Normalize both IDs before comparing
          const normalizedParticipant = normalizeWhatsAppId(m.key.participant)
          const normalizedSender = normalizeWhatsAppId(m.sender)
          
          // Only flag as bot if the base numbers are actually different
          if (normalizedParticipant !== normalizedSender) {
            logger.info(`Bot detected via participant mismatch: ${m.sender} (participant: ${m.key.participant})`)
            return true
          }
        }
      }
      
      return false
    } catch (error) {
      logger.error("Error detecting bot from message:", error)
      return false
    }
  },

  async detectBotFromProfile(sock, jid) {
    try {
      // REMOVED ALL PHONE NUMBER CHECKS - Too many false positives
      // Only keep the most reliable checks
      
      // Check 1: Unusual JID format (extremely rare legitimate cases)
      const phoneNumber = jid.split('@')[0].split(':')[0] // Normalize: remove both @ and :
      
      // Only flag if phone number is clearly invalid
      if (phoneNumber.length > 20 || phoneNumber.length < 8) {
        logger.info(`Invalid phone number length: ${jid}`)
        return true
      }
      
      // Check 2: Contains non-numeric characters (except for country codes)
      if (/[^0-9]/.test(phoneNumber)) {
        logger.info(`Non-numeric phone number: ${jid}`)
        return true
      }
      
      // DO NOT flag based on:
      // - Sequential numbers (many legit numbers)
      // - Repeating patterns (common in some regions)
      // - Country code patterns (too varied)
      // - Profile pictures (many users don't have them)
      
      return false
    } catch (error) {
      logger.error("Error detecting bot from profile:", error)
      return false
    }
  },

  isBaileysMessageId(messageId) {
    if (!messageId) return false
    
    // Baileys typically generates message IDs in specific patterns
    // Check for common Baileys message ID patterns (keep only most reliable)
    const baileysPatterns = [
      /^3EB[0-9A-F]{17}$/i, // Common Baileys pattern
      /^BAE[0-9A-F]{17}$/i, // Another Baileys pattern
      /^3A[0-9A-F]{18}$/i,  // Extended pattern
    ]
    
    return baileysPatterns.some(pattern => pattern.test(messageId))
  },

  // Removed unreliable detection methods:
  // - isSequentialNumber (many legitimate numbers can be sequential)
  // - hasRepeatingPattern (many legitimate numbers have patterns)
  // - Timestamp checks (can vary legitimately)
  // - Profile picture checks (many users don't set profile pictures)
  // - Country-specific number patterns (too many false positives)
}