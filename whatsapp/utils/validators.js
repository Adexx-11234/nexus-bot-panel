import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('VALIDATORS')

/**
 * Validate phone number
 */
export function validatePhoneNumber(phoneNumber) {
  if (!phoneNumber) return false

  // Remove all non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, '')

  // Check length (10-15 digits)
  if (cleaned.length < 10 || cleaned.length > 15) {
    return false
  }

  return true
}

/**
 * Validate JID format
 */
export function validateJid(jid) {
  if (!jid || typeof jid !== 'string') return false

  // Check if it has @ symbol
  if (!jid.includes('@')) return false

  // Valid server parts
  const validServers = ['s.whatsapp.net', 'g.us', 'broadcast', 'lid']
  const server = jid.split('@')[1]

  return validServers.some(valid => server === valid || server.startsWith(valid))
}

/**
 * Validate group JID
 */
export function validateGroupJid(jid) {
  if (!validateJid(jid)) return false
  return jid.endsWith('@g.us')
}

/**
 * Validate user JID
 */
export function validateUserJid(jid) {
  if (!validateJid(jid)) return false
  return jid.endsWith('@s.whatsapp.net')
}

/**
 * Validate session ID
 */
export function validateSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return false
  
  // Should be in format: session_XXXXX or just XXXXX
  return /^(session_)?\d+$/.test(sessionId)
}

/**
 * Validate message key
 */
export function validateMessageKey(key) {
  if (!key || typeof key !== 'object') return false

  return !!(key.remoteJid && key.id)
}

/**
 * Validate URL
 */
export function validateUrl(url) {
  if (!url || typeof url !== 'string') return false

  try {
    new URL(url)
    return true
  } catch (error) {
    return false
  }
}

/**
 * Validate email
 */
export function validateEmail(email) {
  if (!email || typeof email !== 'string') return false

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Validate telegram ID
 */
export function validateTelegramId(telegramId) {
  if (!telegramId) return false

  const id = typeof telegramId === 'string' ? parseInt(telegramId) : telegramId
  return !isNaN(id) && id > 0
}

/**
 * Validate file size (in bytes)
 */
export function validateFileSize(size, maxSize = 100 * 1024 * 1024) { // 100MB default
  if (typeof size !== 'number') return false
  return size > 0 && size <= maxSize
}

/**
 * Validate mime type
 */
export function validateMimeType(mimeType, allowedTypes = []) {
  if (!mimeType || typeof mimeType !== 'string') return false

  if (allowedTypes.length === 0) return true

  return allowedTypes.some(allowed => mimeType.startsWith(allowed))
}

/**
 * Sanitize string (remove dangerous characters)
 */
export function sanitizeString(str, maxLength = 1000) {
  if (!str || typeof str !== 'string') return ''

  // Remove null bytes and other control characters
  let sanitized = str.replace(/[\x00-\x1F\x7F]/g, '')

  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength)
  }

  return sanitized
}

/**
 * Validate and sanitize command
 */
export function validateCommand(command, prefix = '.') {
  if (!command || typeof command !== 'string') return null

  // Must start with prefix
  if (!command.startsWith(prefix)) return null

  // Extract command name
  const cmd = command.slice(prefix.length).trim().split(/\s+/)[0]

  // Command name validation (alphanumeric, dash, underscore)
  if (!/^[a-zA-Z0-9_-]+$/.test(cmd)) return null

  return cmd.toLowerCase()
}