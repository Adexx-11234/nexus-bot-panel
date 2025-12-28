import { createComponentLogger } from "../../utils/logger.js"
import { toAudio } from "../../lib/converters/media-converter.js"
import { downloadMediaMessage } from "@whiskeysockets/baileys"

const logger = createComponentLogger("TO-AUDIO")

export default {
  name: "toaudio",
  aliases: ["toaud"],
  category: "convertmenu",
  description: "Convert video/audio to audio format",
  usage: "Reply to video/audio with .toaudio",

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
      m.reply(`⏳ Converting to audio...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)

      const media = await downloadMediaMessage(m.quoted, "buffer", {}, { logger: console })
      
      if (!media || media.length === 0) {
        return m.reply(`❌ Failed to download media` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }
      
      logger.info("Downloaded media, size:", media.length, "bytes")
      
      // Convert to MP3 audio
      const audio = await toAudio(media)
      
      await sock.sendMessage(m.chat, {
        audio: audio,
        mimetype: 'audio/mpeg'
      }, { quoted: m })
      
      logger.info("Audio conversion successful")
    } catch (error) {
      logger.error("Error converting to audio:", error)
      m.reply("❌ Failed to convert: " + error.message)
    }
  }
}