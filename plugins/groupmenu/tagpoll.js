import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("TAGPOLL")

export default {
  name: "TagPoll",
  description: "Create polls that tag all group members",
  commands: ["tagpoll", "tpoll", "pollmention"],
  category: "groupmenu",
        permissions: {
  adminRequired: true,      // User must be group admin (only applies in groups)
  botAdminRequired: true,   // Bot must be group admin (only applies in groups)
  groupOnly: true,          // Can only be used in groups
},
  usage:
    "• `.tagpoll question, option1, option2, option3` - Create poll with hidden tags\n" +
    "• `.tagpoll` (reply to poll) - Re-send poll with hidden tags\n" +
    "• Question and options separated by commas\n" +
    "• Minimum 2 options required",

  async execute(sock, sessionId, args, m) {
    const groupJid = m.chat

    try {
      // Get group metadata
      let groupMetadata
      try {
        groupMetadata = await sock.groupMetadata(groupJid)
      } catch (error) {
        logger.error("[TagPoll] Error getting group metadata:", error.message)
        return { response: "❌ Unable to get group information!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
      }

      // Get participants
      const participants = groupMetadata?.participants || []
      
      if (participants.length === 0) {
        return { response: "❌ No participants found in this group!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
      }

      // Prepare mentions array
      const mentions = participants.map(participant => participant.id)
      
      // **HANDLE QUOTED POLL MESSAGES**
      if (m.quoted) {
        const quotedMsg = m.quoted
        
        // Check for pollCreationMessage (v2)
        if (quotedMsg.message?.pollCreationMessage) {
          const pollMsg = quotedMsg.message.pollCreationMessage
          
          await sock.sendMessage(groupJid, {
            poll: {
              name: pollMsg.name,
              values: pollMsg.options?.map(opt => opt.optionName) || [],
              selectableCount: pollMsg.selectableOptionsCount || 1
            },
            mentions: mentions
          })
          
          logger.info("[TagPoll] Re-sent poll (v2) with hidden tags")
          return { response: null, success: true }
        }
        
        // Check for pollCreationMessageV3 - FIX FOR EMPTY POLL
        if (quotedMsg.message?.pollCreationMessageV3) {
          const pollMsg = quotedMsg.message.pollCreationMessageV3
          
          // Extract options correctly from V3 format
          const pollOptions = pollMsg.options?.map(opt => opt.optionName) || []
          
          if (pollOptions.length === 0) {
            return { response: "❌ Could not extract poll options from quoted message!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
          }
          
          await sock.sendMessage(groupJid, {
            poll: {
              name: pollMsg.name,
              values: pollOptions,
              selectableCount: pollMsg.selectableOptionsCount || 1
            },
            mentions: mentions
          })
          
          logger.info("[TagPoll] Re-sent poll (v3) with hidden tags")
          return { response: null, success: true }
        }
        
        return { response: "❌ Please reply to a valid poll message!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
      }

      // **CREATE NEW POLL FROM COMMAND**
      if (args.length === 0) {
        return { 
          response: "❌ Please provide poll details!\n\n" +
                   "Format: `.tagpoll question, option1, option2, option3`\n" +
                   "Example: `.tagpoll Should we play a game, Yes, No, Maybe`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }
      }

      // Extract full text
      let fullText = ''
      
      if (m.command?.fullText) {
        fullText = m.command.fullText
      } else if (m.command?.raw) {
        fullText = `.${m.command.name} ${m.command.raw}`
      } else if (m.message?.extendedTextMessage?.text) {
        fullText = m.message.extendedTextMessage.text
      } else if (m.message?.conversation) {
        fullText = m.message.conversation
      } else if (m.body || m.text) {
        fullText = m.body || m.text
      }

      // Remove command from text
      const message = fullText.replace(/^\.(?:tagpoll|tpoll|pollmention)\s+/i, '').trim()

      if (!message || message.trim() === '') {
        return { 
          response: "❌ Please provide poll details!\n\n" +
                   "Format: `.tagpoll question, option1, option2, option3`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }
      }

      // Parse poll question and options
      const parts = message.split(',').map(part => part.trim()).filter(part => part.length > 0)
      
      if (parts.length < 3) {
        return { 
          response: "❌ Please provide a question and at least 2 options!\n\n" +
                   "Format: `.tagpoll question, option1, option2`\n" +
                   "Example: `.tagpoll What's your favorite color, Red, Blue, Green`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
        }
      }

      const pollQuestion = parts[0]
      const pollOptions = parts.slice(1)

      if (pollOptions.length > 12) {
        return { response: "❌ Maximum 12 poll options allowed!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
      }

      // Send poll with hidden tags
      await sock.sendMessage(groupJid, {
        poll: {
          name: pollQuestion,
          values: pollOptions,
          selectableCount: 1
        },
        mentions: mentions
      }, { quoted: m })
      
      logger.info("[TagPoll] Poll sent successfully")
      return { response: null, success: true }

    } catch (error) {
      logger.error("[TagPoll] Error:", error)
      return { response: `❌ Failed to create poll! Error: ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }
    }
  }
}