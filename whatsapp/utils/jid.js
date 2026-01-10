//UTILS/JID.JS
import { jidDecode } from '@nexustechpro/baileys'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('JID_UTILS')

/**
 * Extract phone number from any JID format
 * Handles: "2348123456789@s.whatsapp.net", "2348123456789:21@s.whatsapp.net", LIDs
 */
export function extractPhoneNumber(jid) {
  if (!jid || typeof jid !== 'string') return null

  try {
    // Try Baileys decoder first
    const decoded = jidDecode(jid)
    if (decoded?.user) {
      // Remove device ID suffix (e.g., :21, :2)
      return decoded.user.split(':')[0]
    }
  } catch (error) {
    // Fallback to manual extraction
  }

  // Manual extraction fallback
  // Remove @s.whatsapp.net or @g.us or @lid suffix
  const withoutSuffix = jid.split('@')[0]
  
  // Remove device ID suffix (e.g., :21, :2)
  const phoneNumber = withoutSuffix.split(':')[0]
  
  return phoneNumber || null
}

/**
 * Normalize JID to standard format for comparison
 * Returns: "2348123456789@s.whatsapp.net" format
 */
export function normalizeJid(jid) {
  if (!jid) return null

  try {
    // Don't normalize LIDs - they need special handling
    if (jid.endsWith('@lid')) {
      return jid
    }

    // Extract phone number (handles all formats)
    const phone = extractPhoneNumber(jid)
    if (!phone) return null

    // Return normalized format based on original type
    if (jid.includes('@g.us')) {
      return `${phone}@g.us`
    }
    
    return `${phone}@s.whatsapp.net`
  } catch (error) {
    logger.debug(`JID normalization failed for ${jid}:`, error)
    return jid // Return original on error
  }
}

/**
 * Compare two JIDs (handles all formats including device IDs)
 * Returns true if both JIDs refer to the same user/group
 */
export function isSameJid(jid1, jid2) {
  if (!jid1 || !jid2) return false

  try {
    const phone1 = extractPhoneNumber(jid1)
    const phone2 = extractPhoneNumber(jid2)
    
    if (!phone1 || !phone2) return false
    
    return phone1 === phone2
  } catch (error) {
    logger.debug(`JID comparison failed:`, error)
    return false
  }
}

/**
 * Format JID to standard format (simpler version)
 */
export function formatJid(jid) {
  if (!jid) return null

  // Already a LID
  if (jid.endsWith('@lid')) return jid

  // Extract phone
  const phone = extractPhoneNumber(jid)
  if (!phone) return jid

  // Format based on type
  if (jid.includes('@g.us')) {
    return `${phone}@g.us`
  }
  
  return `${phone}@s.whatsapp.net`
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
    const phone = extractPhoneNumber(jid)
    
    return {
      user: phone,
      server: decoded?.server || (jid.includes('@g.us') ? 'g.us' : 's.whatsapp.net'),
      full: jid,
      normalized: normalizeJid(jid),
      isGroup: decoded?.server === 'g.us' || jid.includes('@g.us'),
      isUser: decoded?.server === 's.whatsapp.net' || jid.includes('@s.whatsapp.net'),
      isLid: jid.endsWith('@lid')
    }
  } catch (error) {
    logger.debug(`JID parsing failed for ${jid}:`, error)
    return null
  }
}

/**
 * Get display ID (for logging/UI - shows last 4 digits)
 */
export function getDisplayId(jid) {
  if (!jid) return 'Unknown'

  const phone = extractPhoneNumber(jid)
  if (!phone) return jid.split('@')[0] || 'Unknown'
  
  // Show last 4 digits for privacy
  return phone.length > 4 ? `User ${phone.slice(-4)}` : phone
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
  const phone = extractPhoneNumber(jid)
  return phone ? phone.replace(/\D/g, '_') : jid.replace(/[^\w]/g, '_')
}

// Default export for convenience
export default {
  extractPhoneNumber,
  normalizeJid,
  isSameJid,
  formatJid,
  isGroupJid,
  isUserJid,
  isLid,
  createJidFromPhone,
  parseJid,
  getDisplayId,
  normalizeJids,
  createRateLimitKey
}