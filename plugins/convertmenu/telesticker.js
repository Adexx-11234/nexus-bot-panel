import { createComponentLogger } from "../../utils/logger.js"
import { Telesticker, image2webp } from "../../lib/converters/media-converter.js"

const logger = createComponentLogger("TELESTICKER")

export default {
  name: "telesticker",
  aliases: ["telestick", "tgs"],
  category: "convertmenu",
  description: "Import Telegram sticker pack to WhatsApp",
  usage: ".telesticker <telegram sticker url>",
  
  async execute(sock, sessionId, args, m) {
    if (!args[0]) {
      return m.reply(`❌ Usage: .telesticker https://t.me/addstickers/PackName` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }
    
    const url = args[0]
    
    if (!url.match(/(https:\/\/t\.me\/addstickers\/)/gi)) {
      return m.reply(`❌ Invalid Telegram sticker URL\nExample: https://t.me/addstickers/PackName` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }
    
    try {
      m.reply(`⏳ Fetching Telegram sticker pack...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      
      const stickers = await Telesticker(url)
      
      if (!stickers || stickers.length === 0) {
        return m.reply(`❌ No stickers found in pack` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }
      
      m.reply(`✅ Found ${stickers.length} stickers. Sending them now...\n(This may take a while)` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      
      let successCount = 0
      let failCount = 0
      
      // Send stickers one by one
      for (let i = 0; i < stickers.length; i++) {
        try {
          const sticker = stickers[i]
          
          // Convert to WhatsApp sticker format if needed
          let stickerBuffer = sticker.buffer
          
          // If not animated, ensure proper WebP format
          if (!sticker.isAnimated && !sticker.isVideo) {
            try {
              stickerBuffer = await image2webp(sticker.buffer)
            } catch (convError) {
              logger.warn(`Conversion failed for sticker ${i + 1}, using original`)
            }
          }
          
          await sock.sendMessage(m.chat, {
            sticker: stickerBuffer
          }, { quoted: m })
          
          successCount++
          
          // Progress update every 10 stickers
          if ((i + 1) % 10 === 0) {
            m.reply(`📦 Progress: ${i + 1}/${stickers.length} stickers sent` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
          }
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000))
          
        } catch (err) {
          logger.error(`Failed to send sticker ${i + 1}:`, err.message)
          failCount++
        }
      }
      
      m.reply(`✅ Telegram sticker import complete!\n• Sent: ${successCount} stickers\n• Failed: ${failCount} stickers` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      
    } catch (error) {
      logger.error("Error importing Telegram stickers:", error)
      m.reply("❌ Failed to import sticker pack: " + error.message)
    }
  }
}