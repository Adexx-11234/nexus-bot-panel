import { createComponentLogger } from "../../utils/logger.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("HIDETAG")

export default {
  name: "HideTag",
  description: "Send a message that tags everyone without showing the tags",
  commands: ["hidetag", "h", "ht", "hiddentag", "tag"],
  category: "group",
  adminOnly: true,
  usage:
    "• `.hidetag [message]` - Send hidden tag message\n" +
    "• `.hidetag` (reply to message) - Forward message with hidden tags\n" +
    "• `.tag .tag .tag ... [message]` - Send message N times (200ms delay)",

  async execute(sock, sessionId, args, m) {
    const groupJid = m.chat

    if (!m.isGroup) {
      return { response: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
    }

    const normalizeJid = (jid) => {
      if (!jid) return ''
      return jid.split('@')[0].split(':')[0] + '@s.whatsapp.net'
    }

    const adminChecker = new AdminChecker()
    const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)
    
    const botJid = normalizeJid(sock.user.id)
    const senderJid = normalizeJid(m.sender)
    const isBotOwner = botJid === senderJid
    
    if (!isAdmin && !isBotOwner) {
      return { response: "❌ Only group admins or bot owner can use this command!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
    }

    try {
      let groupMetadata
      try {
        groupMetadata = await sock.groupMetadata(groupJid)
      } catch (error) {
        logger.error("[HideTag] Error getting group metadata:", error.message)
        return { response: "❌ Unable to get group information!" }
      }

      const participants = groupMetadata?.participants || []
      
      if (participants.length === 0) {
        return { response: "❌ No participants found in this group!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
      }

      const mentions = participants.map(participant => participant.id)
      
      if (m.quoted) {
        const quotedMsg = m.quoted
        
        if (quotedMsg.message?.pollCreationMessage || quotedMsg.message?.pollCreationMessageV3) {
          return { 
            response: "ℹ️ To tag everyone with a poll, use `.tagpoll` instead!\n\n" +
                     "Reply to the poll with `.tagpoll` or create a new one:\n" +
                     "`.tagpoll question, option1, option2`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
          }
        }
        
        if (quotedMsg.message?.imageMessage) {
          const media = await sock.downloadMedia(quotedMsg)
          await sock.sendMessage(groupJid, { image: media, caption: quotedMsg.message.imageMessage.caption || '\u200E', mentions })
        } else if (quotedMsg.message?.videoMessage) {
          const media = await sock.downloadMedia(quotedMsg)
          await sock.sendMessage(groupJid, { video: media, caption: quotedMsg.message.videoMessage.caption || '\u200E', mentions })
        } else if (quotedMsg.message?.audioMessage) {
          const media = await sock.downloadMedia(quotedMsg)
          await sock.sendMessage(groupJid, { audio: media, mimetype: quotedMsg.message.audioMessage.mimetype, mentions })
        } else if (quotedMsg.message?.documentMessage) {
          const media = await sock.downloadMedia(quotedMsg)
          await sock.sendMessage(groupJid, { document: media, mimetype: quotedMsg.message.documentMessage.mimetype, fileName: quotedMsg.message.documentMessage.fileName, caption: quotedMsg.message.documentMessage.caption || '\u200E', mentions })
        } else if (quotedMsg.message?.stickerMessage) {
          const media = await sock.downloadMedia(quotedMsg)
          await sock.sendMessage(groupJid, { sticker: media, mentions })
        } else {
          const quotedText = quotedMsg.text || quotedMsg.body || quotedMsg.message?.conversation || '\u200E'
          await sock.sendMessage(groupJid, { text: quotedText, mentions })
        }
        return { response: null, success: true }
      }

      if (args.length === 0) {
        return { response: "❌ Please provide a message or reply to a message to tag!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
      }

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

      // Count .tag/.hidetag/.h/.ht repeats at the beginning
      const tagMatch = fullText.match(/^((?:\.(?:hidetag|h|ht|hiddentag|tag)\s+)+)(.+)$/s)
      
      let repetitions = 1
      let message = ''
      
      if (tagMatch) {
        const tagPart = tagMatch[1]
        const messagePart = tagMatch[2]
        
        // Count exact number of tag commands
        const tagCount = (tagPart.match(/\.(?:hidetag|h|ht|hiddentag|tag)/g) || []).length
        
        // Logic: 1 tag = 1x, 2 tags = 2x, 3 tags = 99x, 4 tags = 198x, etc.
        if (tagCount >= 3) {
          repetitions = 20 * (tagCount - 2)  // 3 tags = 99*1, 4 tags = 99*2, 5 tags = 99*3, etc.
        } else {
          repetitions = tagCount  // 1 tag = 1x, 2 tags = 2x
        }
        
        message = messagePart
      } else {
        // Single command
        const singleMatch = fullText.match(/^\.(?:hidetag|h|ht|hiddentag|tag)\s+(.+)$/s)
        message = singleMatch ? singleMatch[1] : args.join(' ')
      }

      if (!message || message.trim() === '') {
        return { response: "❌ Please provide a message to tag!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" }
      }

      // Send message N times with 200ms delay
      logger.info(`[HideTag] Sending message ${repetitions} times with 200ms delay`)
      
      for (let i = 0; i < repetitions; i++) {
        await sock.sendMessage(groupJid, { text: message, mentions }, { quoted: m })
        
        // 200ms delay between sends (except after last message)
        if (i < repetitions - 1) {
          await new Promise(resolve => setTimeout(resolve, 300))
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