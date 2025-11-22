import { createComponentLogger } from "../../utils/logger.js"
import { webp2mp4File } from "../../lib/converters/media-converter.js"
import { downloadMediaMessage } from "@whiskeysockets/baileys"

const logger = createComponentLogger("TO-VIDEO")

export default {
  name: "tovideo",
  aliases: ["tomp4"],
  category: "convertmenu",
  description: "Convert sticker to video",
  usage: "Reply to animated sticker with .tovideo",
  
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
      m.reply(`⏳ Converting...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      
      const media = await downloadMediaMessage(m.quoted, "buffer", {}, { logger: console })
      
      if (!media || media.length === 0) {
        return m.reply(`❌ Failed to download sticker` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }
      
      logger.info("Downloaded media, size:", media.length, "bytes")
      
      const webpToMp4 = await webp2mp4File(media)
      
      if (!webpToMp4 || !webpToMp4.result) {
        return m.reply(`❌ Conversion failed - no result URL` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }
      
      logger.info("Conversion result:", webpToMp4.result)
      
      await sock.sendMessage(m.chat, {
        video: { url: webpToMp4.result },
        caption: "✅ Converted to video"
      }, { quoted: m })
      
    } catch (error) {
      logger.error("Error converting to video:", error)
      m.reply("❌ Failed to convert: " + error.message)
    }
  }
}