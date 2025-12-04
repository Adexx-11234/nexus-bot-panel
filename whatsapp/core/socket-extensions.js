import { createComponentLogger } from "../../utils/logger.js"
import { downloadMediaMessage } from "@whiskeysockets/baileys"
import { image2webp, video2webp, getTempFilePath, cleanupTempFile } from "../../lib/converters/media-converter.js"
import { fileTypeFromBuffer } from "file-type"
import axios from "axios"
import crypto from "crypto"
import fs from "fs"

const logger = createComponentLogger("SOCKET_EXTENSIONS")

/**
 * Extend a Baileys socket with helper methods for common operations
 */
export function extendSocket(sock) {
  if (!sock || sock._extended) {
    return sock
  }

  /**
   * Send an image as a sticker
   */
  sock.sendImageAsSticker = async function (jid, source, options = {}) {
    let tempFilePath = null
    try {
      let buffer = source

      if (typeof source === "string" && /^https?:\/\//.test(source)) {
        const response = await axios.get(source, { responseType: "arraybuffer" })
        buffer = Buffer.from(response.data)
      }

      const stickerBuffer = await image2webp(buffer)
      
      // Save to temp
      tempFilePath = getTempFilePath('sendImageAsSticker', '.webp')
      fs.writeFileSync(tempFilePath, stickerBuffer)

      const result = await this.sendMessage(
        jid,
        { sticker: fs.readFileSync(tempFilePath) },
        { quoted: options.quoted }
      )
      
      return result
    } catch (error) {
      logger.error("sendImageAsSticker error:", error.message)
      throw error
    } finally {
      if (tempFilePath) {
        cleanupTempFile(tempFilePath)
      }
    }
  }

  /**
   * Send a video as an animated sticker
   */
  sock.sendVideoAsSticker = async function (jid, source, options = {}) {
    let tempFilePath = null
    try {
      let buffer = source

      if (typeof source === "string" && /^https?:\/\//.test(source)) {
        const response = await axios.get(source, { responseType: "arraybuffer" })
        buffer = Buffer.from(response.data)
      }

      const stickerBuffer = await video2webp(buffer)
      
      // Save to temp
      tempFilePath = getTempFilePath('sendVideoAsSticker', '.webp')
      fs.writeFileSync(tempFilePath, stickerBuffer)

      const result = await this.sendMessage(
        jid,
        { sticker: fs.readFileSync(tempFilePath) },
        { quoted: options.quoted }
      )
      
      return result
    } catch (error) {
      logger.error("sendVideoAsSticker error:", error.message)
      throw error
    } finally {
      if (tempFilePath) {
        cleanupTempFile(tempFilePath)
      }
    }
  }

  /**
   * Send media as sticker - auto-detects image or video
   */
  sock.sendMediaAsSticker = async function (jid, source, options = {}) {
    let tempFilePath = null
    try {
      let buffer = source

      if (typeof source === "string" && /^https?:\/\//.test(source)) {
        const response = await axios.get(source, { responseType: "arraybuffer" })
        buffer = Buffer.from(response.data)
      }

      const fileType = await fileTypeFromBuffer(buffer)
      const mime = fileType?.mime || ""

      let stickerBuffer
      if (mime.startsWith("video/") || mime === "image/gif") {
        stickerBuffer = await video2webp(buffer)
      } else {
        stickerBuffer = await image2webp(buffer)
      }

      // Save to temp
      tempFilePath = getTempFilePath('sendMediaAsSticker', '.webp')
      fs.writeFileSync(tempFilePath, stickerBuffer)

      const result = await this.sendMessage(
        jid,
        { sticker: fs.readFileSync(tempFilePath) },
        { quoted: options.quoted }
      )
      
      return result
    } catch (error) {
      logger.error("sendMediaAsSticker error:", error.message)
      throw error
    } finally {
      if (tempFilePath) {
        cleanupTempFile(tempFilePath)
      }
    }
  }

  /**
   * Send multiple stickers in batches
   * NOTE: Baileys does NOT support native sticker pack messages
   * This sends stickers individually with delays
   */
  sock.sendStickerPack = async function (jid, sources, options = {}) {
    const {
      batchSize = 5,
      batchDelay = 1000,
      itemDelay = 300,
      quoted = null,
      onProgress = null
    } = options

    const results = []
    const total = sources.length
    const tempFiles = []

    try {
      for (let i = 0; i < sources.length; i++) {
        let tempFilePath = null
        
        try {
          const source = sources[i]
          let buffer = source.buffer || source

          // Download if URL
          if (source.url) {
            const response = await axios.get(source.url, { responseType: "arraybuffer" })
            buffer = Buffer.from(response.data)
          } else if (typeof buffer === "string" && /^https?:\/\//.test(buffer)) {
            const response = await axios.get(buffer, { responseType: "arraybuffer" })
            buffer = Buffer.from(response.data)
          }

          // Detect type and convert
          const fileType = await fileTypeFromBuffer(buffer)
          const mime = fileType?.mime || ""
          const isVideo = source.isVideo || mime.startsWith("video/") || mime === "image/gif"

          let stickerBuffer
          if (isVideo) {
            stickerBuffer = await video2webp(buffer)
          } else {
            stickerBuffer = await image2webp(buffer)
          }

          // Save to temp
          tempFilePath = getTempFilePath('stickerPack', '.webp')
          fs.writeFileSync(tempFilePath, stickerBuffer)
          tempFiles.push(tempFilePath)

          // Send sticker
          const result = await this.sendMessage(
            jid,
            { sticker: fs.readFileSync(tempFilePath) },
            { quoted: i === 0 ? quoted : null }
          )

          results.push({ success: true, index: i, result })

          // Progress callback
          if (onProgress) {
            onProgress(i + 1, total)
          }

          // Delays
          if ((i + 1) % batchSize !== 0 && i < sources.length - 1) {
            await sleep(itemDelay)
          } else if ((i + 1) % batchSize === 0 && i < sources.length - 1) {
            await sleep(batchDelay)
          }
        } catch (error) {
          logger.error(`sendStickerPack error at index ${i}:`, error.message)
          results.push({ success: false, index: i, error: error.message })
          
          if (tempFilePath) {
            cleanupTempFile(tempFilePath)
          }
        }
      }

      return results
    } finally {
      // Clean up all temp files
      for (const tempFile of tempFiles) {
        cleanupTempFile(tempFile)
      }
    }
  }

  /**
   * Send image with optional caption
   */
  sock.sendImage = async function (jid, source, caption = "", options = {}) {
    let tempFilePath = null
    try {
      let buffer = source

      if (typeof source === "string" && /^https?:\/\//.test(source)) {
        const response = await axios.get(source, { responseType: "arraybuffer" })
        buffer = Buffer.from(response.data)
      }

      // Save to temp
      tempFilePath = getTempFilePath('sendImage', '.jpg')
      fs.writeFileSync(tempFilePath, buffer)

      const result = await this.sendMessage(
        jid,
        {
          image: fs.readFileSync(tempFilePath),
          caption: caption,
        },
        { quoted: options.quoted }
      )
      
      return result
    } catch (error) {
      logger.error("sendImage error:", error.message)
      throw error
    } finally {
      if (tempFilePath) {
        cleanupTempFile(tempFilePath)
      }
    }
  }

  /**
   * Send video with optional caption
   */
  sock.sendVideo = async function (jid, source, caption = "", options = {}) {
    let tempFilePath = null
    try {
      let buffer = source

      if (typeof source === "string" && /^https?:\/\//.test(source)) {
        const response = await axios.get(source, { responseType: "arraybuffer" })
        buffer = Buffer.from(response.data)
      }

      // Save to temp
      tempFilePath = getTempFilePath('sendVideo', '.mp4')
      fs.writeFileSync(tempFilePath, buffer)

      const result = await this.sendMessage(
        jid,
        {
          video: fs.readFileSync(tempFilePath),
          caption: caption,
          gifPlayback: options.gifPlayback || false,
        },
        { quoted: options.quoted }
      )
      
      return result
    } catch (error) {
      logger.error("sendVideo error:", error.message)
      throw error
    } finally {
      if (tempFilePath) {
        cleanupTempFile(tempFilePath)
      }
    }
  }

  /**
   * Send audio
   */
  sock.sendAudio = async function (jid, source, options = {}) {
    let tempFilePath = null
    try {
      let buffer = source

      if (typeof source === "string" && /^https?:\/\//.test(source)) {
        const response = await axios.get(source, { responseType: "arraybuffer" })
        buffer = Buffer.from(response.data)
      }

      // Save to temp
      tempFilePath = getTempFilePath('sendAudio', '.mp3')
      fs.writeFileSync(tempFilePath, buffer)

      const result = await this.sendMessage(
        jid,
        {
          audio: fs.readFileSync(tempFilePath),
          mimetype: "audio/mpeg",
          ptt: options.ptt || false,
        },
        { quoted: options.quoted }
      )
      
      return result
    } catch (error) {
      logger.error("sendAudio error:", error.message)
      throw error
    } finally {
      if (tempFilePath) {
        cleanupTempFile(tempFilePath)
      }
    }
  }

  /**
   * Send document/file
   */
  sock.sendDocument = async function (jid, source, filename, options = {}) {
    let tempFilePath = null
    try {
      let buffer = source

      if (typeof source === "string" && /^https?:\/\//.test(source)) {
        const response = await axios.get(source, { responseType: "arraybuffer" })
        buffer = Buffer.from(response.data)
      }

      const fileType = await fileTypeFromBuffer(buffer)
      
      // Save to temp
      tempFilePath = getTempFilePath('sendDocument', `.${fileType?.ext || 'bin'}`)
      fs.writeFileSync(tempFilePath, buffer)

      const result = await this.sendMessage(
        jid,
        {
          document: fs.readFileSync(tempFilePath),
          mimetype: options.mimetype || fileType?.mime || "application/octet-stream",
          fileName: filename,
        },
        { quoted: options.quoted }
      )
      
      return result
    } catch (error) {
      logger.error("sendDocument error:", error.message)
      throw error
    } finally {
      if (tempFilePath) {
        cleanupTempFile(tempFilePath)
      }
    }
  }

  /**
   * Reply with text
   */
  sock.reply = async function (m, text) {
    return await this.sendMessage(
      m.chat || m.key.remoteJid,
      { text: text },
      { quoted: m }
    )
  }

  /**
   * React to a message
   */
  sock.react = async function (m, emoji) {
    return await this.sendMessage(m.chat || m.key.remoteJid, {
      react: {
        text: emoji,
        key: m.key,
      },
    })
  }

  /**
   * Download media from a message
   */
  sock.downloadMedia = async (m) => {
    try {
      const buffer = await downloadMediaMessage(
        m.quoted || m,
        "buffer",
        {},
        {
          logger: console,
          reuploadRequest: sock.updateMediaMessage
        }
      )
      return buffer
    } catch (error) {
      logger.error("downloadMedia error:", error.message)
      throw error
    }
  }

  // Mark socket as extended
  sock._extended = true

  logger.debug("Socket extended with helper methods")
  return sock
}

/**
 * Sleep/delay utility
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default { extendSocket }