import { createComponentLogger } from "../../utils/logger.js"
import { downloadMediaMessage } from "@whiskeysockets/baileys"
import { image2webp, video2webp, getTempFilePath, cleanupTempFile } from "../../lib/converters/media-converter.js"
import { fileTypeFromBuffer } from "file-type"
import axios from "axios"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import sharp from "sharp"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const logger = createComponentLogger("SOCKET_EXTENSIONS")

// ==================== DYNAMIC FAKE QUOTED SYSTEM ====================

/**
 * Load and process bot logo as thumbnail
 * Uses sharp to resize to 48x48 for WhatsApp thumbnails
 */
async function loadBotLogoThumbnail() {
  try {
    const possiblePaths = [
      path.resolve(process.cwd(), "Defaults", "images", "menu.png"),
      path.resolve(process.cwd(), "defaults", "images", "menu.png"),
      path.resolve(process.cwd(), "assets", "images", "menu.png"),
      path.resolve(process.cwd(), "Defaults", "images", "logo.png"),
      path.resolve(process.cwd(), "assets", "logo.png")
    ]

    for (const imagePath of possiblePaths) {
      if (fs.existsSync(imagePath)) {
        logger.debug(`Loading bot logo from: ${imagePath}`)
        
        // Resize to 48x48 for thumbnail
        const thumbnail = await sharp(imagePath)
          .resize(48, 48, {
            fit: 'cover',
            position: 'center'
          })
          .jpeg({ quality: 70 })
          .toBuffer()
        
        // Convert to base64
        const base64Thumbnail = thumbnail.toString('base64')
        logger.info("✅ Bot logo thumbnail loaded and processed successfully")
        return base64Thumbnail
      }
    }
    
    logger.warn("⚠️ No bot logo found, using text-only fake quoted")
    return null
  } catch (error) {
    logger.error("Error loading bot logo thumbnail:", error.message)
    return null
  }
}

// Load thumbnail on module initialization
let BOT_LOGO_THUMBNAIL = null
loadBotLogoThumbnail().then(thumb => {
  BOT_LOGO_THUMBNAIL = thumb
}).catch(err => {
  logger.error("Failed to load bot logo:", err)
})

/**
 * Fake quoted presets for different categories
 */
function getFakeQuotedPresets() {
  const hasLogo = !!BOT_LOGO_THUMBNAIL
  
  // If we have a logo, use imageMessage style with thumbnail
  if (hasLogo) {
    return {
      ownermenu: {
        key: {
          participant: '0@s.whatsapp.net',
          remoteJid: '0@s.whatsapp.net'
        },
        message: {
          imageMessage: {
            caption: '*👑 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Owner Panel*',
            jpegThumbnail: BOT_LOGO_THUMBNAIL
          }
        }
      },

      vipmenu: {
        key: {
          participant: '0@s.whatsapp.net',
          remoteJid: '0@s.whatsapp.net'
        },
        message: {
          imageMessage: {
            caption: '*💎 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - VIP Access*',
            jpegThumbnail: BOT_LOGO_THUMBNAIL
          }
        }
      },

      groupmenu: {
        key: {
          participant: '0@s.whatsapp.net',
          remoteJid: '0@s.whatsapp.net'
        },
        message: {
          imageMessage: {
            caption: '*🛡️ 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Group Control*',
            jpegThumbnail: BOT_LOGO_THUMBNAIL
          }
        }
      },

      downloadmenu: {
        key: {
          participant: '0@s.whatsapp.net',
          remoteJid: '0@s.whatsapp.net'
        },
        message: {
          imageMessage: {
            caption: '*📥 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Media Downloader*',
            jpegThumbnail: BOT_LOGO_THUMBNAIL
          }
        }
      },

      aimenu: {
        key: {
          participant: '0@s.whatsapp.net',
          remoteJid: '0@s.whatsapp.net'
        },
        message: {
          imageMessage: {
            caption: '*🤖 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - AI Assistant*',
            jpegThumbnail: BOT_LOGO_THUMBNAIL
          }
        }
      },

      gamemenu: {
        key: {
          participant: '0@s.whatsapp.net',
          remoteJid: '0@s.whatsapp.net'
        },
        message: {
          imageMessage: {
            caption: '*🎮 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Game Center*',
            jpegThumbnail: BOT_LOGO_THUMBNAIL
          }
        }
      },

      convertmenu: {
        key: {
          participant: '0@s.whatsapp.net',
          remoteJid: '0@s.whatsapp.net'
        },
        message: {
          imageMessage: {
            caption: '*🔄 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Media Converter*',
            jpegThumbnail: BOT_LOGO_THUMBNAIL
          }
        }
      },

      mainmenu: {
        key: {
          participant: '0@s.whatsapp.net',
          remoteJid: '0@s.whatsapp.net'
        },
        message: {
          imageMessage: {
            caption: '*✨ 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙*',
            jpegThumbnail: BOT_LOGO_THUMBNAIL
          }
        }
      },

      default: {
        key: {
          participant: '0@s.whatsapp.net',
          remoteJid: '0@s.whatsapp.net'
        },
        message: {
          imageMessage: {
            caption: '*🤖 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙*',
            jpegThumbnail: BOT_LOGO_THUMBNAIL
          }
        }
      }
    }
  }
  
  // Fallback to text-only if no logo
  return {
    ownermenu: {
      key: {
        participant: '0@s.whatsapp.net',
        remoteJid: '0@s.whatsapp.net'
      },
      message: {
        conversation: '*👑 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Owner Panel*'
      }
    },

    vipmenu: {
      key: {
        participant: '0@s.whatsapp.net',
        remoteJid: '0@s.whatsapp.net'
      },
      message: {
        conversation: '*💎 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - VIP Access*'
      }
    },

    groupmenu: {
      key: {
        participant: '0@s.whatsapp.net',
        remoteJid: '0@s.whatsapp.net'
      },
      message: {
        conversation: '*🛡️ 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Group Control*'
      }
    },

    downloadmenu: {
      key: {
        participant: '0@s.whatsapp.net',
        remoteJid: '0@s.whatsapp.net'
      },
      message: {
        conversation: '*📥 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Media Downloader*'
      }
    },

    aimenu: {
      key: {
        participant: '0@s.whatsapp.net',
        remoteJid: '0@s.whatsapp.net'
      },
      message: {
        conversation: '*🤖 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - AI Assistant*'
      }
    },

    gamemenu: {
      key: {
        participant: '0@s.whatsapp.net',
        remoteJid: '0@s.whatsapp.net'
      },
      message: {
        conversation: '*🎮 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Game Center*'
      }
    },

    convertmenu: {
      key: {
        participant: '0@s.whatsapp.net',
        remoteJid: '0@s.whatsapp.net'
      },
      message: {
        conversation: '*🔄 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Media Converter*'
      }
    },

    mainmenu: {
      key: {
        participant: '0@s.whatsapp.net',
        remoteJid: '0@s.whatsapp.net'
      },
      message: {
        conversation: '*✨ 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙*'
      }
    },

    default: {
      key: {
        participant: '0@s.whatsapp.net',
        remoteJid: '0@s.whatsapp.net'
      },
      message: {
        conversation: '*🤖 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙*'
      }
    }
  }
}

/**
 * Determine which fake quoted preset to use based on message context
 */
function getFakeQuotedForContext(m, options = {}) {
  try {
    const PRESETS = getFakeQuotedPresets()
    
    // Priority 1: Manual override via options
    if (options.fakeQuotedType && PRESETS[options.fakeQuotedType]) {
      logger.debug(`Using manual fake quoted type: ${options.fakeQuotedType}`)
      return PRESETS[options.fakeQuotedType]
    }

    // Priority 2: Use plugin category from message object
    if (m.pluginCategory && PRESETS[m.pluginCategory]) {
      logger.debug(`Using fake quoted for category: ${m.pluginCategory}`)
      return PRESETS[m.pluginCategory]
    }

    // Priority 3: Detect from command name if available
    if (m.commandName) {
      const cmd = m.commandName.toLowerCase()
      
      // Check if command name contains category hints
      if (cmd.includes('owner') || cmd.includes('eval') || cmd.includes('exec')) {
        return PRESETS.ownermenu
      }
      if (cmd.includes('vip')) {
        return PRESETS.vipmenu
      }
      if (cmd.includes('group') || cmd.includes('anti') || cmd.includes('kick') || cmd.includes('promote')) {
        return PRESETS.groupmenu
      }
      if (cmd.includes('download') || cmd.includes('dl') || cmd.includes('video') || cmd.includes('song')) {
        return PRESETS.downloadmenu
      }
      if (cmd.includes('ai') || cmd.includes('gpt') || cmd.includes('chat')) {
        return PRESETS.aimenu
      }
      if (cmd.includes('game') || cmd.includes('play')) {
        return PRESETS.gamemenu
      }
      if (cmd.includes('sticker') || cmd.includes('convert')) {
        return PRESETS.convertmenu
      }
    }

    // Priority 4: Use user role
    if (m.isCreator || m.isOwner) {
      return PRESETS.ownermenu
    }

    // Priority 5: Check if in group for group-related
    if (m.isGroup) {
      return PRESETS.groupmenu
    }

    // Fallback to default
    return PRESETS.default

  } catch (error) {
    logger.error('Error determining fake quoted preset:', error)
    return getFakeQuotedPresets().default
  }
}

/**
 * Extend a Baileys socket with ALL helper methods and overrides
 */
export function extendSocket(sock) {
  if (!sock || sock._extended) {
    return sock
  }

  logger.debug("Extending socket with dynamic fake quoted system")

  // ==================== SEND MESSAGE OVERRIDE ====================
  const originalSendMessage = sock.sendMessage.bind(sock)
  
  sock.sendMessage = async (jid, content, options = {}) => {
    const maxRetries = 2
    let lastError = null
    
    // ========== DYNAMIC FAKE QUOTED MANAGEMENT ==========
    const isGroup = jid.endsWith('@g.us')
    let originalQuoted = options.quoted
    
    // Determine which fake quoted to use
    const PRESETS = getFakeQuotedPresets()
    let fakeQuoted = PRESETS.default
    
    if (originalQuoted) {
      // Get context-aware fake quoted
      fakeQuoted = getFakeQuotedForContext(originalQuoted, options)
      
      logger.debug(`[SendMessage] Using fake quoted type: ${originalQuoted.pluginCategory || 'default'}`)
      
      // If it's a group and we have the original quoted message, enhance with mention
      if (isGroup && originalQuoted.key?.participant) {
        const senderJid = originalQuoted.key.participant
        const pushName = originalQuoted.pushName || originalQuoted.verifiedBizName || 'User'
        
        // Clone the fake quoted and enhance it for group replies
        fakeQuoted = JSON.parse(JSON.stringify(fakeQuoted)) // Deep clone
        
        // Update the caption/conversation to show reply info
        if (fakeQuoted.message.imageMessage) {
          fakeQuoted.message.imageMessage.caption += `\n\n*Replied to ${pushName}*`
        } else if (fakeQuoted.message.conversation) {
          fakeQuoted.message.conversation += `\n\n*Replied to ${pushName}*`
        }
        
        // Add mention of the user being replied to
        const existingMentions = options.mentions || []
        if (!existingMentions.includes(senderJid)) {
          options.mentions = [...existingMentions, senderJid]
        }
        
        logger.debug(`[SendMessage] Enhanced group reply with mention for ${pushName}`)
      }
      
      // Replace original quoted with our fake quoted
      options.quoted = fakeQuoted
    } else {
      // No quoted provided, add default fake quoted
      logger.debug(`[SendMessage] Adding default fake quoted to message for ${jid}`)
      options.quoted = PRESETS.default
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
  const originalGroupMetadata = sock.groupMetadata?.bind(sock)
  sock._originalGroupMetadata = originalGroupMetadata
  
  if (originalGroupMetadata) {
    sock.groupMetadata = async (jid) => {
      const { getGroupMetadata } = await import('../core/config.js')
      return await getGroupMetadata(sock, jid, false)
    }

    sock.groupMetadataRefresh = async (jid) => {
      const { getGroupMetadata } = await import('../core/config.js')
      return await getGroupMetadata(sock, jid, true)
    }
  }

  // ==================== LID HELPER METHODS ====================
  sock.getLidForPn = async (phoneNumber) => {
    if (sock.signalRepository?.lidMapping?.getLIDForPN) {
      return await sock.signalRepository.lidMapping.getLIDForPN(phoneNumber)
    }
    return phoneNumber
  }

  sock.getPnForLid = async (lid) => {
    if (sock.signalRepository?.lidMapping?.getPNForLID) {
      return await sock.signalRepository.lidMapping.getPNForLID(lid)
    }
    return lid
  }

  // ==================== MEDIA HELPERS ====================
  
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

  sock.reply = async function (m, text) {
    return await this.sendMessage(
      m.chat || m.key.remoteJid,
      { text: text },
      { quoted: m }
    )
  }

  sock.react = async function (m, emoji) {
    return await this.sendMessage(m.chat || m.key.remoteJid, {
      react: {
        text: emoji,
        key: m.key,
      },
    })
  }

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

  logger.info("✅ Socket fully extended with dynamic fake quoted system")
  return sock
}

/**
 * Sleep/delay utility
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default { extendSocket }