import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("VIRTEX_PROTECTION")

let externalValidator = null
try {
  const gs = await import("guaranteed_security")
  if (gs && gs.isValidMessage) {
    externalValidator = gs.isValidMessage
    logger.info("[VirtexProtection] Using guaranteed_security package")
  }
} catch (e) {
  logger.debug("[VirtexProtection] guaranteed_security not available, using built-in")
}

/**
 * Virtex/Malicious Message Protection
 * Uses guranteed-security package patterns for message validation
 */

// Default thresholds
const DEFAULT_OPTIONS = {
  maxTextLength: 250000,
  maxInvisibleCharCount: 5000,
  maxInvisibleCharRatio: 0.5,
  maxMentionCount: 1000,
  maxAlbumItems: 50,
  maxMediaDuration: 3600,
  maxFileSize: 2 * 1024 * 1024 * 1024, // 2GB
  maxPageCount: 1000000,
  maxExternalAdReplyLength: 5000,
  maxParamsJsonLength: 10000,
  maxVideoAnnotationAuthorLength: 5000,
  maxListRows: 1000,
  maxButtonCount: 100,
  maxLocationCommentLength: 5000,
  maxContactDisplayNameLength: 5000,
  maxLiveLocationSequenceNumber: 999999999,
  maxProductImageCount: 100,
  maxOrderItemCount: 1000,
}

// Invisible characters pattern
const INVISIBLE_CHARS =
  /[\u200B-\u200D\u2060\u2061\u2062\u2063\u2064\uFEFF\u00AD\u034F\u061C\u17B4\u17B5\u180E\u2000-\u200F\u202A-\u202F\u205F-\u2064\u206A-\u206F\u3000\uFFA0]/g

/**
 * Analyze a WhatsApp message for malicious content
 * Uses guranteed-security if available, otherwise built-in checks
 */
export function analyzeMessage(message, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // Handle null/undefined
  if (!message) {
    return { isMalicious: false, reason: null }
  }

  try {
    if (externalValidator) {
      try {
        const result = externalValidator(message, opts)
        if (result && !result.isValid) {
          return { isMalicious: true, reason: result.reason || "External validation failed" }
        }
      } catch (e) {
        // Fall through to built-in checks
      }
    }

    // Check text content
    const textResult = checkTextContent(message, opts)
    if (textResult.isMalicious) return textResult

    // Check mentions
    const mentionResult = checkMentions(message, opts)
    if (mentionResult.isMalicious) return mentionResult

    // Check media properties
    const mediaResult = checkMediaProperties(message, opts)
    if (mediaResult.isMalicious) return mediaResult

    // Check buttons/lists
    const uiResult = checkUIElements(message, opts)
    if (uiResult.isMalicious) return uiResult

    // Check protocol abuse
    const protocolResult = checkProtocolAbuse(message, opts)
    if (protocolResult.isMalicious) return protocolResult

    return { isMalicious: false, reason: null }
  } catch (error) {
    logger.error("Message analysis error:", error.message)
    return { isMalicious: false, reason: null }
  }
}

/**
 * Check text content for malicious patterns
 */
function checkTextContent(message, opts) {
  // Get text from various message types
  const text =
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    ""

  if (!text) return { isMalicious: false, reason: null }

  // Check extreme length
  if (text.length > opts.maxTextLength) {
    return { isMalicious: true, reason: "Extreme text length" }
  }

  // Check invisible characters
  const invisibleMatches = text.match(INVISIBLE_CHARS) || []
  if (invisibleMatches.length > opts.maxInvisibleCharCount) {
    return { isMalicious: true, reason: "High density of invisible characters" }
  }

  // Check invisible char ratio
  if (text.length > 100) {
    const ratio = invisibleMatches.length / text.length
    if (ratio > opts.maxInvisibleCharRatio) {
      return { isMalicious: true, reason: "High ratio of invisible characters" }
    }
  }

  // Check for pairing code injection (fake WebSocket URLs)
  if (text.includes("wss://") || text.includes("ws://") || /pairing[_-]?code/i.test(text)) {
    const wsPattern = /wss?:\/\/[^\s]+web\.whatsapp\.com/i
    if (wsPattern.test(text)) {
      return { isMalicious: true, reason: "Potential pairing code injection" }
    }
  }

  return { isMalicious: false, reason: null }
}

/**
 * Check for mention bombing
 */
function checkMentions(message, opts) {
  // Check extended text message mentions
  const contextInfo =
    message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.videoMessage?.contextInfo ||
    message.documentMessage?.contextInfo

  if (contextInfo?.mentionedJid) {
    if (contextInfo.mentionedJid.length > opts.maxMentionCount) {
      return { isMalicious: true, reason: "Massive mention count" }
    }
  }

  return { isMalicious: false, reason: null }
}

/**
 * Check media properties for abuse
 */
function checkMediaProperties(message, opts) {
  // Check video
  if (message.videoMessage) {
    const video = message.videoMessage
    if (video.seconds && video.seconds > opts.maxMediaDuration) {
      return { isMalicious: true, reason: "Bug: Media with unreasonable duration" }
    }
    if (video.fileLength) {
      const size = typeof video.fileLength === "string" ? Number.parseInt(video.fileLength) : video.fileLength
      if (size > opts.maxFileSize) {
        return { isMalicious: true, reason: "Bug: Media with unreasonable file size" }
      }
    }
  }

  // Check audio
  if (message.audioMessage) {
    const audio = message.audioMessage
    if (audio.seconds && audio.seconds > opts.maxMediaDuration) {
      return { isMalicious: true, reason: "Bug: Media with unreasonable duration" }
    }
    if (audio.fileLength) {
      const size = typeof audio.fileLength === "string" ? Number.parseInt(audio.fileLength) : audio.fileLength
      if (size > opts.maxFileSize) {
        return { isMalicious: true, reason: "Bug: Media with unreasonable file size" }
      }
    }
  }

  // Check document
  if (message.documentMessage) {
    const doc = message.documentMessage
    if (doc.pageCount && doc.pageCount > opts.maxPageCount) {
      return { isMalicious: true, reason: "Bug: Document with unreasonable page count" }
    }
    if (doc.fileLength) {
      const size = typeof doc.fileLength === "string" ? Number.parseInt(doc.fileLength) : doc.fileLength
      if (size > opts.maxFileSize) {
        return { isMalicious: true, reason: "Bug: Document with unreasonable file size" }
      }
    }
  }

  // Check video annotation
  if (message.videoMessage?.annotations) {
    for (const annotation of message.videoMessage.annotations) {
      if (annotation.author && annotation.author.length > opts.maxVideoAnnotationAuthorLength) {
        return { isMalicious: true, reason: "Bug: Video with oversized annotation" }
      }
    }
  }

  return { isMalicious: false, reason: null }
}

/**
 * Check UI elements (buttons, lists) for flooding
 */
function checkUIElements(message, opts) {
  // Check buttons message
  if (message.buttonsMessage) {
    const buttons = message.buttonsMessage.buttons || []
    if (buttons.length > opts.maxButtonCount) {
      return { isMalicious: true, reason: "Bug: Message with excessive buttons" }
    }
  }

  // Check template buttons
  if (message.templateMessage?.hydratedTemplate?.hydratedButtons) {
    const buttons = message.templateMessage.hydratedTemplate.hydratedButtons
    if (buttons.length > opts.maxButtonCount) {
      return { isMalicious: true, reason: "Bug: Template with excessive buttons" }
    }
  }

  // Check list message
  if (message.listMessage) {
    let totalRows = 0
    const sections = message.listMessage.sections || []
    for (const section of sections) {
      totalRows += (section.rows || []).length
    }
    if (totalRows > opts.maxListRows) {
      return { isMalicious: true, reason: "Bug: List with excessive rows" }
    }
  }

  // Check interactive message buttons
  if (message.interactiveMessage?.nativeFlowMessage?.buttons) {
    const buttons = message.interactiveMessage.nativeFlowMessage.buttons
    if (buttons.length > opts.maxButtonCount) {
      return { isMalicious: true, reason: "Bug: Interactive message with excessive buttons" }
    }
  }

  return { isMalicious: false, reason: null }
}

/**
 * Check for protocol abuse
 */
function checkProtocolAbuse(message, opts) {
  // Check external ad reply
  if (message.extendedTextMessage?.contextInfo?.externalAdReply) {
    const adReply = message.extendedTextMessage.contextInfo.externalAdReply
    const totalLength = (adReply.title?.length || 0) + (adReply.body?.length || 0) + (adReply.thumbnailUrl?.length || 0)
    if (totalLength > opts.maxExternalAdReplyLength) {
      return { isMalicious: true, reason: "Bug: External ad reply abuse" }
    }
  }

  // Check location comment
  if (message.locationMessage?.comment) {
    if (message.locationMessage.comment.length > opts.maxLocationCommentLength) {
      return { isMalicious: true, reason: "Bug: Location with oversized comment" }
    }
  }

  // Check live location
  if (message.liveLocationMessage?.sequenceNumber) {
    if (message.liveLocationMessage.sequenceNumber > opts.maxLiveLocationSequenceNumber) {
      return { isMalicious: true, reason: "Bug: Live location with invalid sequence" }
    }
  }

  // Check contact display name
  if (message.contactMessage?.displayName) {
    if (message.contactMessage.displayName.length > opts.maxContactDisplayNameLength) {
      return { isMalicious: true, reason: "Bug: Contact with oversized display name" }
    }
  }

  // Check product message
  if (message.productMessage?.product?.productImageCount) {
    if (message.productMessage.product.productImageCount > opts.maxProductImageCount) {
      return { isMalicious: true, reason: "Bug: Product with excessive images" }
    }
  }

  // Check order message
  if (message.orderMessage?.itemCount) {
    if (message.orderMessage.itemCount > opts.maxOrderItemCount) {
      return { isMalicious: true, reason: "Bug: Order with excessive items" }
    }
  }

  return { isMalicious: false, reason: null }
}

/**
 * Quick check for spam patterns
 */
export function isSpamMessage(message, recentMessages = []) {
  if (!message) return { isSpam: false, reason: null }

  try {
    // Get message text
    const text = message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || ""

    if (!text) return { isSpam: false, reason: null }

    // Check for repeated messages
    if (recentMessages.length >= 5) {
      const duplicates = recentMessages.filter((m) => m === text).length
      if (duplicates >= 3) {
        return { isSpam: true, reason: "Repeated message spam" }
      }
    }

    // Check for character spam (same char repeated)
    const charSpamPattern = /(.)\1{50,}/
    if (charSpamPattern.test(text)) {
      return { isSpam: true, reason: "Character repetition spam" }
    }

    return { isSpam: false, reason: null }
  } catch (error) {
    return { isSpam: false, reason: null }
  }
}

/**
 * Add function to check using the raw message object from Baileys
 */
export function checkRawMessage(rawMsg) {
  if (!rawMsg || !rawMsg.message) {
    return { isMalicious: false, reason: null }
  }

  const message = rawMsg.message

  // Check viewOnceMessage wrapper
  if (message.viewOnceMessage?.message) {
    return analyzeMessage(message.viewOnceMessage.message)
  }

  // Check viewOnceMessageV2 wrapper
  if (message.viewOnceMessageV2?.message) {
    return analyzeMessage(message.viewOnceMessageV2.message)
  }

  // Check ephemeralMessage wrapper
  if (message.ephemeralMessage?.message) {
    return analyzeMessage(message.ephemeralMessage.message)
  }

  // Check documentWithCaptionMessage wrapper
  if (message.documentWithCaptionMessage?.message) {
    return analyzeMessage(message.documentWithCaptionMessage.message)
  }

  return analyzeMessage(message)
}

export default {
  analyzeMessage,
  isSpamMessage,
  checkRawMessage,
  DEFAULT_OPTIONS,
}
