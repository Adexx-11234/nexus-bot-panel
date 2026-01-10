import { createComponentLogger } from "../../utils/logger.js"
import { toAudio } from "../../lib/converters/media-converter.js"
import { downloadMediaMessage } from "@nexustechpro/baileys"

const logger = createComponentLogger("TO-MP3")

export default {
  name: "tomp3",
  aliases: ["audio", "mp3"],
  category: "convertmenu",
  description: "Convert video/audio to MP3 document",
  usage: "Reply to video/audio with .tomp3",

  async execute(sock, sessionId, args, m) {
    if (!m.quoted) {
      return m.reply(`❌ Reply to video or audio` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    const quotedMsg = m.quoted
    const quotedMessage = quotedMsg.message
    
    const isVideo = quotedMessage?.videoMessage || quotedMsg.type === 'video'
    const isAudio = quotedMessage?.audioMessage || quotedMsg.type === 'audio'
    const mime = quotedMsg.mimetype || ""
    
    if (!isVideo && !isAudio && !/video/.test(mime) && !/audio/.test(mime)) {
      return m.reply(`❌ Reply to video or audio` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    try {
      m.reply(`⏳ Converting to MP3...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)

      const media = await downloadMediaMessage(m.quoted, "buffer", {}, { logger: console })
      
      if (!media || media.length === 0) {
        return m.reply(`❌ Failed to download media` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }
      
      logger.info("Downloaded media, size:", media.length, "bytes")
      
      // Convert to MP3
      const audio = await toAudio(media)
      
      // Send as document
      await sock.sendMessage(m.chat, {
        document: audio,
        mimetype: 'audio/mp3',
        fileName: `audio_${Date.now()}.mp3`
      }, { quoted: m })
      
      logger.info("MP3 conversion successful")
    } catch (error) {
      logger.error("Error converting to MP3:", error)
      m.reply("❌ Failed to convert: " + error.message)
    }
  }
}