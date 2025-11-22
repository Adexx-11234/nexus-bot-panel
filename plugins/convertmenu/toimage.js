import { createComponentLogger } from "../../utils/logger.js"
import { webp2png } from "../../lib/converters/media-converter.js"
import { downloadMediaMessage } from "@whiskeysockets/baileys"

const logger = createComponentLogger("TO-IMAGE")

export default {
  name: "toimage",
  aliases: ["toimg"],
  category: "convertmenu",
  description: "Convert sticker to image",
  usage: "Reply to sticker with .toimage",

  async execute(sock, sessionId, args, m) {
    if (!m.quoted) {
      return m.reply(`❌ Reply to a sticker` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    const quotedMsg = m.quoted
    const quotedMessage = quotedMsg.message
    
    const isSticker = quotedMessage?.stickerMessage || quotedMsg.type === 'sticker'
    const mime = quotedMsg.mimetype || ""
    const isStickerMime = /webp/.test(mime) || mime.includes("image/webp")
    
    if (!isSticker && !isStickerMime) {
      logger.info("Not a sticker. Type:", quotedMsg.type, "Mimetype:", mime)
      return m.reply(`❌ Reply to a sticker (not an image or video)` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    try {
      m.reply(`⏳ Converting sticker to image...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)

      const media = await downloadMediaMessage(m.quoted, "buffer", {}, { logger: console })
      
      if (!media || media.length === 0) {
        return m.reply(`❌ Failed to download sticker` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }

      // Convert WebP to PNG using ffmpeg
      const pngBuffer = await webp2png(media)
      
      await sock.sendMessage(m.chat, { 
        image: pngBuffer,
        caption: "✅ Converted to image"
      }, { quoted: m })
      
    } catch (error) {
      logger.error("Error converting to image:", error)
      m.reply("❌ Failed to convert sticker to image: " + error.message)
    }
  }
}