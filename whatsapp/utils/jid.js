//UTILS/JID.JS
import { jidDecode } from '@whiskeysockets/baileys'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('JID_UTILS')

/**
 * Normalize JID to standard format
 * Handles various WhatsApp ID formats including LID
 */
export function normalizeJid(jid) {
  if (!jid) return null

  try {
    // Don't normalize LIDs - they need special handling
    if (jid.endsWith('@lid')) {
      return jid
    }

    // Try to decode using Baileys
    const decoded = jidDecode(jid)
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

  // Fallback normalization
  return formatJid(jid)
}

/**
 * Format JID to standard format
 * Simpler version without decoding
 */
export function formatJid(jid) {
  if (!jid) return null

  // Remove extra characters
  const cleaned = jid.replace(/[^\d@.]/g, '')

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
 * Extract phone number from JID
 */
export function extractPhoneNumber(jid) {
  if (!jid) return null

  try {
    const decoded = jidDecode(jid)
    return decoded?.user || null
  } catch (error) {
    // Fallback: extract manually
    const match = jid.match(/^(\d+)/)
    return match ? match[1] : null
  }
}

/**
 * Compare two JIDs (check if they're the same user)
 */
export function isSameJid(jid1, jid2) {
  if (!jid1 || !jid2) return false

  const normalized1 = normalizeJid(jid1)
  const normalized2 = normalizeJid(jid2)

  return normalized1 === normalized2
}

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
 * Parse JID into components
 */
export function parseJid(jid) {
  if (!jid) return null

  try {
    const decoded = jidDecode(jid)
    return {
      user: decoded.user,
      server: decoded.server,
      full: jid,
      isGroup: decoded.server === 'g.us',
      isUser: decoded.server === 's.whatsapp.net',
      isLid: jid.endsWith('@lid')
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
  return phone || jid.split('@')[0] || 'Unknown'
}

/**
 * Batch normalize JIDs
 */
export function normalizeJids(jids) {
  if (!Array.isArray(jids)) return []
  return jids.map(jid => normalizeJid(jid)).filter(Boolean)
}

/**
 * Create rate limit key from JID
 */
export function createRateLimitKey(jid) {
  return jid.replace(/[^\w]/g, '_')
}