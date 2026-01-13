import { createComponentLogger } from "../../utils/logger.js"
import { downloadMediaMessage } from "@nexustechpro/baileys"
import { image2webp, video2webp, getTempFilePath, cleanupTempFile } from "../../lib/converters/media-converter.js"
import { fileTypeFromBuffer } from "file-type"
import axios from "axios"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import sharp from "sharp"
import crypto from "crypto"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const logger = createComponentLogger("SOCKET_EXTENSIONS")

// ==================== DYNAMIC FAKE QUOTED SYSTEM ====================

/**
 * Load and process bot logo as thumbnail
 * Uses sharp to resize to 200x200 for WhatsApp thumbnails (higher quality)
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
        
        // Resize to 200x200 for higher quality thumbnail
        const thumbnail = await sharp(imagePath)
          .resize(200, 200, {
            fit: 'cover',
            position: 'center',
            kernel: sharp.kernel.lanczos3
          })
          .png({
            quality: 100,
            compressionLevel: 0,
            adaptiveFiltering: false,
            palette: false
          })
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

      toolmenu: {
        key: {
          participant: '0@s.whatsapp.net',
          remoteJid: '0@s.whatsapp.net'
        },
        message: {
          imageMessage: {
            caption: '*🔧 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Tool Center*',
            jpegThumbnail: BOT_LOGO_THUMBNAIL
          }
        }
      },

      searchmenu: {
        key: {
          participant: '0@s.whatsapp.net',
          remoteJid: '0@s.whatsapp.net'
        },
        message: {
          imageMessage: {
            caption: '*🔍 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Search Hub*',
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

    toolmenu: {
      key: {
        participant: '0@s.whatsapp.net',
        remoteJid: '0@s.whatsapp.net'
      },
      message: {
        conversation: '*🔧 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Tool Center*'
      }
    },

    searchmenu: {
      key: {
        participant: '0@s.whatsapp.net',
        remoteJid: '0@s.whatsapp.net'
      },
      message: {
        conversation: '*🔍 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Search Hub*'
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

    // Priority 5: Check if in group
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
 * Sleep/delay utility
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ==================== SOCKET EXTENSION ====================

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

    // ✅ ADD NEWSLETTER FORWARDING INFO
    const newsletterJid = process.env.WHATSAPP_CHANNEL_JID || '120363319098372999@newsletter'
    const botName = '𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙'
    const forwardInfo = {
      forwardingScore: 1,
      isForwarded: true,
      forwardedNewsletterMessageInfo: {
        newsletterJid: newsletterJid,
        newsletterName: botName,
        serverMessageId: -1
      }
    }
    
    // Determine which fake quoted to use
    const PRESETS = getFakeQuotedPresets()
    let fakeQuoted = PRESETS.default
    
    if (originalQuoted) {
      // Get context-aware fake quoted
      fakeQuoted = getFakeQuotedForContext(originalQuoted, options)
      
      logger.debug(`[SendMessage] Using fake quoted type: ${originalQuoted.pluginCategory || 'default'}`)
      
      // ✅ FIXED: Only add mention if we already have participant info
      if (isGroup && originalQuoted.key?.participant) {
        const senderJid = originalQuoted.key.participant
        const pushName = originalQuoted.pushName || originalQuoted.verifiedBizName || 'User'
        
        // Clone the fake quoted and enhance it for group replies
        fakeQuoted = JSON.parse(JSON.stringify(fakeQuoted))
        
        // Update the caption/conversation to show reply info
        if (fakeQuoted.message.imageMessage) {
          fakeQuoted.message.imageMessage.caption += `\n\n*Replied to ${pushName}*`
        } else if (fakeQuoted.message.conversation) {
          fakeQuoted.message.conversation += `\n\n*Replied to ${pushName}*`
        }
        
        logger.debug(`[SendMessage] Enhanced group reply for ${pushName}`)
      }
      
      // Replace original quoted with our fake quoted
      options.quoted = fakeQuoted
    } else {
      // No quoted provided, add default fake quoted
      logger.debug(`[SendMessage] Adding default fake quoted to message for ${jid}`)
      options.quoted = PRESETS.default
    }
    
    // ✅ ADD FORWARD INFO to all text messages
    if (content.text || content.caption) {
      if (!content.contextInfo) {
        content.contextInfo = {}
      }
      
      content.contextInfo = {
        ...content.contextInfo,
        ...forwardInfo
      }
      
      logger.debug(`[SendMessage] Added newsletter forward info to message`)
    }
    
    // ✅ CRITICAL FIX: Convert mentions array to proper format if exists
    if (options.mentions && Array.isArray(options.mentions) && options.mentions.length > 0) {
      options.mentions = options.mentions.map(m => {
        if (typeof m === 'string') {
          return m.includes('@') ? m : `${m}@s.whatsapp.net`
        }
        return m
      })
      logger.debug(`[SendMessage] Added ${options.mentions.length} mentions`)
    }
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Disable ephemeral messages by default
        if (!options.ephemeralExpiration) {
          options.ephemeralExpiration = 0
        }
        
        // Create send promise
        const sendPromise = originalSendMessage(jid, content, options)
        
        // Create timeout promise (200 seconds)
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('sendMessage timeout after 200s')), 200000)
        )
        
        // Race between send and timeout
        const result = await Promise.race([sendPromise, timeoutPromise])

        // ✅ MODIFY MESSAGE KEY ID - Add NEXUSBOT suffix AFTER message is sent
        if (result && result.key && result.key.id) {
          const originalId = result.key.id
          if (!originalId.endsWith('NEXUSBOT')) {
            result.key.id = `${originalId}NEXUSBOT`
            logger.debug(`Modified message ID: ${originalId} -> ${result.key.id}`)
          }
        }

        // Update session activity on success
        if (sock.sessionId) {
          const { updateSessionLastMessage } = await import('../core/config.js')
          updateSessionLastMessage(sock.sessionId)
        }
        
        logger.debug(`[SendMessage] Message sent successfully to ${jid}`)
        return result
        
      } catch (error) {
        lastError = error
        
        // ✅ SPECIAL HANDLING: If rate-limited and has mentions, retry without mentions
        if (error.message?.includes('rate-overlimit') && options.mentions) {
          logger.warn(`[SendMessage] Rate limited with mentions, retrying without mentions for ${jid}`)
          
          delete options.mentions
          
          try {
            const result = await originalSendMessage(jid, content, options)
            
            if (sock.sessionId) {
              const { updateSessionLastMessage } = await import('../core/config.js')
              updateSessionLastMessage(sock.sessionId)
            }
            
            logger.info(`[SendMessage] Successfully sent without mentions after rate limit`)
            return result
          } catch (fallbackError) {
            logger.error(`[SendMessage] Fallback without mentions also failed: ${fallbackError.message}`)
            lastError = fallbackError
          }
        }
        
        // Don't retry on specific errors
        const noRetryErrors = [
          'forbidden',
          'not-authorized',
          'invalid-jid',
          'recipient-not-found',
          'rate-overlimit'
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
          const delay = (attempt + 1) * 1000
          logger.warn(`[SendMessage] Send failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms: ${error.message}`)
          await sleep(delay)
          continue
        }
        
        logger.error(`[SendMessage] Failed to send message to ${jid} after ${maxRetries + 1} attempts: ${error.message}`)
        throw error
      }
    }
    
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

  // ==================== MEDIA CONVERSION HELPERS ====================
  
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

  // ==================== STICKER PACK SENDER ====================
  
  // Real working fallback WebP URLs from LearningContainer

const FALLBACK_WEBP_URLS = [
  'https://www.learningcontainer.com/wp-content/uploads/2020/08/Small-Sample-Webp-Image-file-download.webp',
  'https://img-06.stickers.cloud/packs/5df297e3-a7f0-44e0-a6d1-43bdb09b793c/webp/8709a42d-0579-4314-b659-9c2cdb979305.webp'
];

// Helper function to validate image format
async function validateImageUrl(url) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 5000
    });
    
    if (!response.ok) return false;
    
    const contentType = response.headers.get('content-type');
    // Check if it's a supported image format
    const supportedTypes = ['image/webp', 'image/png', 'image/jpeg', 'image/jpg'];
    return supportedTypes.some(type => contentType?.includes(type));
  } catch (error) {
    console.error(`Failed to validate URL: ${error.message}`);
    return false;
  }
}

// Helper function to download and validate image buffer
async function downloadAndValidateImage(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const buffer = Buffer.from(await response.arrayBuffer());
    
    if (!buffer || buffer.length === 0) {
      throw new Error('Empty buffer received');
    }
    
    // Validate buffer is an image by checking magic bytes
    const isWebP = buffer.length >= 12 &&
      buffer[0] === 0x52 && buffer[1] === 0x49 && 
      buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && 
      buffer[10] === 0x42 && buffer[11] === 0x50;
    
    const isPNG = buffer.length >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && 
      buffer[2] === 0x4E && buffer[3] === 0x47;
    
    const isJPEG = buffer.length >= 3 &&
      buffer[0] === 0xFF && buffer[1] === 0xD8 && 
      buffer[2] === 0xFF;
    
    if (!isWebP && !isPNG && !isJPEG) {
      throw new Error('Unsupported image format (not WebP, PNG, or JPEG)');
    }
    
    return { buffer, isValid: true };
  } catch (error) {
    return { buffer: null, isValid: false, error: error.message };
  }
}

sock.sendStickerPack = async function (jid, sources, options = {}) {
  const {
    packName = "Custom Sticker Pack",
    packPublisher = "𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙",
    packDescription = "",
    quoted = null
  } = options;

  const stickers = [];
  const failedStickers = [];

  try {
    console.log(`\n📦 Processing ${sources.length} stickers...`);
    
    // Process all stickers with validation
    for (let i = 0; i < sources.length; i++) {
      try {
        const source = sources[i];
        const progressText = `[${i + 1}/${sources.length}]`;
        console.log(`${progressText} Processing sticker...`);

        let stickerUrl = source.url || source;

        // Validate URL format
        if (typeof stickerUrl !== "string" || !/^https?:\/\//.test(stickerUrl)) {
          console.error(`${progressText} ❌ Invalid URL format`);
          failedStickers.push({ index: i, url: stickerUrl, reason: 'Invalid URL format' });
          continue;
        }

        // Validate image format (HEAD request first for efficiency)
        console.log(`${progressText} 🔍 Validating image format...`);
        const isValidFormat = await validateImageUrl(stickerUrl);
        
        if (!isValidFormat) {
          console.error(`${progressText} ❌ Unsupported image format or unreachable URL`);
          failedStickers.push({ index: i, url: stickerUrl, reason: 'Unsupported format or unreachable' });
          continue;
        }

        console.log(`${progressText} ✓ Valid sticker URL: ${stickerUrl}`);

        // Add sticker in correct format
        stickers.push({
          data: { url: stickerUrl },
          emojis: source.emojis || ["😊"],
          isLottie: source.isLottie || false,
          isAnimated: source.isAnimated || false,
          fileName: source.fileName,
          accessibilityLabel: source.accessibilityLabel
        });

      } catch (error) {
        console.error(`[${i + 1}/${sources.length}] ❌ Error: ${error.message}`);
        failedStickers.push({ index: i, url: sources[i], reason: error.message });
      }
    }

    console.log(`\n✓ Processing complete: ${stickers.length}/${sources.length} stickers valid`);
    
    if (failedStickers.length > 0) {
      console.log(`\n⚠️ Failed stickers (${failedStickers.length}):`);
      failedStickers.forEach(({ index, url, reason }) => {
        console.log(`  - Index ${index}: ${reason}`);
        console.log(`    URL: ${typeof url === 'string' ? url.substring(0, 80) : url}`);
      });
    }

    if (stickers.length === 0) {
      throw new Error("No valid sticker URLs were provided");
    }

    // Download cover from fallback URLs with validation
    console.log(`\n📥 Generating cover image from fallback URLs...`);
    let coverBuffer = null;
    
    for (const fallbackUrl of FALLBACK_WEBP_URLS) {
      try {
        console.log(`📥 Trying fallback: ${fallbackUrl}`);
        const { buffer, isValid, error } = await downloadAndValidateImage(fallbackUrl);
        
        if (isValid && buffer) {
          coverBuffer = buffer;
          console.log(`✓ Cover downloaded and validated (${coverBuffer.length} bytes)`);
          break;
        } else {
          console.error(`⚠️ Fallback failed: ${error}`);
        }
      } catch (fallbackError) {
        console.error(`⚠️ Fallback error: ${fallbackError.message}`);
        continue;
      }
    }

    if (!coverBuffer || coverBuffer.length === 0) {
      throw new Error('Failed to download valid cover from any fallback URL');
    }

    // Send the sticker pack
    console.log(`\n📤 Sending sticker pack with ${stickers.length} stickers...`);
    console.log(`📤 Cover buffer size: ${coverBuffer.length} bytes`);
    
    const stickerPackContent = {
      stickerPack: {
        name: packName,
        publisher: packPublisher,
        description: packDescription,
        cover: coverBuffer,
        stickers: stickers
      }
    };
    
    const result = await this.sendMessage(jid, stickerPackContent, { quoted });

    console.log(`✓ Sticker pack sent successfully!\n`);

    return {
      success: true,
      packName,
      stickerCount: stickers.length,
      totalCount: sources.length,
      failedCount: failedStickers.length,
      failedStickers: failedStickers,
      result
    };

  } catch (error) {
    console.error('❌ Error sending sticker pack:', error);
    throw error;
  }
};

  // ==================== BASIC MEDIA SENDERS ====================

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

  // ==================== CONVENIENCE METHODS ====================

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

  sock.downloadMedia = async (msg) => {
    try {
      // Auto-detect: if msg has quoted and no direct media, use quoted
      let messageToDownload = msg
      
      // Check if current message has media
      const hasDirectMedia = msg.message?.imageMessage || 
                            msg.message?.videoMessage || 
                            msg.message?.audioMessage ||
                            msg.message?.documentMessage ||
                            msg.message?.stickerMessage
      
      // If no direct media but has quoted with media, use quoted
      if (!hasDirectMedia && msg.quoted?.message) {
        const hasQuotedMedia = msg.quoted.message?.imageMessage || 
                              msg.quoted.message?.videoMessage || 
                              msg.quoted.message?.audioMessage ||
                              msg.quoted.message?.documentMessage ||
                              msg.quoted.message?.stickerMessage
        
        if (hasQuotedMedia) {
          messageToDownload = msg.quoted
        }
      }
      
      const buffer = await downloadMediaMessage(
        messageToDownload,
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

  logger.info("✅ Socket fully extended with all helper methods")
  return sock
}

export default { extendSocket }