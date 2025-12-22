import { createComponentLogger } from "../../utils/logger.js"
import { GroupQueries, ViolationQueries } from "../../database/query.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("ANTI-PROMOTE")

export default {
  name: "Anti-Promote",
  description: "Prevent unauthorized promotions in the group",
  commands: ["antipromote"],
  category: "group",
  adminOnly: true,
  usage:
    "• `.antipromote on` - Enable anti-promote protection\n• `.antipromote off` - Disable protection\n• `.antipromote status` - Check protection status",

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
        await GroupQueries.setAntiCommand(groupJid, "antipromote", true)
        return {
          response:
            "🛡️ *Anti-promote protection enabled!*\n\n" +
            "✅ Unauthorized promotions will be reverted\n" +
            "👑 Only group owner can promote new admins\n" +
            "🛡️ New members promoted will be automatically demoted"
        }

      case "off":
        await GroupQueries.setAntiCommand(groupJid, "antipromote", false)
        return { response: "🛡️ Anti-promote protection disabled." }

      case "status":
        const status = await GroupQueries.isAntiCommandEnabled(groupJid, "antipromote")
        return {
          response: `🛡️ *Anti-Promote Status*\n\nStatus: ${status ? "✅ Enabled" : "❌ Disabled"}`
        }

      default:
        const currentStatus = await GroupQueries.isAntiCommandEnabled(groupJid, "antipromote")
        return {
          response:
            "🛡️ *Anti-Promote Commands*\n\n" +
            "• `.antipromote on` - Enable protection\n" +
            "• `.antipromote off` - Disable protection\n" +
            "• `.antipromote status` - Check status\n\n" +
            `*Current Status:* ${currentStatus ? "✅ Enabled" : "❌ Disabled"}`
        }
    }
  } catch (error) {
    logger.error("Error in antipromote command:", error)
    return { response: "❌ Error managing anti-promote settings" }
  }
},

  async isEnabled(groupJid) {
    try {
      return await GroupQueries.isAntiCommandEnabled(groupJid, "antipromote")
    } catch (error) {
      logger.error("Error checking if antipromote enabled:", error)
      return false
    }
  },

async shouldProcess(m) {
  // This method should check if we should process any message/update for this plugin
  return true // Always return true to allow processing of participant updates
},

  async processParticipantUpdate(sock, sessionId, update) {
    try {
      if (update.action === 'promote' && await this.isEnabled(update.jid)) {
        await this.handlePromotion(sock, sessionId, update)
      }
    } catch (error) {
      logger.error("Error processing participant update:", error)
    }
  },

async handlePromotion(sock, sessionId, update) {
  try {
    const adminChecker = new AdminChecker()
    const groupJid = update.jid
    const promotedUser = update.participants[0]
    
    // Fix: More robust actor extraction
    let actor = update.actor || update.author
    if (!actor && update.key?.participant) {
      actor = update.key.participant
    }
    if (!actor && update.key?.fromMe === false && update.key?.remoteJid) {
      // If we can't determine actor, skip the check for safety
      logger.warn("Could not determine who performed the promotion, skipping anti-promote")
      return
    }
    
    // Skip if bot is not admin
    const botIsAdmin = await adminChecker.isBotAdmin(sock, groupJid)
    if (!botIsAdmin) return
    
    // Get group metadata to check owner
    const metadata = await sock.groupMetadata(groupJid)
    const groupOwner = metadata.owner
    
    // Allow if promoted by owner or bot itself
    const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net'
    if (actor === groupOwner || actor === botJid) {
      return
    }
    
    // Check if promoted user is new (joined recently)
    const isNewUser = await this.isNewMember(groupJid, promotedUser)
    
    if (isNewUser) {
      // Demote the user immediately
      await sock.groupParticipantsUpdate(groupJid, [promotedUser], "demote")
      
      // Notify group
      await sock.sendMessage(groupJid, {
        text: `🛡️ *Unauthorized Promotion Blocked!*\n\n` +
              `👤 @${actor.split("@")[0]} tried to promote a new member\n` +
              `❌ Promotion reverted for security reasons\n\n` +
              `💡 Only group owner can promote new members.

> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        mentions: [actor]
      })
      
      // Log the violation
      await ViolationQueries.logViolation(
        groupJid,
        actor,
        "antipromote",
        `Tried to promote new user @${promotedUser.split("@")[0]}`,
        { promotedUser: promotedUser },
        "demote_revert",
        0,
        null
      )
    }
  } catch (error) {
    logger.error("Error handling promotion:", error)
  }
},

async isNewMember(groupJid, userJid, hoursThreshold = 24) {
  try {
    // Query your database for when this user joined the group
    const { GroupQueries } = await import("../../database/query.js")
    
    const joinTime = await GroupQueries.getUserJoinTime(groupJid, userJid)
    if (!joinTime) {
      // If no join time found, assume they're new for safety
      return true
    }
    
    const joinTimestamp = new Date(joinTime).getTime()
    const currentTime = Date.now()
    const timeDifference = currentTime - joinTimestamp
    const hoursAgo = timeDifference / (1000 * 60 * 60) // Changed to hours
    
    return hoursAgo <= hoursThreshold
  } catch (error) {
    logger.error("Error checking if user is new member:", error)
    // Assume new for safety if check fails
    return true
  }
}
}