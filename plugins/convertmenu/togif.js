import { createComponentLogger } from "../../utils/logger.js"
import { webp2mp4File } from "../../lib/converters/media-converter.js"
import { downloadMediaMessage } from "@whiskeysockets/baileys"

const logger = createComponentLogger("TO-GIF")

export default {
  name: "togif",
  aliases: [],
  category: "convertmenu",
  description: "Convert animated sticker to GIF",
  usage: "Reply to animated sticker with .togif",

  async execute(sock, sessionId, args, m) {
    if (!m.quoted) {
      return m.reply(`❌ Reply to an animated sticker` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    const quotedMsg = m.quoted
    const quotedMessage = quotedMsg.message
    
    const isSticker = quotedMessage?.stickerMessage || quotedMsg.type === 'sticker'
    const mime = quotedMsg.mimetype || ""
    const isStickerMime = /webp/.test(mime) || mime.includes("image/webp")
    
    if (!isSticker && !isStickerMime) {
      return m.reply(`❌ Reply to an animated sticker` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    try {
      m.reply(`⏳ Converting to GIF...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)

      const media = await downloadMediaMessage(m.quoted, "buffer", {}, { logger: console })
      
      // Convert to MP4
      const videoBuffer = await webp2mp4File(media)
      
      // Send as GIF (with gifPlayback enabled)
      await sock.sendMessage(m.chat, {
        video: videoBuffer,
        caption: "✅ Converted to GIF",
        gifPlayback: true
      }, { quoted: m })
      
    } catch (error) {
      logger.error("Error converting to GIF:", error)
      m.reply("❌ Failed to convert: " + error.message)
    }
  }
}