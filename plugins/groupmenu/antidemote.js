import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, WarningQueries, ViolationQueries } from "../../database/query.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("ANTI-DEMOTE")

// Track demote attempts per user
const demoteAttempts = new Map()

export default {
  name: "Anti-Demote",
  description: "Prevent unauthorized demotions in the group",
  commands: ["antidemote"],
  category: "group",
  adminOnly: true,
  usage:
    "• `.antidemote on` - Enable anti-demote protection\n• `.antidemote off` - Disable protection\n• `.antidemote status` - Check protection status",

  async execute(sock, sessionId, args, m) {
    const action = args[0]?.toLowerCase()
    const groupJid = m.chat

    if (!m.isGroup) {
      return { response: "❌ This command can only be used in groups!" }
    }

    // Check if user is admin
    const adminChecker = new AdminChecker()
    const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
    if (!isAdmin) {
      return { response: "❌ Only group admins can use this command!" }
    }

    try {
      switch (action) {
        case "on":
          await GroupQueries.setAntiCommand(groupJid, "antidemote", true)
          return {
            response:
              "🛡️ *Anti-demote protection enabled!*\n\n" +
              "✅ Unauthorized demotions will be reverted\n" +
              "👑 Only group owner and trusted admins can demote\n" +
              "🔒 Multiple attempts will result in removal"
          }

        case "off":
          await GroupQueries.setAntiCommand(groupJid, "antidemote", false)
          return { response: "🛡️ Anti-demote protection disabled." }

        case "status":
          const status = await GroupQueries.isAntiCommandEnabled(groupJid, "antidemote")
          return {
            response: `🛡️ *Anti-Demote Status*\n\nStatus: ${status ? "✅ Enabled" : "❌ Disabled"}`
          }

        default:
          const currentStatus = await GroupQueries.isAntiCommandEnabled(groupJid, "antidemote")
          return {
            response:
              "🛡️ *Anti-Demote Commands*\n\n" +
              "• `.antidemote on` - Enable protection\n" +
              "• `.antidemote off` - Disable protection\n" +
              "• `.antidemote status` - Check status\n\n" +
              `*Current Status:* ${currentStatus ? "✅ Enabled" : "❌ Disabled"}`
          }
      }
    } catch (error) {
      logger.error("Error in antidemote command:", error)
      return { response: "❌ Error managing anti-demote settings" }
    }
  },

  async isEnabled(groupJid) {
    try {
      return await GroupQueries.isAntiCommandEnabled(groupJid, "antidemote")
    } catch (error) {
      logger.error("Error checking if antidemote enabled:", error)
      return false
    }
  },

  async shouldProcess(m) {
    // This method should check if we should process any message/update for this plugin
    return true // Always return true to allow processing of participant updates
  },

  async processParticipantUpdate(sock, sessionId, update) {
    try {
      if (update.action === 'demote' && await this.isEnabled(update.jid)) {
        await this.handleDemotion(sock, sessionId, update)
      }
    } catch (error) {
      logger.error("Error processing participant update:", error)
    }
  },

  async handleDemotion(sock, sessionId, update) {
    try {
      const adminChecker = new AdminChecker()
      const groupJid = update.jid
      const demotedUser = update.participants[0]
      
      // Fix: More robust actor extraction (matching antipromote pattern)
      let actor = update.actor || update.author
      if (!actor && update.key?.participant) {
        actor = update.key.participant
      }
      if (!actor && update.key?.fromMe === false && update.key?.remoteJid) {
        // If we can't determine actor, skip the check for safety
        logger.warn("Could not determine who performed the demotion, skipping anti-demote")
        return
      }
      
      // Skip if bot is not admin
      const botIsAdmin = await adminChecker.isBotAdmin(sock, groupJid)
      if (!botIsAdmin) return
      
      // Get group metadata to check owner
      const metadata = await sock.groupMetadata(groupJid)
      const groupOwner = metadata.owner
      
      // Allow if demoted by owner or bot itself
      const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net'
      if (actor === groupOwner || actor === botJid) {
        return
      }
      
      // Check if actor is a new admin
      const isNewAdmin = await this.isNewAdmin(groupJid, actor)
      
      if (isNewAdmin) {
        // Promote the user back immediately
        await sock.groupParticipantsUpdate(groupJid, [demotedUser], "promote")
        
        // Track demote attempts
        const attemptKey = `${groupJid}:${actor}`
        const attempts = (demoteAttempts.get(attemptKey) || 0) + 1
        demoteAttempts.set(attemptKey, attempts)
        
        if (attempts >= 3) {
          // Remove the user after 3 attempts
          await sock.groupParticipantsUpdate(groupJid, [actor], "remove")
          
          // Lock the group (only admins can send messages)
          await sock.groupSettingUpdate(groupJid, 'announcement')
          
          await sock.sendMessage(groupJid, {
            text: `🛡️ *Multiple Unauthorized Demote Attempts!*\n\n` +
                  `👤 @${actor.split("@")[0]} attempted multiple demotions\n` +
                  `❌ User removed and group locked for security\n\n` +
                  `🔒 Group is now in admin-only mode for protection.

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            mentions: [actor]
          })
          
          // Reset attempts
          demoteAttempts.delete(attemptKey)
        } else {
          // Warn the user
          await sock.sendMessage(groupJid, {
            text: `🛡️ *Unauthorized Demote Blocked!*\n\n` +
                  `👤 @${actor.split("@")[0]} attempted to demote an admin\n` +
                  `✅ Demotion reverted for security reasons\n` +
                  `⚠️ Attempt ${attempts}/3 - Next attempt will result in removal\n\n` +
                  `💡 Only trusted admins should perform demotions.

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            mentions: [actor]
          })
        }
        
        // Log the violation
        await ViolationQueries.logViolation(
          groupJid,
          actor,
          "antidemote",
          `Attempted to demote @${demotedUser.split("@")[0]} (attempt ${attempts})`,
          { demotedUser: demotedUser, attempts: attempts },
          attempts >= 3 ? "kick" : "warning",
          attempts,
          null
        )
      }
    } catch (error) {
      logger.error("Error handling demotion:", error)
    }
  },

  async isNewAdmin(groupJid, userJid, hoursThreshold = 24) {
    try {
      // Query your database for when this user was promoted to admin
      const { GroupQueries } = await import("../../database/query.js")
      
      const promoteTime = await GroupQueries.getUserPromoteTime(groupJid, userJid)
      if (!promoteTime) {
        // If no promote time found, assume they're new for safety
        return true
      }
      
      const promoteTimestamp = new Date(promoteTime).getTime()
      const currentTime = Date.now()
      const timeDifference = currentTime - promoteTimestamp
      const hoursAgo = timeDifference / (1000 * 60 * 60)
      
      return hoursAgo <= hoursThreshold
    } catch (error) {
      logger.error("Error checking if user is new admin:", error)
      // Assume new for safety if check fails
      return true
    }
  }
}