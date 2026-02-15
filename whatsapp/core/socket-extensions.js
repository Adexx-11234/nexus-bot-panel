import { createComponentLogger } from "../../utils/logger.js"
import { downloadMediaMessage } from "@nexustechpro/baileys"
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

const PRESET_CAPTIONS = {
  ownermenu: '*👑 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Owner Panel*',
  vipmenu: '*💎 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - VIP Access*',
  groupmenu: '*🛡️ 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Group Control*',
  downloadmenu: '*📥 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Media Downloader*',
  aimenu: '*🤖 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - AI Assistant*',
  toolmenu: '*🔧 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Tool Center*',
  searchmenu: '*🔍 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Search Hub*',
  gamemenu: '*🎮 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Game Center*',
  convertmenu: '*🔄 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙 - Media Converter*',
  mainmenu: '*✨ 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙*',
  default: '*🤖 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙*'
}

let BOT_LOGO_THUMBNAIL = null

async function loadBotLogoThumbnail() {
  try {
    const paths = [
      path.resolve(process.cwd(), "Defaults", "images", "menu.png"),
      path.resolve(process.cwd(), "defaults", "images", "menu.png"),
      path.resolve(process.cwd(), "assets", "images", "menu.png"),
      path.resolve(process.cwd(), "Defaults", "images", "logo.png"),
      path.resolve(process.cwd(), "assets", "logo.png")
    ]

    for (const imagePath of paths) {
      if (fs.existsSync(imagePath)) {
        logger.debug(`Loading bot logo from: ${imagePath}`)
        const thumbnail = await sharp(imagePath)
          .resize(200, 200, { fit: 'cover', position: 'center', kernel: sharp.kernel.lanczos3 })
          .png({ quality: 100, compressionLevel: 0, adaptiveFiltering: false, palette: false })
          .toBuffer()
        BOT_LOGO_THUMBNAIL = thumbnail.toString('base64')
        logger.info("✅ Bot logo thumbnail loaded")
        return BOT_LOGO_THUMBNAIL
      }
    }
    logger.warn("⚠️ No bot logo found")
    return null
  } catch (error) {
    logger.error("Error loading bot logo:", error.message)
    return null
  }
}

loadBotLogoThumbnail().catch(err => logger.error("Failed to load bot logo:", err))

const createFakeQuoted = (type = 'default', additional = {}) => {
  const caption = PRESET_CAPTIONS[type] || PRESET_CAPTIONS.default
  const base = {
    key: { participant: '0@s.whatsapp.net', remoteJid: '0@s.whatsapp.net' },
    message: BOT_LOGO_THUMBNAIL
      ? { imageMessage: { caption } }
      : { conversation: caption }
  }
  return { ...base, ...additional }
}

const getFakeQuotedForContext = (m, options = {}) => {
  try {
    if (options.fakeQuotedType) return createFakeQuoted(options.fakeQuotedType)
    if (m.pluginCategory) return createFakeQuoted(m.pluginCategory)
    
    if (m.commandName) {
      const cmd = m.commandName.toLowerCase()
      if (cmd.includes('owner') || cmd.includes('eval')) return createFakeQuoted('ownermenu')
      if (cmd.includes('vip')) return createFakeQuoted('vipmenu')
      if (cmd.includes('group') || cmd.includes('anti') || cmd.includes('kick')) return createFakeQuoted('groupmenu')
      if (cmd.includes('download') || cmd.includes('dl') || cmd.includes('video')) return createFakeQuoted('downloadmenu')
      if (cmd.includes('ai') || cmd.includes('gpt') || cmd.includes('chat')) return createFakeQuoted('aimenu')
      if (cmd.includes('game')) return createFakeQuoted('gamemenu')
      if (cmd.includes('sticker') || cmd.includes('convert')) return createFakeQuoted('convertmenu')
    }

    if (m.isCreator || m.isOwner) return createFakeQuoted('ownermenu')
    if (m.isGroup) return createFakeQuoted('groupmenu')
    
    return createFakeQuoted('default')
  } catch (error) {
    logger.error('Error determining fake quoted preset:', error)
    return createFakeQuoted('default')
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const addForwardInfo = (content) => {
  const newsletterJid = process.env.WHATSAPP_CHANNEL_JID || '120363319098372999@newsletter'
  const botName = '𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙'
  
  return {
        forwardingScore: 1,
        isForwarded: true,
    forwardedNewsletterMessageInfo: {
      newsletterJid, newsletterName: botName, serverMessageId: -1
    }
  }
}

const processSticker = async (source, index, total) => {
  try {
    let buffer = source.buffer || source

    if (source.url || (typeof buffer === "string" && /^https?:\/\//.test(buffer))) {
      const response = await axios.get(source.url || buffer, { responseType: "arraybuffer", timeout: 30000 })
      buffer = Buffer.from(response.data)
    }

    const fileType = await fileTypeFromBuffer(buffer)
    const mime = fileType?.mime || ""
    const isVideo = source.isVideo || mime.startsWith("video/") || mime === "image/gif"
    const stickerBuffer = isVideo ? await video2webp(buffer) : await image2webp(buffer)

    return { buffer: stickerBuffer, emojis: source.emojis || ["😊"], isAnimated: isVideo, accessibilityLabel: source.accessibilityLabel, index }
  } catch (error) {
    logger.error(`Error processing sticker ${index}/${total}: ${error.message}`)
    return null
  }
}

const processStickersConcurrently = async (sources, concurrency = 5) => {
  const processed = []
  for (let i = 0; i < sources.length; i += concurrency) {
    const batch = sources.slice(i, i + concurrency)
    const promises = batch.map((s, idx) => processSticker(s, i + idx, sources.length))
    const results = await Promise.all(promises)
    processed.push(...results.filter(Boolean))
  }
  processed.sort((a, b) => a.index - b.index)
  return processed
}

export function extendSocket(sock) {
  if (!sock || sock._extended) return sock

  logger.debug("Extending socket with optimized fake quoted system")

  const originalSendMessage = sock.sendMessage.bind(sock)
  const maxRetries = 2

  sock.sendMessage = async (jid, content, options = {}) => {
    let lastError = null
    const isGroup = jid.endsWith('@g.us')
    const forwardInfo = addForwardInfo()
    
  // let fakeQuoted = createFakeQuoted('default')
  
  // if (options.quoted) {
  //   fakeQuoted = getFakeQuotedForContext(options.quoted, options)
    
  //   if (isGroup && options.quoted.key?.participant) {
  //     const senderJid = options.quoted.key.participant
  //     const pushName = options.quoted.pushName || 'User'
  //     fakeQuoted = JSON.parse(JSON.stringify(fakeQuoted))
      
  //     if (fakeQuoted.message.imageMessage) {
  //       fakeQuoted.message.imageMessage.caption += `\n\n*Replied to ${pushName}*`
  //     } else if (fakeQuoted.message.conversation) {
  //       fakeQuoted.message.conversation += `\n\n*Replied to ${pushName}*`
  //     }
  //   }
  //   options.quoted = fakeQuoted
  // } else {
  //   options.quoted = createFakeQuoted('default')
  // }
    if (content.text || content.caption) {
      if (!content.contextInfo) content.contextInfo = {}
      content.contextInfo = { ...content.contextInfo, ...forwardInfo }
    }
    
    if (options.mentions && Array.isArray(options.mentions)) {
      options.mentions = options.mentions.map(m => typeof m === 'string' && !m.includes('@') ? `${m}@s.whatsapp.net` : m)
    }
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
       // options.ephemeralExpiration ||= 0
        
        const sendPromise = originalSendMessage(jid, content, options)
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('sendMessage timeout')), 200000))
        const result = await Promise.race([sendPromise, timeoutPromise])

     //   if (result?.key?.id && !result.key.id.endsWith('NEXUSBOT')) {
         // result.key.id = `${result.key.id}NEXUSBOT`
       // }

        if (sock.sessionId) {
          try { const { updateSessionLastMessage } = await import('../core/config.js'); updateSessionLastMessage(sock.sessionId) } catch {}
        }
        
        logger.debug(`Message sent to ${jid}`)
        return result
        
      } catch (error) {
        lastError = error
        
        if (error.message?.includes('rate-overlimit') && options.mentions) {
          logger.warn(`Rate limited, retrying without mentions for ${jid}`)
          delete options.mentions
          
          try {
            const result = await originalSendMessage(jid, content, options)
            if (sock.sessionId) {
              try { const { updateSessionLastMessage } = await import('../core/config.js'); updateSessionLastMessage(sock.sessionId) } catch {}
            }
            return result
          } catch (fallbackError) {
            lastError = fallbackError
          }
        }
        
        const noRetryErrors = ['forbidden', 'not-authorized', 'invalid-jid', 'recipient-not-found', 'rate-overlimit']
        const shouldNotRetry = noRetryErrors.some(err => error.message?.toLowerCase().includes(err))
        
        if (shouldNotRetry) {
          logger.error(`Non-retryable error: ${error.message}`)
          throw error
        }
        
        if (attempt < maxRetries) {
          const delay = (attempt + 1) * 1000
          logger.warn(`Send failed (attempt ${attempt + 1}), retrying in ${delay}ms`)
          await sleep(delay)
          continue
        }
        
        logger.error(`Failed after ${maxRetries + 1} attempts: ${error.message}`)
        throw error
      }
    }
    throw lastError || new Error('Unknown sendMessage error')
  }

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

  sock.getLidForPn = async (phoneNumber) => sock.signalRepository?.lidMapping?.getLIDForPN?.(phoneNumber) || phoneNumber
  sock.getPnForLid = async (lid) => sock.signalRepository?.lidMapping?.getPNForLID?.(lid) || lid

  const createMediaSender = (mediaKey, ext, mimeType, options = {}) => async function (jid, source, caption = "", opts = {}) {
    let tempFile = null
    try {
      let buffer = source
      if (typeof source === "string" && /^https?:\/\//.test(source)) {
        const response = await axios.get(source, { responseType: "arraybuffer" })
        buffer = Buffer.from(response.data)
      }
      tempFile = getTempFilePath(mediaKey, ext)
      fs.writeFileSync(tempFile, buffer)
      return await this.sendMessage(jid, { [mediaKey]: fs.readFileSync(tempFile), caption, ...options }, { quoted: opts.quoted })
    } catch (error) {
      logger.error(`${mediaKey} error:`, error.message)
      throw error
    } finally {
      if (tempFile) cleanupTempFile(tempFile)
    }
  }

  sock.sendImage = createMediaSender('image', '.jpg', 'image/jpeg')
  sock.sendVideo = createMediaSender('video', '.mp4', 'video/mp4', { gifPlayback: false })
  sock.sendAudio = createMediaSender('audio', '.mp3', 'audio/mpeg', { mimetype: 'audio/mpeg', ptt: false })

  sock.sendDocument = async function (jid, source, filename, options = {}) {
    let tempFile = null
    try {
      let buffer = source
      if (typeof source === "string" && /^https?:\/\//.test(source)) {
        const response = await axios.get(source, { responseType: "arraybuffer" })
        buffer = Buffer.from(response.data)
      }
      const fileType = await fileTypeFromBuffer(buffer)
      tempFile = getTempFilePath('sendDocument', `.${fileType?.ext || 'bin'}`)
      fs.writeFileSync(tempFile, buffer)
      return await this.sendMessage(jid, { document: fs.readFileSync(tempFile), mimetype: options.mimetype || fileType?.mime || "application/octet-stream", fileName: filename }, { quoted: options.quoted })
    } catch (error) {
      logger.error("sendDocument error:", error.message)
      throw error
    } finally {
      if (tempFile) cleanupTempFile(tempFile)
    }
  }

  const createStickerSender = (converter) => async function (jid, source, options = {}) {
    let tempFile = null
    try {
      let buffer = source
      if (typeof source === "string" && /^https?:\/\//.test(source)) {
        const response = await axios.get(source, { responseType: "arraybuffer" })
        buffer = Buffer.from(response.data)
      }
      const stickerBuffer = await converter(buffer)
      tempFile = getTempFilePath('sticker', '.webp')
      fs.writeFileSync(tempFile, stickerBuffer)
      return await this.sendMessage(jid, { sticker: fs.readFileSync(tempFile) }, { quoted: options.quoted })
    } catch (error) {
      logger.error("Sticker sender error:", error.message)
      throw error
    } finally {
      if (tempFile) cleanupTempFile(tempFile)
    }
  }

  sock.sendImageAsSticker = createStickerSender(image2webp)
  sock.sendVideoAsSticker = createStickerSender(video2webp)

  sock.sendMediaAsSticker = async function (jid, source, options = {}) {
    let tempFile = null
    try {
      let buffer = source
      if (typeof source === "string" && /^https?:\/\//.test(source)) {
        const response = await axios.get(source, { responseType: "arraybuffer" })
        buffer = Buffer.from(response.data)
      }
      const fileType = await fileTypeFromBuffer(buffer)
      const mime = fileType?.mime || ""
      const stickerBuffer = mime.startsWith("video/") || mime === "image/gif" ? await video2webp(buffer) : await image2webp(buffer)
      tempFile = getTempFilePath('sticker', '.webp')
      fs.writeFileSync(tempFile, stickerBuffer)
      return await this.sendMessage(jid, { sticker: fs.readFileSync(tempFile) }, { quoted: options.quoted })
    } catch (error) {
      logger.error("sendMediaAsSticker error:", error.message)
      throw error
    } finally {
      if (tempFile) cleanupTempFile(tempFile)
    }
  }

  sock.sendStickerPack = async function (jid, sources, options = {}) {
    const { packName = "Custom Sticker Pack", packPublisher = "𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙", packDescription = "𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙", quoted = null, concurrency = 5 } = options
    try {
      const processedStickers = await processStickersConcurrently(sources, concurrency)
      if (!processedStickers.length) throw new Error("No stickers processed")
      
      const stickerPackContent = {
        stickerPack: {
          name: packName, publisher: packPublisher, description: packDescription,
          cover: processedStickers[0].buffer,
          stickers: processedStickers.map((s, idx) => ({ 
            data: s.buffer, 
            emojis: s.emojis, 
            isAnimated: s.isAnimated, 
            accessibilityLabel: s.accessibilityLabel,
            name: s.name || `Sticker ${idx + 1}` // Add name field, fallback to index if not provided
          }))
        }
      }
      
      const result = await this.sendMessage(jid, stickerPackContent, { quoted })
      logger.info(`✅ Sent ${processedStickers.length} stickers`)
      return { success: true, packName, totalStickersSent: processedStickers.length, totalStickersRequested: sources.length, result }
    } catch (error) {
      logger.error('Error sending sticker pack:', error)
      throw error
    }
  }
  
  sock.reply = async function (m, text) {
    return await this.sendMessage(m.chat || m.key.remoteJid, { text }, { quoted: m })
  }

  sock.react = async function (m, emoji) {
    return await this.sendMessage(m.chat || m.key.remoteJid, { react: { text: emoji, key: m.key } })
  }

  sock.downloadMedia = async (msg) => {
    try {
      let messageToDownload = msg
      const hasDirectMedia = msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.audioMessage || msg.message?.documentMessage || msg.message?.stickerMessage
      
      if (!hasDirectMedia && msg.quoted?.message) {
        const hasQuotedMedia = msg.quoted.message?.imageMessage || msg.quoted.message?.videoMessage || msg.quoted.message?.audioMessage || msg.quoted.message?.documentMessage || msg.quoted.message?.stickerMessage
        if (hasQuotedMedia) messageToDownload = msg.quoted
      }
      
      return await downloadMediaMessage(messageToDownload, "buffer", {}, { logger: console, reuploadRequest: sock.updateMediaMessage })
    } catch (error) {
      logger.error("downloadMedia error:", error.message)
      throw error
    }
  }

  sock._extended = true
  logger.info("✅ Socket fully extended")
  return sock
}

export default { extendSocket }