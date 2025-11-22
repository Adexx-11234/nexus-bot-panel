import { createComponentLogger } from "../../utils/logger.js"
import { TelegraPh, image2webp } from "../../lib/converters/media-converter.js"
import { downloadMediaMessage } from "@whiskeysockets/baileys"

const logger = createComponentLogger("SMEME")

export default {
  name: "smeme",
  aliases: ["stickermeme"],
  category: "convertmenu",
  description: "Create meme sticker with text",
  usage: "Reply to image with .smeme top text|bottom text",

  async execute(sock, sessionId, args, m) {
    if (!m.quoted) {
      return m.reply(`❌ Reply to an image with text\nUsage: .smeme top|bottom` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    const quotedMsg = m.quoted
    const mime = quotedMsg.mimetype || ""
    
    if (!/image/.test(mime)) {
      return m.reply(`❌ Reply to an image with text\nUsage: .smeme top|bottom` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    const text = args.join(" ")
    
    if (!text) {
      return m.reply(`❌ Usage: .smeme top text|bottom text` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    try {
      m.reply(`⏳ Creating meme sticker...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)

      const atas = text.split('|')[0] ? text.split('|')[0].trim() : '-'
      const bawah = text.split('|')[1] ? text.split('|')[1].trim() : '-'
      
      const media = await downloadMediaMessage(m.quoted, "buffer", {}, { logger: console })
      const imageUrl = await TelegraPh(media)
      
      const memeUrl = `https://api.memegen.link/images/custom/${encodeURIComponent(bawah)}/${encodeURIComponent(atas)}.png?background=${imageUrl}`
      
      // Download meme and convert to sticker
      const axios = (await import('axios')).default
      const memeResponse = await axios.get(memeUrl, { responseType: 'arraybuffer' })
      const memeBuffer = Buffer.from(memeResponse.data)
      
      // Convert to WebP sticker
      const stickerBuffer = await image2webp(memeBuffer)
      
      await sock.sendMessage(m.chat, {
        sticker: stickerBuffer
      }, { quoted: m })
      
    } catch (error) {
      logger.error("Error creating meme sticker:", error)
      m.reply("❌ Failed to create meme: " + error.message)
    }
  }
}