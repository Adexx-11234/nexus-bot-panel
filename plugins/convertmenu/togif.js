import { createComponentLogger } from "../../utils/logger.js"
import { webp2mp4File, getTempFilePath, cleanupTempFile } from "../../lib/converters/media-converter.js"
import { downloadMediaMessage } from "@whiskeysockets/baileys"
import fs from "fs"

const logger = createComponentLogger("TO-GIF")

export default {
  name: "togif",
  aliases: [],
  category: "convertmenu",
  description: "Convert animated sticker to GIF",
  usage: "Reply to animated sticker with .togif",
  permissions: {
  // All false = public command, no restrictions
},

  async execute(sock, sessionId, args, m) {
    if (!m.quoted) {
      return m.reply(`❌ Reply to an animated sticker` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    const quotedMsg = m.quoted
    const quotedMessage = quotedMsg.message
    
    const isSticker = quotedMessage?.stickerMessage || quotedMsg.type === 'sticker'
    
    if (!isSticker) {
      return m.reply(`❌ Reply to an animated sticker` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    let tempFilePath = null

    try {
      m.reply(`⏳ Converting to GIF...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)

      const media = await downloadMediaMessage(m.quoted, "buffer", {}, { 
        logger: console,
        reuploadRequest: sock.updateMediaMessage 
      })
      
      const videoBuffer = await webp2mp4File(media)
      
      // Save to temp
      tempFilePath = getTempFilePath('togif', '.mp4')
      fs.writeFileSync(tempFilePath, videoBuffer)
      
      // Send as GIF
      await sock.sendMessage(m.chat, {
        video: fs.readFileSync(tempFilePath),
        caption: "✅ Converted to GIF" + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
        gifPlayback: true
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