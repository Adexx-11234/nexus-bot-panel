import { createComponentLogger } from "../../utils/logger.js"
import { downloadMediaMessage } from "@nexustechpro/baileys"
import fs from "fs"

const logger = createComponentLogger("STEAL")

export default {
  name: "steal",
  aliases: ["swm", "stickerwm", "take"],
  category: "convertmenu",
  description: "Take sticker and change packname/author",
  usage: "Reply to sticker with .steal packname|author",

  async execute(sock, sessionId, args, m) {
    if (!args.join(" ")) {
      return m.reply(`❌ Usage: .steal packname|author` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    const swn = args.join(" ")
    const pcknm = swn.split("|")[0] || global.packname || "Paulbot"
    const atnm = swn.split("|")[1] || global.author || m.pushName

    if (!m.quoted) {
      return m.reply(`❌ Reply to a sticker, image, or video` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    const quotedMsg = m.quoted
    const mime = quotedMsg.mimetype || ""

    try {
      if (quotedMsg.isAnimated === true) {
        const media = await downloadMediaMessage(m.quoted, "buffer", {}, { logger: console })
        await fs.promises.writeFile("gifee.webp", media)
        await sock.sendMessage(m.chat, { sticker: fs.readFileSync("gifee.webp") }, { quoted: m })
        await fs.promises.unlink("gifee.webp").catch(() => {})
      } else if (/image/.test(mime)) {
        const media = await downloadMediaMessage(m.quoted, "buffer", {}, { logger: console })
        const encmedia = await sock.sendImageAsSticker(m.chat, media, m, { 
          packname: pcknm, 
          author: atnm 
        })
        await fs.promises.unlink(encmedia).catch(() => {})
      } else if (/video/.test(mime)) {
        if ((quotedMsg.msg || quotedMsg).seconds > 11) {
          return m.reply(`❌ Maximum 10 seconds` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
        }
        const media = await downloadMediaMessage(m.quoted, "buffer", {}, { logger: console })
        const encmedia = await sock.sendVideoAsSticker(m.chat, media, m, { 
          packname: pcknm, 
          author: atnm 
        })
        await fs.promises.unlink(encmedia).catch(() => {})
      } else {
        return m.reply(`❌ Reply to sticker/image/video` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }
    } catch (error) {
      logger.error("Error stealing sticker:", error)
      m.reply(`❌ Failed to steal sticker` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }
  }
}