import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js'

/**
 * Validation utilities
 */

/**
 * Validate phone number
 */
export function validatePhone(phoneNumber) {
  try {
    const cleanNumber = phoneNumber.trim()

    if (!cleanNumber.startsWith('+')) {
      return {
        isValid: false,
        error: 'Phone number must start with + and country code'
      }
    }

    if (!isValidPhoneNumber(cleanNumber)) {
      return {
        isValid: false,
        error: 'Invalid phone number format'
      }
    }

    const parsed = parsePhoneNumber(cleanNumber)

    return {
      isValid: true,
      formatted: parsed.format('E.164'),
      country: parsed.country,
      nationalNumber: parsed.nationalNumber
    }

  } catch (error) {
    return {
      isValid: false,
      error: 'Invalid phone number format'
    }
  }
}

/**
 * Sanitize input string
 */
export function sanitizeInput(input) {
  if (typeof input !== 'string') return ''

  return input
    .trim()
    .replace(/[<>]/g, '')
    .substring(0, 1000)
}

/**
 * Parse command and arguments
 */
export function parseCommand(text) {
  const parts = text.trim().split(/\s+/)
  const command = parts[0].toLowerCase()
  const args = parts.slice(1)

  return {
    command,
    args,
    rawText: text
  }
}

/**
 * Validate telegram ID
 */
export function validateTelegramId(id) {
  return typeof id === 'number' && id > 0
}

/**
 * Validate callback data
 */
export function validateCallbackData(data) {
  return typeof data === 'string' && data.length > 0 && data.length <= 64
}