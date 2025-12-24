import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('MESSAGE_DEDUP')

/**
 * MessageDeduplicator - Prevents duplicate message processing per session
 * Tracks which session processed which message
 */
export class MessageDeduplicator {
  constructor(options = {}) {
    this.cache = new Map() // messageId -> Set of sessionIds that processed it
    this.ttl = options.ttl || 60000 // 60 seconds default
    this.maxSize = options.maxSize || 1000
    
    // Auto-cleanup every 30 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000)
  }

  /**
   * Generate unique key for message (no sessionId)
   */
  generateKey(remoteJid, messageId) {
    if (!remoteJid || !messageId) return null
    return `${remoteJid}:${messageId}`
  }

  /**
   * Check if message was already processed by THIS specific session
   * @returns {boolean} true if THIS session already processed it
   */
  isDuplicate(remoteJid, messageId, sessionId) {
    const key = this.generateKey(remoteJid, messageId)
    if (!key || !sessionId) return false

    const entry = this.cache.get(key)
    
    if (!entry) {
      return false // Not seen before
    }

    // Check if still within TTL
    const age = Date.now() - entry.timestamp
    if (age > this.ttl) {
      this.cache.delete(key)
      return false // Expired, treat as new
    }

    // Check if THIS session already processed it
    return entry.sessions.has(sessionId)
  }

  /**
   * Mark message as processed by THIS session
   */
  markAsProcessed(remoteJid, messageId, sessionId) {
    const key = this.generateKey(remoteJid, messageId)
    if (!key || !sessionId) return false

    // Prevent cache from growing too large
    if (this.cache.size >= this.maxSize) {
      this.cleanup()
    }

    const existing = this.cache.get(key)
    
    if (existing) {
      // Add this session to the set
      existing.sessions.add(sessionId)
    } else {
      // Create new entry
      this.cache.set(key, {
        timestamp: Date.now(),
        sessions: new Set([sessionId])
      })
    }

    return true
  }

  /**
   * Try to lock message for processing by THIS session
   * Returns true if THIS session hasn't processed it yet
   * Multiple sessions CAN process the same message
   */
  tryLock(remoteJid, messageId, sessionId) {
    if (this.isDuplicate(remoteJid, messageId, sessionId)) {
      return false // THIS session already processed it
    }

    this.markAsProcessed(remoteJid, messageId, sessionId)
    return true // Locked for this session
  }

  /**
   * Cleanup expired entries
   */
  cleanup() {
    const now = Date.now()
    let cleaned = 0

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
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