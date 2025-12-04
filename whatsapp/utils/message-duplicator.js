import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('MESSAGE_DEDUP')

/**
 * MessageDeduplicator - Prevents duplicate message processing across ALL sessions
 * Uses a time-based cache to track recently processed messages globally
 */
export class MessageDeduplicator {
  constructor(options = {}) {
    this.cache = new Map() // messageId -> timestamp
    this.ttl = options.ttl || 60000 // 60 seconds default
    this.maxSize = options.maxSize || 1000
    
    // Auto-cleanup every 30 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000)
  }

  /**
   * Generate unique key for message (GLOBAL - no sessionId)
   */
  generateKey(remoteJid, messageId) {
    if (!remoteJid || !messageId) return null
    
    // GLOBAL key - same across all sessions
    return `${remoteJid}:${messageId}`
  }

  /**
   * Check if message was already processed by ANY session
   * @returns {boolean} true if duplicate, false if new
   */
  isDuplicate(remoteJid, messageId) {
    const key = this.generateKey(remoteJid, messageId)
    if (!key) return false

    const timestamp = this.cache.get(key)
    
    if (!timestamp) {
      return false // Not seen before
    }

    // Check if still within TTL
    const age = Date.now() - timestamp
    if (age > this.ttl) {
      this.cache.delete(key)
      return false // Expired, treat as new
    }

    return true // Duplicate within TTL
  }

  /**
   * Mark message as processed GLOBALLY
   */
  markAsProcessed(remoteJid, messageId) {
    const key = this.generateKey(remoteJid, messageId)
    if (!key) return false

    // Prevent cache from growing too large
    if (this.cache.size >= this.maxSize) {
      this.cleanup()
    }

    this.cache.set(key, Date.now())
    return true
  }

  /**
   * Try to lock message for processing
   * Returns true if locked successfully, false if already locked
   * This is ATOMIC - first session to call this wins
   */
  tryLock(remoteJid, messageId) {
    if (this.isDuplicate(remoteJid, messageId)) {
      return false // Already processing or processed
    }

    this.markAsProcessed(remoteJid, messageId)
    return true // Locked successfully
  }

  /**
   * Cleanup expired entries
   */
  cleanup() {
    const now = Date.now()
    let cleaned = 0

    for (const [key, timestamp] of this.cache.entries()) {
      if (now - timestamp > this.ttl) {
        this.cache.delete(key)
        cleaned++
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} expired message entries`)
    }
  }

  /**
   * Clear all entries
   */
  clear() {
    this.cache.clear()
    logger.debug('Message deduplication cache cleared')
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl
    }
  }

  /**
   * Cleanup on shutdown
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.cache.clear()
    logger.info('Message deduplicator destroyed')
  }
}

// GLOBAL singleton instance - shared across ALL sessions
let deduplicatorInstance = null

/**
 * Get global deduplicator instance
 */
export function getMessageDeduplicator() {
  if (!deduplicatorInstance) {
    deduplicatorInstance = new MessageDeduplicator({
      ttl: 60000, // 60 seconds
      maxSize: 1000
    })
    logger.info('Global message deduplicator initialized')
  }
  return deduplicatorInstance
}

/**
 * Reset deduplicator (for testing)
 */
export function resetMessageDeduplicator() {
  if (deduplicatorInstance) {
    deduplicatorInstance.destroy()
    deduplicatorInstance = null
  }
}