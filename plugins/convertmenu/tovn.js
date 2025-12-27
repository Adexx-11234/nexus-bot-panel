import { createComponentLogger } from "../../utils/logger.js"
import { toPTT } from "../../lib/converters/media-converter.js"
import { downloadMediaMessage } from "@whiskeysockets/baileys"

const logger = createComponentLogger("TO-VN")

export default {
  name: "tovn",
  aliases: ["toptt"],
  category: "convertmenu",
  description: "Convert video/audio to voice note",
  usage: "Reply to video/audio with .tovn",
  permissions: {
  // All false = public command, no restrictions
},

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
      m.reply(`⏳ Converting to voice note...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)

      const media = await downloadMediaMessage(m.quoted, "buffer", {}, { logger: console })
      
      if (!media || media.length === 0) {
        return m.reply(`❌ Failed to download media` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }
      
      logger.info("Downloaded media, size:", media.length, "bytes")
      
      // Convert to PTT (WhatsApp voice note format)
      const audio = await toPTT(media)
      
      await sock.sendMessage(m.chat, {
        audio: audio,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true
      }, { quoted: m })
      
      logger.info("Voice note conversion successful")
    } catch (error) {
      logger.error("Error converting to VN:", error)
      m.reply("❌ Failed to convert: " + error.message)
    }
  }
}