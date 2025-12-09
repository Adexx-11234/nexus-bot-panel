//UTILS/JID.JS
import { jidDecode } from '@whiskeysockets/baileys'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('JID_UTILS')

/**
 * ============================================================================
 * CORE JID NORMALIZATION - BAILEYS 7.X COMPATIBLE
 * ============================================================================
 * Handles :0, :1, :16 device suffixes added by Baileys 7.x multi-device
 */

/**
 * Normalize JID - removes :0, :1, etc suffixes from Baileys 7.x
 * Examples:
 *   2348162352322:0@s.whatsapp.net → 2348162352322@s.whatsapp.net
 *   120363418879636966@g.us → 120363418879636966@g.us (unchanged)
 */
export function normalizeJid(jid) {
  if (!jid) return null

  try {
    // Don't normalize LIDs - they need special handling
    if (jid.endsWith('@lid')) {
      return jid
    }

    // ✅ CRITICAL: Remove :0, :1, :16, etc. suffix BEFORE decoding
    // Format: 2348162352322:0@s.whatsapp.net → 2348162352322@s.whatsapp.net
    let cleanedJid = jid
    if (jid.includes(':') && jid.includes('@')) {
      const [numberPart, domain] = jid.split('@')
      const phoneNumber = numberPart.split(':')[0]
      cleanedJid = `${phoneNumber}@${domain}`
    }

    // Try to decode using Baileys
    const decoded = jidDecode(cleanedJid)
    if (decoded?.user) {
      // Handle group JIDs
      if (decoded.server === 'g.us') {
        return `${decoded.user}@g.us`
      }
      // Handle regular user JIDs
      if (decoded.server === 's.whatsapp.net') {
        return `${decoded.user}@s.whatsapp.net`
      }
    }
  } catch (error) {
    // Fallback if jidDecode fails
    logger.debug(`JID decode failed for ${jid}, using fallback`)
  }

  // Fallback normalization with device suffix removal
  return formatJid(jid)
}

/**
 * Format JID to standard format
 * Simpler version without decoding
 */
export function formatJid(jid) {
  if (!jid) return null

  // ✅ Remove :0, :1, :16 device suffixes FIRST
  let cleaned = jid
  if (jid.includes(':') && jid.includes('@')) {
    const [numberPart, domain] = jid.split('@')
    const phoneNumber = numberPart.split(':')[0]
    cleaned = `${phoneNumber}@${domain}`
  }

  // Remove extra characters (but keep @ and .)
  cleaned = cleaned.replace(/[^\d@.]/g, '')

  // Already formatted group JID
  if (cleaned.includes('@g.us')) {
    return cleaned
  }

  // Already formatted user JID
  if (cleaned.includes('@s.whatsapp.net')) {
    return cleaned
  }

  // Just a phone number - format as user JID
  if (/^\d+$/.test(cleaned)) {
    return `${cleaned}@s.whatsapp.net`
  }

  return cleaned
}

/**
 * ============================================================================
 * JID TYPE CHECKING
 * ============================================================================
 */

/**
 * Check if JID is a group
 */
export function isGroupJid(jid) {
  return jid && jid.endsWith('@g.us')
}

/**
 * Check if JID is a user (not group)
 */
export function isUserJid(jid) {
  return jid && jid.endsWith('@s.whatsapp.net')
}

/**
 * Check if JID is a LID (Lightweight ID)
 */
export function isLid(jid) {
  return jid && jid.endsWith('@lid')
}

/**
 * Check if JID is a LID (alias for consistency)
 */
export function isLidJid(jid) {
  return isLid(jid)
}

/**
 * ============================================================================
 * JID EXTRACTION AND PARSING
 * ============================================================================
 */

/**
 * Extract phone number from JID (without device suffix)
 */
export function extractPhoneNumber(jid) {
  if (!jid) return null

  try {
    // ✅ Remove device suffix before extraction
    const normalized = normalizeJid(jid)
    const decoded = jidDecode(normalized)
    return decoded?.user || null
  } catch (error) {
    // Fallback: extract manually
    const cleaned = jid.split(':')[0] // Remove :0, :1, etc.
    const match = cleaned.match(/^(\d+)/)
    return match ? match[1] : null
  }
}

/**
 * Extract phone number (alias for compatibility)
 */
export function extractPhone(jid) {
  return extractPhoneNumber(jid)
}

/**
 * Parse JID into components
 */
export function parseJid(jid) {
  if (!jid) return null

  try {
    const normalized = normalizeJid(jid)
    const decoded = jidDecode(normalized)
    return {
      user: decoded.user,
      server: decoded.server,
      full: normalized,
      original: jid,
      isGroup: decoded.server === 'g.us',
      isUser: decoded.server === 's.whatsapp.net',
      isLid: jid.endsWith('@lid'),
      hasDeviceSuffix: jid.includes(':')
    }
  } catch (error) {
    return null
  }
}

/**
 * Get display ID (without server part)
 */
export function getDisplayId(jid) {
  if (!jid) return 'Unknown'

  const phone = extractPhoneNumber(jid)
  return phone || jid.split('@')[0].split(':')[0] || 'Unknown'
}

/**
 * Format JID for display (clean version)
 */
export function formatJidForDisplay(jid) {
  if (!jid) return 'Unknown'
  
  const normalized = normalizeJid(jid)
  const phone = normalized.split('@')[0]
  
  // For group JIDs, return as-is
  if (normalized.endsWith('@g.us')) {
    return normalized
  }
  
  // For user JIDs, return just the phone number
  return phone
}

/**
 * ============================================================================
 * JID COMPARISON AND VALIDATION
 * ============================================================================
 */

/**
 * Compare two JIDs (check if they're the same user)
 * Ignores device suffixes
 */
export function isSameJid(jid1, jid2) {
  if (!jid1 || !jid2) return false

  const normalized1 = normalizeJid(jid1)
  const normalized2 = normalizeJid(jid2)

  return normalized1 === normalized2
}

/**
 * Check if two JIDs are equal (alias)
 */
export function areJidsEqual(jid1, jid2) {
  return isSameJid(jid1, jid2)
}

/**
 * ============================================================================
 * JID CREATION AND TRANSFORMATION
 * ============================================================================
 */

/**
 * Create JID from phone number
 */
export function createJidFromPhone(phoneNumber) {
  if (!phoneNumber) return null

  // Remove all non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, '')

  if (cleaned.length < 10 || cleaned.length > 15) {
    return null
  }

  return `${cleaned}@s.whatsapp.net`
}

/**
 * Convert to standard JID format
 */
export function toStandardJid(jid) {
  if (!jid) return null
  
  const normalized = normalizeJid(jid)
  
  // Already in standard format
  if (normalized.includes('@')) {
    return normalized
  }
  
  // Just a phone number, add @s.whatsapp.net
  if (/^\d+$/.test(normalized)) {
    return `${normalized}@s.whatsapp.net`
  }
  
  return normalized
}

/**
 * ============================================================================
 * BATCH OPERATIONS
 * ============================================================================
 */

/**
 * Batch normalize JIDs
 */
export function normalizeJids(jids) {
  if (!Array.isArray(jids)) return []
  return jids.map(jid => normalizeJid(jid)).filter(Boolean)
}

/**
 * ============================================================================
 * BAILEYS 7.X MESSAGE KEY HELPERS
 * ============================================================================
 */

/**
 * Get participant JID from message key
 * Handles both participantAlt (Baileys 7.x) and participant
 * Returns normalized JID without device suffix
 */
export function getParticipantFromKey(messageKey) {
  if (!messageKey) return null
  
  // Baileys 7.x: participantAlt is the phone number (PN)
  if (messageKey.participantAlt) {
    return normalizeJid(messageKey.participantAlt)
  }
  
  // Fallback to participant (might be LID)
  if (messageKey.participant) {
    return normalizeJid(messageKey.participant)
  }
  
  return null
}

/**
 * Get sender JID from message key
 * Handles both remoteJidAlt (Baileys 7.x) and remoteJid
 * Returns normalized JID without device suffix
 */
export function getSenderFromKey(messageKey) {
  if (!messageKey) return null
  
  // For DMs, use remoteJidAlt if available (Baileys 7.x)
  if (messageKey.remoteJidAlt && !messageKey.remoteJid?.endsWith('@g.us')) {
    return normalizeJid(messageKey.remoteJidAlt)
  }
  
  // For groups, use participant
  if (messageKey.remoteJid?.endsWith('@g.us')) {
    return getParticipantFromKey(messageKey)
  }
  
  // Fallback to remoteJid
  return normalizeJid(messageKey.remoteJid)
}

/**
 * Normalize message object - fixes all JIDs in message
 * Removes all device suffixes (:0, :1, :16, etc.)
 */
export function normalizeMessage(message) {
  if (!message || !message.key) return message
  
  const normalized = { ...message }
  
  // Normalize key JIDs
  if (normalized.key.remoteJid) {
    normalized.key.remoteJid = normalizeJid(normalized.key.remoteJid)
  }
  
  if (normalized.key.participant) {
    normalized.key.participant = normalizeJid(normalized.key.participant)
  }
  
  if (normalized.key.remoteJidAlt) {
    normalized.key.remoteJidAlt = normalizeJid(normalized.key.remoteJidAlt)
  }
  
  if (normalized.key.participantAlt) {
    normalized.key.participantAlt = normalizeJid(normalized.key.participantAlt)
  }
  
  // Normalize top-level fields
  if (normalized.participant) {
    normalized.participant = normalizeJid(normalized.participant)
  }
  
  if (normalized.sender) {
    normalized.sender = normalizeJid(normalized.sender)
  }
  
  if (normalized.chat) {
    normalized.chat = normalizeJid(normalized.chat)
  }
  
  // Normalize quoted message participant
  if (normalized.message?.contextInfo?.participant) {
    normalized.message.contextInfo.participant = normalizeJid(
      normalized.message.contextInfo.participant
    )
  }
  
  if (normalized.message?.extendedTextMessage?.contextInfo?.participant) {
    normalized.message.extendedTextMessage.contextInfo.participant = normalizeJid(
      normalized.message.extendedTextMessage.contextInfo.participant
    )
  }
  
  return normalized
}

/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 */

/**
 * Create rate limit key from JID
 */
export function createRateLimitKey(jid) {
  const normalized = normalizeJid(jid)
  return normalized ? normalized.replace(/[^\w]/g, '_') : null
}

/**
 * Check if message should skip duplicate check
 */
export function shouldSkipDuplicateCheck(jid) {
  // Skip for status/broadcast
  if (jid === 'status@broadcast') return true
  if (jid?.endsWith('@broadcast')) return true
  return false
}