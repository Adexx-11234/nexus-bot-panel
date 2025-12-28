import { createComponentLogger } from "../../utils/logger.js"
import { webp2png, getTempFilePath, cleanupTempFile } from "../../lib/converters/media-converter.js"
import { downloadMediaMessage } from "@whiskeysockets/baileys"
import fs from "fs"

const logger = createComponentLogger("TO-IMAGE")

export default {
  name: "toimage",
  aliases: ["toimg", "photo"],
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
    
    if (!isSticker) {
      return m.reply(`❌ Reply to a sticker` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    let tempFilePath = null

    try {
      m.reply(`⏳ Converting sticker to image...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)

      const media = await downloadMediaMessage(m.quoted, "buffer", {}, { 
        logger: console,
        reuploadRequest: sock.updateMediaMessage  
      })
      
      if (!media || media.length === 0) {
        return m.reply(`❌ Failed to download sticker` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }

      const pngBuffer = await webp2png(media)
      
      // Save to temp
      tempFilePath = getTempFilePath('toimage', '.png')
      fs.writeFileSync(tempFilePath, pngBuffer)
      
      await sock.sendMessage(m.chat, { 
        image: fs.readFileSync(tempFilePath),
        caption: "✅ Converted to image" + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })
      
    } catch (error) {
      logger.error("Error:", error.message)
      m.reply("❌ Failed to convert: " + error.message + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    } finally {
      if (tempFilePath) {
        cleanupTempFile(tempFilePath)
      }
    }
  }
}