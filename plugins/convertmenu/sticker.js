import { createComponentLogger } from "../../utils/logger.js"
import { downloadMediaMessage } from "@whiskeysockets/baileys"
import { image2webp, video2webp } from "../../lib/converters/media-converter.js"

const logger = createComponentLogger("STICKER")

export default {
  name: "sticker",
  aliases: ["stiker", "s"],
  category: "convertmenu",
  description: "Convert image/video to sticker",
  usage: "Reply to image/video with .sticker",

  async execute(sock, sessionId, args, m) {
    try {
      if (!m.quoted) {
        return m.reply(`❌ Reply to an image or video to convert it to sticker` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }

      const quotedMsg = m.quoted
      const messageType = quotedMsg.mtype || Object.keys(quotedMsg.message || {})[0]
      
      logger.info(`Processing quoted message type: ${messageType}`)

      const packname = global.packname || "My Stickers"
      const author = global.author || m.pushName || "Bot"
      
      // Check if it's an image
      if (messageType === "imageMessage" || quotedMsg.mimetype?.includes("image")) {
        logger.info("Processing image sticker...")
        
        try {
          m.reply(`⏳ Converting image to sticker...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
          
          const mediaBuffer = await downloadMediaMessage(
            quotedMsg,
            "buffer",
            {},
            { logger: console }
          )
          
          logger.info(`Downloaded image: ${mediaBuffer.length} bytes`)
          
          // Convert to WebP sticker format
          const stickerBuffer = await image2webp(mediaBuffer)
          
          logger.info(`Created sticker: ${stickerBuffer.length} bytes`)
          
          // Send sticker
          await sock.sendMessage(m.chat, {
            sticker: stickerBuffer
          }, { 
            quoted: m
          })
          
          logger.info("Image sticker sent successfully")
        } catch (error) {
          logger.error("Image sticker error:", error.message)
          throw new Error(`Image conversion failed: ${error.message}`)
        }
      } 
      // Check if it's a video
      else if (messageType === "videoMessage" || quotedMsg.mimetype?.includes("video")) {
        const seconds = quotedMsg.msg?.seconds || 
                       quotedMsg.message?.videoMessage?.seconds || 
                       0
        
        if (seconds > 10) {
          return m.reply(`❌ Video must be maximum 10 seconds` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
        }
        
        logger.info("Processing video sticker...")
        
        try {
          m.reply(`⏳ Converting video to sticker... This may take a moment.` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
          
          const mediaBuffer = await downloadMediaMessage(
            quotedMsg,
            "buffer",
            {},
            { logger: console }
          )
          
          logger.info(`Downloaded video: ${mediaBuffer.length} bytes`)
          
          // Convert to animated WebP sticker
          const stickerBuffer = await video2webp(mediaBuffer)
          
          logger.info(`Created animated sticker: ${stickerBuffer.length} bytes`)
          
          // Send animated sticker
          await sock.sendMessage(m.chat, {
            sticker: stickerBuffer
          }, { 
            quoted: m
          })
          
          logger.info("Video sticker sent successfully")
        } catch (error) {
          logger.error("Video sticker error:", error.message)
          m.reply(`❌ Failed to create video sticker. Try:\n• Using a shorter video (max 5 seconds)\n• Compressing the video\n• Using a different format` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
        }
      } 
      else {
        logger.warn(`Unsupported message type: ${messageType}`)
        return m.reply(`❌ Please reply to an image or video (max 10 seconds)` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }
      
    } catch (error) {
      logger.error("Error creating sticker:", error)
      m.reply("❌ Failed to create sticker: " + error.message)
    }
  }
}