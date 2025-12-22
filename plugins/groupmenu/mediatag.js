import { createComponentLogger } from "../../utils/logger.js"
import AdminChecker from "../../whatsapp/utils/admin-checker.js"

const logger = createComponentLogger("MEDIA-TAG")

export default {
  name: "Media Tag",
  description: "Tag all members with a media message",
  commands: ["mediatag"],
  category: "group",
  adminOnly: true,
  usage: "• `.mediatag` - Tag all members with a media message\n• Reply to a media message with this command",

  async execute(sock, sessionId, args, m) {
    const groupJid = m.chat

    if (!m.isGroup) {
      await sock.sendMessage(groupJid, {
        text: "❌ This command can only be used in groups!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
      return
    }

    try {
      const adminChecker = new AdminChecker()
      const isAdmin = await adminChecker.isGroupAdmin(sock, groupJid, m.sender)

      if (!isAdmin) {
        await sock.sendMessage(groupJid, {
          text: "❌ Only admins can use this command!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Check if message is a reply to media
      const quoted = m.quoted
      if (!quoted || !this.isMediaMessage(quoted)) {
        await sock.sendMessage(groupJid, {
          text: "❌ Please reply to a media message (image, video, audio, document) with this command.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Get all group participants
      const metadata = await sock.groupMetadata(groupJid)
      const participants = metadata.participants

      if (participants.length === 0) {
        await sock.sendMessage(groupJid, {
          text: "❌ No members found in this group.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Extract media from quoted message
      const mediaType = this.getMediaType(quoted)
      const mediaBuffer = await this.downloadMedia(sock, quoted)
      
      if (!mediaBuffer) {
        await sock.sendMessage(groupJid, {
          text: "❌ Failed to download media. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return
      }

      // Create caption with mentions
      const caption = `📢 *Media Tag!* 📢\n\n` +
                     `👥 Tagging all ${participants.length} members\n` +
                     `📤 Shared by: @${m.sender.split('@')[0]}\n\n` +
                     `💡 This is a media tag notification!`

      // Prepare media message
      const mediaMessage = {
        [mediaType]: mediaBuffer,
        caption: caption,
        mentions: participants.map(p => p.jid)
      }

      // Send media message
      await sock.sendMessage(groupJid, mediaMessage, { quoted: m })

    } catch (error) {
      logger.error("Error in mediatag command:", error)
      await sock.sendMessage(groupJid, {
        text: "❌ Error sending media tag. Make sure bot is admin.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
    }
  },

  isMediaMessage(message) {
    return (
      message.message?.imageMessage ||
      message.message?.videoMessage ||
      message.message?.audioMessage ||
      message.message?.documentMessage
    )
  },

  getMediaType(message) {
    if (message.message?.imageMessage) return "image"
    if (message.message?.videoMessage) return "video"
    if (message.message?.audioMessage) return "audio"
    if (message.message?.documentMessage) return "document"
    return null
  },

  async downloadMedia(sock, message) {
    try {
      let mediaType = this.getMediaType(message)
      if (!mediaType) return null

      const mediaKey = message.message[`${mediaType}Message`]
      const stream = await sock.downloadMediaMessage(message)
      
      return Buffer.from(await stream.arrayBuffer())
    } catch (error) {
      logger.error("Error downloading media:", error)
      return null
    }
  }
}