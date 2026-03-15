/**
 * Validate phone number - only ensure + and country code, let WhatsApp handle the rest
 */
export function validatePhone(phoneNumber) {
  try {
    const cleanNumber = phoneNumber.trim().replace(/[\s\-().]/g, '') // strip spaces, dashes, brackets

    if (!cleanNumber.startsWith('+')) {
      return {
        isValid: false,
        error: 'Phone number must start with + and country code'
      }
    }

    // Must have + followed by at least 7 digits (shortest possible intl number)
    if (!/^\+\d{7,15}$/.test(cleanNumber)) {
      return {
        isValid: false,
        error: 'Invalid phone number format'
      }
    }

    return {
      isValid: true,
      formatted: cleanNumber
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