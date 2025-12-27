import { createComponentLogger } from "../../utils/logger.js"
import { Telesticker, image2webp, video2webp, getTempFilePath, cleanupTempFile } from "../../lib/converters/media-converter.js"
import axios from "axios"
import fs from "fs"

const logger = createComponentLogger("TELESTICKER")

export default {
  name: "telesticker",
  aliases: ["telestick", "tgs"],
  category: "convertmenu",
  description: "Import Telegram sticker pack to WhatsApp",
  usage: ".telesticker <telegram sticker url>",
  permissions: {
  // All false = public command, no restrictions
},

  async execute(sock, sessionId, args, m) {
    if (!args[0]) {
      return m.reply(`❌ Usage: .telesticker https://t.me/addstickers/PackName` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    const url = args[0]

    if (!url.match(/(https:\/\/t\.me\/addstickers\/)/gi)) {
      return m.reply(`❌ Invalid Telegram sticker URL\nExample: https://t.me/addstickers/PackName` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    }

    const tempFiles = []

    try {
      await m.reply(`⏳ Fetching Telegram sticker pack...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)

      const stickers = await Telesticker(url)

      if (!stickers || stickers.length === 0) {
        return m.reply(`❌ No stickers found in pack` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }

      const videoCount = stickers.filter((s) => s.isVideo).length
      const staticCount = stickers.length - videoCount

      await m.reply(
        `📦 Found ${stickers.length} stickers (${staticCount} static, ${videoCount} video)\n⏳ Downloading and converting...` +
          `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
      )

      // Download and convert all stickers
      const preparedStickers = []
      let downloadedCount = 0

      for (const sticker of stickers) {
        let tempFilePath = null
        
        try {
          const response = await axios.get(sticker.url, {
            responseType: "arraybuffer",
            timeout: 30000,
          })
          let buffer = Buffer.from(response.data)

          // Convert based on type
          if (sticker.isVideo) {
            try {
              buffer = await video2webp(buffer)
            } catch (convError) {
              logger.warn(`Video conversion failed, skipping: ${convError.message}`)
              continue
            }
          } else {
            try {
              buffer = await image2webp(buffer)
            } catch (convError) {
              logger.warn(`Image conversion failed, using original`)
            }
          }

          // Save to temp file
          tempFilePath = getTempFilePath('telesticker', '.webp')
          fs.writeFileSync(tempFilePath, buffer)
          tempFiles.push(tempFilePath)

          preparedStickers.push({
            filePath: tempFilePath,
            isVideo: sticker.isVideo,
            isAnimated: sticker.isAnimated,
          })

          downloadedCount++

          // Progress update every 10 stickers
          if (downloadedCount % 10 === 0) {
            logger.info(`Downloaded ${downloadedCount}/${stickers.length} stickers`)
          }
        } catch (err) {
          logger.error(`Failed to download sticker: ${err.message}`)
          if (tempFilePath) {
            cleanupTempFile(tempFilePath)
          }
        }
      }

      if (preparedStickers.length === 0) {
        return m.reply(`❌ Failed to download any stickers from the pack` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
      }

      await m.reply(`✅ Downloaded ${preparedStickers.length} stickers\n📤 Sending to chat...` + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)

      const packName = url.replace("https://t.me/addstickers/", "")

      // Send stickers individually in batches
      let successCount = 0
      let failCount = 0

      const BATCH_SIZE = 5
      const BATCH_DELAY = 1000  // 1 second between batches
      const STICKER_DELAY = 300 // 300ms between stickers

      for (let i = 0; i < preparedStickers.length; i++) {
        try {
          await sock.sendMessage(m.chat, {
            sticker: fs.readFileSync(preparedStickers[i].filePath),
          })
          successCount++

          // Delay between stickers
          if ((i + 1) % BATCH_SIZE !== 0) {
            await sleep(STICKER_DELAY)
          } else {
            await sleep(BATCH_DELAY)
            // Progress update
            await m.reply(`📤 Progress: ${successCount}/${preparedStickers.length} sent...`)
          }
        } catch (err) {
          logger.error(`Failed to send sticker ${i + 1}:`, err.message)
          failCount++
        }
      }

      await m.reply(
        `✅ Telegram sticker import complete!\n\n` +
        `📦 Pack: ${packName}\n` +
        `✔️ Sent: ${successCount} stickers\n` +
        `❌ Failed: ${failCount} stickers` +
        `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
      )
    } catch (error) {
      logger.error("Error importing Telegram stickers:", error)
      
      let errorMsg = "Failed to import sticker pack: " + error.message
      
      if (error.message.includes("TELEGRAM_BOT_TOKEN")) {
        errorMsg = "❌ Telegram bot token not configured. Please set TELEGRAM_BOT_TOKEN in your .env file.\n\nTo get a token:\n1. Message @BotFather on Telegram\n2. Send /newbot\n3. Follow instructions\n4. Add token to .env"
      }
      
      m.reply(errorMsg + `\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`)
    } finally {
      // Clean up all temp files
      for (const tempFile of tempFiles) {
        cleanupTempFile(tempFile)
      }
      logger.info(`Cleaned up ${tempFiles.length} temp files`)
    }
  },
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}