import { createComponentLogger } from "../../utils/logger.js"
import { downloadMediaMessage } from "@whiskeysockets/baileys"
import { image2webp, video2webp, getTempFilePath, cleanupTempFile } from "../../lib/converters/media-converter.js"
import fs from "fs"

const logger = createComponentLogger("STICKER")

export default {
  name: "sticker",
  aliases: ["stiker", "s", "tosticker", "tostiker"],
  category: "convertmenu",
  description: "Convert image/video to sticker",
  usage: "Reply to image/video with .sticker",

  async execute(sock, sessionId, args, m) {
    if (!m.quoted) {
      return m.reply(`❌ Reply to an image or video` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    const quotedMsg = m.quoted
    const messageType = quotedMsg.mtype || Object.keys(quotedMsg.message || {})[0]
    
    let tempFilePath = null

    try {
      if (messageType === "imageMessage" || quotedMsg.mimetype?.includes("image")) {
        m.reply(`⏳ Converting image to sticker...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
        
        const mediaBuffer = await downloadMediaMessage(quotedMsg, "buffer", {}, { 
          logger: console,
          reuploadRequest: sock.updateMediaMessage 
        })
        
        const stickerBuffer = await image2webp(mediaBuffer)
        
        // Save to temp
        tempFilePath = getTempFilePath('sticker', '.webp')
        fs.writeFileSync(tempFilePath, stickerBuffer)
        
        await sock.sendMessage(m.chat, {
          sticker: fs.readFileSync(tempFilePath)
        }, { quoted: m })
        
        logger.info("Image sticker sent")
      } 
      else if (messageType === "videoMessage" || quotedMsg.mimetype?.includes("video")) {
        const seconds = quotedMsg.msg?.seconds || quotedMsg.message?.videoMessage?.seconds || 0
        
        if (seconds > 10) {
          return m.reply(`❌ Video must be maximum 10 seconds` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
        }
        
        m.reply(`⏳ Converting video to sticker...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
        
        const mediaBuffer = await downloadMediaMessage(quotedMsg, "buffer", {}, { 
          logger: console,
          reuploadRequest: sock.updateMediaMessage 
        })
        
        const stickerBuffer = await video2webp(mediaBuffer)
        
        // Save to temp
        tempFilePath = getTempFilePath('sticker', '.webp')
        fs.writeFileSync(tempFilePath, stickerBuffer)
        
        await sock.sendMessage(m.chat, {
          sticker: fs.readFileSync(tempFilePath)
        }, { quoted: m })
        
        logger.info("Video sticker sent")
      } 
      else {
        return m.reply(`❌ Please reply to an image or video` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }
      
    } catch (error) {
      logger.error("Error:", error)
      m.reply("❌ Failed to create sticker: " + error.message + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    } finally {
      if (tempFilePath) {
        cleanupTempFile(tempFilePath)
      }
    }
  }
}