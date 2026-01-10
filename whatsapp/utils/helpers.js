//UTILS/HELPERS.JS
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('HELPERS')

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Retry function with exponential backoff
 */
export async function retry(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    onRetry = null
  } = options

  let lastError = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt < maxRetries - 1) {
        const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay)
        
        if (onRetry) {
          onRetry(attempt + 1, delay, error)
        }

        await sleep(delay)
      }
    }
  }

  throw lastError
}

/**
 * Execute function with timeout
 */
export async function withTimeout(fn, timeoutMs, timeoutError = 'Operation timed out') {
  return Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(timeoutError)), timeoutMs)
    )
  ])
}

/**
 * Chunk array into smaller arrays
 */
export function chunkArray(array, size) {
  const chunks = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

/**
 * Deduplicate array
 */
export function uniqueArray(array) {
  return [...new Set(array)]
}

/**
 * Deep clone object
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj
  
  try {
    return JSON.parse(JSON.stringify(obj))
  } catch (error) {
    logger.error('Deep clone failed:', error)
    return obj
  }
}

/**
 * Check if object is empty
 */
export function isEmpty(obj) {
  if (obj === null || obj === undefined) return true
  if (Array.isArray(obj)) return obj.length === 0
  if (typeof obj === 'object') return Object.keys(obj).length === 0
  if (typeof obj === 'string') return obj.trim().length === 0
  return false
}

/**
 * Safe JSON parse
 */
export function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str)
  } catch (error) {
    return defaultValue
  }
}

/**
 * Safe JSON stringify
 */
export function safeJsonStringify(obj, defaultValue = '{}') {
  try {
    return JSON.stringify(obj)
  } catch (error) {
    return defaultValue
  }
}

/**
 * Generate random string
 */
export function randomString(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Generate random ID
 */
export function randomId() {
  return `${Date.now()}_${randomString(8)}`
}

/**
 * Debounce function
 */
export function debounce(func, wait) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

/**
 * Throttle function
 */
export function throttle(func, limit) {
  let inThrottle
  return function executedFunction(...args) {
    if (!inThrottle) {
      func(...args)
      inThrottle = true
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}

/**
 * Pick specific keys from object
 */
export function pick(obj, keys) {
  const result = {}
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key]
    }
  }
  return result
}

/**
 * Omit specific keys from object
 */
export function omit(obj, keys) {
  const result = { ...obj }
  for (const key of keys) {
    delete result[key]
  }
  return result
}

/**
 * Merge objects deeply
 */
export function mergeDeep(target, ...sources) {
  if (!sources.length) return target

  const source = sources.shift()

  if (typeof target === 'object' && typeof source === 'object') {
    for (const key in source) {
      if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} })
        mergeDeep(target[key], source[key])
      } else {
        Object.assign(target, { [key]: source[key] })
      }
    }
  }

  return mergeDeep(target, ...sources)
}

/**
 * Re-export Baileys utilities
 */
export {
  downloadContentFromMessage,
  getContentType
} from '@nexustechpro/baileys'