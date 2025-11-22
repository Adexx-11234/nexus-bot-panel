import { createComponentLogger } from "../../utils/logger.js"
import { TelegraPh, UploadFileUgu } from "../../lib/converters/media-converter.js"
import { downloadMediaMessage } from "@whiskeysockets/baileys"

const logger = createComponentLogger("TO-URL")

export default {
  name: "tourl",
  aliases: [],
  category: "convertmenu",
  description: "Upload media and get URL",
  usage: "Reply to image/video/document with .tourl",

  async execute(sock, sessionId, args, m) {
    if (!m.quoted) {
      return m.reply(`❌ Reply to an image, video, or document` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    try {
      m.reply(`⏳ Uploading media...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)

      const quotedMsg = m.quoted
      const mime = quotedMsg.mimetype || ""

      const media = await downloadMediaMessage(m.quoted, "buffer", {}, { logger: console })
      
      let url
      
      if (/image/.test(mime)) {
        // Upload images to Telegraph
        url = await TelegraPh(media)
      } else {
        // Upload other files to Uguu
        const result = await UploadFileUgu(media)
        url = result.url || result
      }
      
      m.reply(`✅ Upload successful!\n\n🔗 URL: ${url}` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      
    } catch (error) {
      logger.error("Error uploading to URL:", error)
      m.reply("❌ Failed to upload: " + error.message)
    }
  }
}