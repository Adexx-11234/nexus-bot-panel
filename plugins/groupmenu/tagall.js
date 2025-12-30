import { createComponentLogger } from "../../utils/logger.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"
import { resolveLidsToJids } from "../../whatsapp/groups/index.js"

const logger = createComponentLogger("TAGALL")

export default {
  name: "TagAll",
  description: "Tag all group members",
  commands: ["tagall", "mentionall", "everyone"],
  category: "group",
  adminOnly: true,
  usage:
    "• `.tagall` - Tag all members\n• `.tagall [message]` - Tag all with custom message",

  async execute(sock, sessionId, args, m) {
    const groupJid = m.chat

    if (!m.isGroup) {
      return { response: "❌ This command can only be used in groups!" + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }
    }

    // Check if user is admin
    const adminChecker = new AdminChecker()
    const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
    if (!isAdmin) {
      return { response: "❌ Only group admins can use this command!" + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }
    }

    try {
      // Get group metadata
      let groupMetadata
      try {
        groupMetadata = await sock.groupMetadata(groupJid)
      } catch (error) {
        logger.error("[TagAll] Error getting group metadata:", error.message)
        return { response: "❌ Unable to get group information!" + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }
      }

      // Get participants
      let participants = groupMetadata?.participants || []
      
      if (participants.length === 0) {
        return { response: "❌ No participants found in this group!" + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }
      }

      // Get custom message or default
      const customMessage = args.length ? args.join(" ") : "no message"
      
      // Get sender's phone number
      const senderNumber = m.sender.split('@')[0]
      
      // ✅ CRITICAL FIX: Resolve LIDs to proper JIDs
      // whiskeysockets sometimes returns participants with @lid instead of @s.whatsapp.net
      const participantIds = participants.map(p => p.id)
      const resolvedIds = await resolveLidsToJids(sock, groupJid, participantIds)
      
      logger.debug(`[TagAll] Resolved ${participantIds.length} participant IDs (LIDs -> JIDs)`)
      
      // Build the tag message
      let tagMessage = `╚»˙·٠🎯●♥  ♥●🎯٠·˙«╝\n`
      tagMessage += `😶 Tagger: @${senderNumber}\n`
      tagMessage += `🌿 Message: ${customMessage}\n\n`
      
      // Add all participants in a list format using resolved JIDs
      resolvedIds.forEach((jid, index) => {
        const phoneNumber = jid.split('@')[0].split(':')[0]  // Remove device suffix if present
        tagMessage += `${index + 1}. @${phoneNumber}\n`
      })

      tagMessage += `\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      
      // ✅ Use resolved IDs for mentions
      const mentions = resolvedIds
      // Add sender to mentions
      mentions.push(m.sender)

      logger.info(`[TagAll] Tagging ${mentions.length - 1} members in ${groupJid} with proper JIDs`)

      // Send the tag message
      await sock.sendMessage(groupJid, {
        text: tagMessage,
        mentions: mentions
      }, { quoted: m })

      logger.info(`[TagAll] Successfully tagged ${mentions.length - 1} members`)
      
      // Return success (no additional response needed since we already sent the message)
      return { response: null, success: true }

    } catch (error) {
      logger.error("[TagAll] Error in tagall command:", error)
      return { response: `❌ Failed to tag all members! Error: ${error.message}` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }
    }
  },

  // Helper method to get participant count
  async getParticipantCount(sock, groupJid) {
    try {
      const groupMetadata = await sock.groupMetadata(groupJid)
      return groupMetadata?.participants?.length || 0
    } catch (error) {
      logger.error(`[TagAll] Error getting participant count: ${error.message}`)
      return 0
    }
  },

  // Helper method to check if group has participants
  async hasParticipants(sock, groupJid) {
    try {
      const count = await this.getParticipantCount(sock, groupJid)
      return count > 0
    } catch (error) {
      logger.error(`[TagAll] Error checking participants: ${error.message}`)
      return false
    }
  }
}