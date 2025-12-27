import { createComponentLogger } from "../../utils/logger.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("HIDETAG")

export default {
  name: "HideTag",
  description: "Send a message that tags everyone without showing the tags",
  commands: ["hidetag", "h", "ht", "hiddentag", "tag"],
  category: "group",
      permissions: {
        ownerOnly: true, // Only bot owner can use this command
  groupOnly: true,          // Can only be used in groups
},
  usage:
    "• `.hidetag [message]` - Send hidden tag message\n" +
    "• `.hidetag` (reply to message) - Forward message with hidden tags\n" +
    "• `.tag .tag .tag [message]` - Send message multiple times (up to 30x)",

  async execute(sock, sessionId, args, m) {
    const groupJid = m.chat

    if (!m.isGroup) {
      return { response: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
    }


    try {
      // Get group metadata
      let groupMetadata
      try {
        groupMetadata = await sock.groupMetadata(groupJid)
      } catch (error) {
        logger.error("[HideTag] Error getting group metadata:", error.message)
        return { response: "❌ Unable to get group information!" }
      }

      // Get participants
      const participants = groupMetadata?.participants || []
      
      if (participants.length === 0) {
        return { response: "❌ No participants found in this group!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
      }

      // Prepare mentions array
      const mentions = participants.map(participant => participant.id)
      
      // **HANDLE QUOTED MESSAGES**
      if (m.quoted) {
        const quotedMsg = m.quoted
        
        // Redirect to tagpoll if user replies to a poll
        if (quotedMsg.message?.pollCreationMessage || quotedMsg.message?.pollCreationMessageV3) {
          return { 
            response: "ℹ️ To tag everyone with a poll, use `.tagpoll` instead!\n\n" +
                     "Reply to the poll with `.tagpoll` or create a new one:\n" +
                     "`.tagpoll question, option1, option2`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
          }
        }
        
        
        // Handle media messages
if (quotedMsg.message?.imageMessage) {
  const media = await sock.downloadMedia(quotedMsg)
  await sock.sendMessage(groupJid, {
    image: media,
    caption: quotedMsg.message.imageMessage.caption || '\u200E',
    mentions: mentions
  })
} else if (quotedMsg.message?.videoMessage) {
  const media = await sock.downloadMedia(quotedMsg)
  await sock.sendMessage(groupJid, {
    video: media,
    caption: quotedMsg.message.videoMessage.caption || '\u200E',
    mentions: mentions
  })
} else if (quotedMsg.message?.audioMessage) {
  const media = await sock.downloadMedia(quotedMsg)
  await sock.sendMessage(groupJid, {
    audio: media,
    mimetype: quotedMsg.message.audioMessage.mimetype,
    mentions: mentions
  })
} else if (quotedMsg.message?.documentMessage) {
  const media = await sock.downloadMedia(quotedMsg)
  await sock.sendMessage(groupJid, {
    document: media,
    mimetype: quotedMsg.message.documentMessage.mimetype,
    fileName: quotedMsg.message.documentMessage.fileName,
    caption: quotedMsg.message.documentMessage.caption || '\u200E',
    mentions: mentions
  })
} else if (quotedMsg.message?.stickerMessage) {
  const media = await sock.downloadMedia(quotedMsg)
  await sock.sendMessage(groupJid, {
    sticker: media,
    mentions: mentions
  })
} else {
  // Text message - preserve original formatting
  const quotedText = quotedMsg.text || quotedMsg.body || quotedMsg.message?.conversation || '\u200E'
  await sock.sendMessage(groupJid, {
    text: quotedText,
    mentions: mentions
  })
}
        return { response: null, success: true }
      }

      // No quoted message - parse command and message
      if (args.length === 0) {
        return { response: "❌ Please provide a message or reply to a message to tag!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
      }

      // Extract full text - preserve original message format
      let fullText = ''
      
      if (m.command?.fullText) {
        fullText = m.command.fullText
      } else if (m.message?.extendedTextMessage?.text) {
        fullText = m.message.extendedTextMessage.text
      } else if (m.message?.conversation) {
        fullText = m.message.conversation
      } else if (m.body || m.text) {
        fullText = m.body || m.text
      } else if (m.command?.raw) {
        fullText = `.${m.command.name} ${m.command.raw}`
      }

      // Count command repetitions and extract message
      const commandPattern = /^((?:\.(?:hidetag|h|ht|hiddentag|tag)\s*)+)(.+)$/s
      const match = fullText.match(commandPattern)
      
      let repetitions = 1
      let message = ''
      
      if (match) {
        const commandPart = match[1]
        const messagePart = match[2]
        
        const commandCount = (commandPart.match(/\.(?:hidetag|h|ht|hiddentag|tag)/g) || []).length
        
        repetitions = commandCount >= 3 ? 30 : commandCount
        message = messagePart // Don't trim - preserve original formatting
      } else {
        // Single command - extract everything after the command
        const singleCommandMatch = fullText.match(/^\.(?:hidetag|h|ht|hiddentag|tag)\s+(.+)$/s)
        if (singleCommandMatch) {
          message = singleCommandMatch[1] // Preserve original formatting
        } else {
          // Fallback to args join, but this shouldn't happen normally
          message = args.join(' ')
        }
      }

      if (!message || message.trim() === '') {
        return { response: "❌ Please provide a message to tag!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
      }

      
      // Send message multiple times
      for (let i = 0; i < repetitions; i++) {
        const messageOptions = {
          text: message,
          mentions: mentions
        }
        
        await sock.sendMessage(groupJid, messageOptions, { quoted: m })
        
        if (i < repetitions - 1) {
          await new Promise(resolve => setTimeout(resolve, 20))
        }
      }

      return { response: null, success: true }

    } catch (error) {
      logger.error("[HideTag] Error:", error)
      return { response: `❌ Failed to send hidden tag message! Error: ${error.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙` }
    }
  },

  extractLinks(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/gi
    return text.match(urlRegex) || []
  }
}