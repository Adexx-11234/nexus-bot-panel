import { createComponentLogger } from "../../utils/logger.js"
import { Telesticker } from "../../lib/converters/media-converter.js"

const logger = createComponentLogger("TELESTICKER")

export default {
  name: "telesticker",
  aliases: ["telestick", "tgs"],
  category: "convertmenu",
  description: "Import Telegram sticker pack to WhatsApp",
  usage: ".telesticker <telegram sticker url>",

  async execute(sock, sessionId, args, m) {
    if (!args[0]) {
      return m.reply(
        `❌ Usage: .telesticker https://t.me/addstickers/PackName\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      )
    }

    const url = args[0]

    if (!url.match(/(https:\/\/t\.me\/addstickers\/)/gi)) {
      return m.reply(
        `❌ Invalid Telegram sticker URL\nExample: https://t.me/addstickers/PackName\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      )
    }

    try {
      await m.reply(`⏳ Fetching Telegram sticker pack...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)

      // Fetch stickers from Telegram
      const stickers = await Telesticker(url)

      if (!stickers || stickers.length === 0) {
        return m.reply(`❌ No stickers found in pack\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }

      const videoCount = stickers.filter((s) => s.isVideo).length
      const staticCount = stickers.length - videoCount

      await m.reply(
        `📦 Found ${stickers.length} stickers (${staticCount} static, ${videoCount} video)\n⏳ Processing and sending as sticker pack...\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      )

      console.log(`[TELESTICKER] Processing ${stickers.length} stickers (${staticCount} static, ${videoCount} video)`)

      // Extract pack name from URL
      const packName = url.replace("https://t.me/addstickers/", "")

      // Prepare sources for sendStickerPack
      const sources = stickers.map((sticker) => ({
        url: sticker.url,
        isVideo: sticker.isVideo,
        emojis: sticker.emojis || ["😊"],
        label: ""
      }))

      // Send the entire pack using sock.sendStickerPack
      const result = await sock.sendStickerPack(m.chat, sources, {
        packName: packName,
        packPublisher: "𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖳",
        quoted: m
      })

      // Result from sendStickerPack is: { success: true, packName, stickerCount, totalCount }
      if (result.success) {
        await m.reply(
          `✅ Telegram sticker pack imported!\n\n` +
          `📦 Pack: ${packName}\n` +
          `✔️ Stickers: ${result.stickerCount}/${result.totalCount}\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        )

        logger.info(
          `Telegram sticker pack imported successfully: ${result.stickerCount} stickers`
        )
      } else {
        throw new Error("Sticker pack sending failed")
      }

    } catch (error) {
      logger.error("Error importing Telegram stickers:", error)

      let errorMsg = "Failed to import sticker pack: " + error.message

      if (error.message.includes("TELEGRAM_BOT_TOKEN")) {
        errorMsg =
          "❌ Telegram bot token not configured"
      } else if (error.message.includes("waUploadToServer")) {
        errorMsg =
          "❌ WhatsApp upload failed. This feature requires proper WhatsApp server upload support.\n\n" +
          "The sticker pack format is not fully supported yet. Falling back to individual stickers might be needed."
      }

      m.reply(errorMsg + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }
  }
}