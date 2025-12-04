import { createComponentLogger } from "../../utils/logger.js"
import { webp2mp4File, getTempFilePath, cleanupTempFile } from "../../lib/converters/media-converter.js"
import { downloadMediaMessage } from "@whiskeysockets/baileys"
import fs from "fs"

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
    
    // Check if it's animated
    const isAnimated = quotedMessage?.stickerMessage?.isAnimated
    if (!isAnimated) {
      return m.reply(`❌ This command only works with animated stickers` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }
    
    let tempFilePath = null
    
    try {
      await m.reply(`⏳ Converting animated sticker to video...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      
      // Download with retry logic
      logger.info("Downloading media...")
      let media = null
      let downloadAttempts = 3
      
      for (let attempt = 1; attempt <= downloadAttempts; attempt++) {
        try {
          media = await downloadMediaMessage(
            m.quoted,
            "buffer",
            {},
            {
              logger: console,
              reuploadRequest: sock.updateMediaMessage
            }
          )
          
          if (media && media.length > 0) {
            logger.info(`✓ Downloaded on attempt ${attempt}`)
            break
          }
        } catch (downloadError) {
          logger.error(`Download attempt ${attempt} failed:`, downloadError.message)
          if (attempt === downloadAttempts) {
            throw new Error("Failed to download sticker. Please try again.")
          }
          await new Promise(resolve => setTimeout(resolve, attempt * 1000))
        }
      }
      
      if (!media || media.length === 0) {
        return m.reply(`❌ Failed to download sticker` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }
      
      logger.info("Converting...")
      const result = await webp2mp4File(media)
      
      if (!Buffer.isBuffer(result) || result.length === 0) {
        return m.reply(`❌ Conversion failed` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }
      
      // Check size
      const maxSize = 16 * 1024 * 1024
      if (result.length > maxSize) {
        return m.reply(`❌ Video too large (${(result.length / 1024 / 1024).toFixed(2)}MB). Max is 16MB.` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }
      
      // Save to temp file
      tempFilePath = getTempFilePath('tovideo', '.mp4')
      fs.writeFileSync(tempFilePath, result)
      logger.info("Saved to temp:", tempFilePath)
      
      // Send with retry
      let uploadAttempts = 3
      for (let attempt = 1; attempt <= uploadAttempts; attempt++) {
        try {
          await sock.sendMessage(m.chat, {
            video: fs.readFileSync(tempFilePath),
            mimetype: 'video/mp4',
            caption: "✅ Converted to video" + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
            gifPlayback: false
          }, { quoted: m })
          
          logger.info("✓ Video sent successfully")
          break
        } catch (uploadError) {
          logger.error(`Upload attempt ${attempt} failed:`, uploadError.message)
          if (attempt === uploadAttempts) {
            throw new Error("Failed to send video")
          }
          await new Promise(resolve => setTimeout(resolve, attempt * 2000))
        }
      }
      
    } catch (error) {
      logger.error("Error:", error.message)
      
      let errorMsg = "Failed to convert sticker"
      if (error.message.includes("download")) {
        errorMsg = "Failed to download sticker. It may have expired."
      } else if (error.message.includes("ezgif")) {
        errorMsg = "Conversion service temporarily unavailable. Try again."
      }
      
      await m.reply(`❌ ${errorMsg}` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    } finally {
      if (tempFilePath) {
        cleanupTempFile(tempFilePath)
      }
    }
  }
}