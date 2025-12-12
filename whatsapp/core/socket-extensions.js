import { createComponentLogger } from "../../utils/logger.js"
import { downloadMediaMessage } from "@whiskeysockets/baileys"
import { image2webp, video2webp, getTempFilePath, cleanupTempFile } from "../../lib/converters/media-converter.js"
import { fileTypeFromBuffer } from "file-type"
import axios from "axios"
import fs from "fs"

const logger = createComponentLogger("SOCKET_EXTENSIONS")

// ==================== FAKE QUOTED CONFIGURATION ====================
/**
 * Fake quoted message to use instead of real messages
 * This prevents issues with message context and maintains privacy
 */
const fakeQuoted = {
  key: {
    participant: '0@s.whatsapp.net',
    remoteJid: '0@s.whatsapp.net'
  },
  message: {
    conversation: '*𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙*'
  }
}

/**
 * Extend a Baileys socket with ALL helper methods and overrides
 * This includes: media helpers, sendMessage override, groupMetadata override, and LID helpers
 */
export function extendSocket(sock) {
  if (!sock || sock._extended) {
    return sock
  }

  logger.debug("Extending socket with all helper methods and overrides")

  // ==================== SEND MESSAGE OVERRIDE ====================
  const originalSendMessage = sock.sendMessage.bind(sock)
  
  /**
   * Enhanced sendMessage with:
   * - Automatic fakeQuoted replacement and addition
   * - Auto-mention for group replies
   * - Timeout protection (prevents hanging)
   * - Ephemeral message control
   * - Better error handling
   * - Automatic retry on specific errors
   * - Session activity tracking
   */
  sock.sendMessage = async (jid, content, options = {}) => {
    const maxRetries = 2
    let lastError = null
    
    // ========== FAKE QUOTED MANAGEMENT ==========
    const isGroup = jid.endsWith('@g.us')
    let originalQuoted = options.quoted
    
    // Always use fakeQuoted (replace or add)
    if (originalQuoted) {
      logger.debug(`[SendMessage] Replacing quoted message with fakeQuoted for ${jid}`)
      
      // If it's a group and we have the original quoted message, enhance it
      if (isGroup && originalQuoted.key?.participant) {
        const senderJid = originalQuoted.key.participant
        const pushName = originalQuoted.pushName || originalQuoted.verifiedBizName || 'User'
        
        // Create enhanced fakeQuoted with reply info
        options.quoted = {
          ...fakeQuoted,
          message: {
            conversation: `*𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙\n\nReplied to ${pushName}*`
          }
        }
        
        // Add mention of the user being replied to
        const existingMentions = options.mentions || []
        if (!existingMentions.includes(senderJid)) {
          options.mentions = [...existingMentions, senderJid]
        }
        
        logger.debug(`[SendMessage] Enhanced group reply with mention for ${pushName}`)
      } else {
        // Not a group or no participant info, use standard fakeQuoted
        options.quoted = fakeQuoted
      }
    } else {
      // No quoted provided, add fakeQuoted
      logger.debug(`[SendMessage] Adding fakeQuoted to message for ${jid}`)
      options.quoted = fakeQuoted
    }
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Disable ephemeral messages by default
        if (!options.ephemeralExpiration) {
          options.ephemeralExpiration = 0
        }
        
        // Create send promise
        const sendPromise = originalSendMessage(jid, content, options)
        
        // Create timeout promise (40 seconds)
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('sendMessage timeout after 40s')), 40000)
        )
        
        // Race between send and timeout
        const result = await Promise.race([sendPromise, timeoutPromise])
        
        // Update session activity on success
        if (sock.sessionId) {
          const { updateSessionLastMessage } = await import('../core/config.js')
          updateSessionLastMessage(sock.sessionId)
        }
        
        logger.debug(`[SendMessage] Message sent successfully to ${jid}`)
        return result
        
      } catch (error) {
        lastError = error
        
        // Don't retry on specific errors
        const noRetryErrors = [
          'forbidden',
          'not-authorized',
          'invalid-jid',
          'recipient-not-found'
        ]
        
        const shouldNotRetry = noRetryErrors.some(err => 
          error.message?.toLowerCase().includes(err)
        )
        
        if (shouldNotRetry) {
          logger.error(`[SendMessage] Non-retryable error sending to ${jid}: ${error.message}`)
          throw error
        }
        
        // Retry on timeout or temporary errors
        if (attempt < maxRetries) {
          const delay = (attempt + 1) * 1000 // 1s, 2s
          logger.warn(`[SendMessage] Send failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms: ${error.message}`)
          await sleep(delay)
          continue
        }
        
        // All retries exhausted
        logger.error(`[SendMessage] Failed to send message to ${jid} after ${maxRetries + 1} attempts: ${error.message}`)
        throw error
      }
    }
    
    // Should never reach here, but just in case
    throw lastError || new Error('Unknown error in sendMessage')
  }

  // ==================== GROUP METADATA OVERRIDE ====================
  // Store original groupMetadata method
  const originalGroupMetadata = sock.groupMetadata?.bind(sock)
  sock._originalGroupMetadata = originalGroupMetadata
  
  /**
   * Override groupMetadata to ALWAYS use cache-first approach
   * This reduces API calls and prevents rate limiting
   */
  if (originalGroupMetadata) {
    sock.groupMetadata = async (jid) => {
      const { getGroupMetadata } = await import('../core/config.js')
      return await getGroupMetadata(sock, jid, false)
    }

    /**
     * Add refresh method - ONLY for specific scenarios
     * Use this when you know metadata has changed (participant add/remove/promote/demote)
     */
    sock.groupMetadataRefresh = async (jid) => {
      const { getGroupMetadata } = await import('../core/config.js')
      return await getGroupMetadata(sock, jid, true)
    }
  }

  // ==================== LID HELPER METHODS (v7) ====================
  /**
   * Get LID (Linked Identifier) for a phone number
   */
  sock.getLidForPn = async (phoneNumber) => {
    if (sock.signalRepository?.lidMapping?.getLIDForPN) {
      return await sock.signalRepository.lidMapping.getLIDForPN(phoneNumber)
    }
    return phoneNumber
  }

  /**
   * Get phone number for a LID
   */
  sock.getPnForLid = async (lid) => {
    if (sock.signalRepository?.lidMapping?.getPNForLID) {
      return await sock.signalRepository.lidMapping.getPNForLID(lid)
    }
    return lid
  }

  // ==================== MEDIA HELPERS ====================
  
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

          if (source.url) {
            const response = await axios.get(source.url, { responseType: "arraybuffer" })
            buffer = Buffer.from(response.data)
          } else if (typeof buffer === "string" && /^https?:\/\//.test(buffer)) {
            const response = await axios.get(buffer, { responseType: "arraybuffer" })
            buffer = Buffer.from(response.data)
          }

          const fileType = await fileTypeFromBuffer(buffer)
          const mime = fileType?.mime || ""
          const isVideo = source.isVideo || mime.startsWith("video/") || mime === "image/gif"

          let stickerBuffer
          if (isVideo) {
            stickerBuffer = await video2webp(buffer)
          } else {
            stickerBuffer = await image2webp(buffer)
          }

          tempFilePath = getTempFilePath('stickerPack', '.webp')
          fs.writeFileSync(tempFilePath, stickerBuffer)
          tempFiles.push(tempFilePath)

          const result = await this.sendMessage(
            jid,
            { sticker: fs.readFileSync(tempFilePath) },
            { quoted: i === 0 ? quoted : null }
          )

          results.push({ success: true, index: i, result })

          if (onProgress) {
            onProgress(i + 1, total)
          }

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

  logger.info("✅ Socket fully extended with all helper methods and overrides")
  return sock
}

/**
 * Sleep/delay utility
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default { extendSocket }