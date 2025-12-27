import { createComponentLogger } from "../../utils/logger.js"
import { TelegraPh, image2webp, getTempFilePath, cleanupTempFile } from "../../lib/converters/media-converter.js"
import { downloadMediaMessage } from "@whiskeysockets/baileys"
import axios from "axios"
import fs from "fs"

const logger = createComponentLogger("SMEME")
export default {
name: "smeme",
aliases: ["stickermeme"],
category: "convertmenu",
description: "Create meme sticker with text",
usage: "Reply to image with .smeme top text|bottom text",
permissions: {
  // All false = public command, no restrictions
},

async execute(sock, sessionId, args, m) {
const mime = m.quoted.mimetype || ""

if (!/image/.test(mime)) {
  return m.reply(`❌ Reply to an image` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
}

const text = args.join(" ")
if (!text) {
  return m.reply(`❌ Usage: .smeme top text|bottom text` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
}

let tempFilePath = null

try {
  m.reply(`⏳ Creating meme sticker...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)

  const atas = text.split('|')[0] ? text.split('|')[0].trim() : '-'
  const bawah = text.split('|')[1] ? text.split('|')[1].trim() : '-'
  
  const media = await downloadMediaMessage(m.quoted, "buffer", {}, { 
    logger: console,
    reuploadRequest: sock.updateMediaMessage 
  })
  
  const imageUrl = await TelegraPh(media)
  const memeUrl = `https://api.memegen.link/images/custom/${encodeURIComponent(bawah)}/${encodeURIComponent(atas)}.png?background=${imageUrl}`
  
  const memeResponse = await axios.get(memeUrl, { responseType: 'arraybuffer' })
  const memeBuffer = Buffer.from(memeResponse.data)
  
  const stickerBuffer = await image2webp(memeBuffer)
  
  // Save to temp
  tempFilePath = getTempFilePath('smeme', '.webp')
  fs.writeFileSync(tempFilePath, stickerBuffer)
  
  await sock.sendMessage(m.chat, {
    sticker: fs.readFileSync(tempFilePath)
  }, { quoted: m })
  
} catch (error) {
  logger.error("Error:", error)
  m.reply("❌ Failed to create meme: " + error.message + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
} finally {
  if (tempFilePath) {
    cleanupTempFile(tempFilePath)
  }
}
}
}