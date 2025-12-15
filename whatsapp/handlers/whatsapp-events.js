import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('WHATSAPP_EVENTS')

/**
 * WhatsAppEventHandler - Wrapper for event dispatcher
 * Maintains backward compatibility with old code
 */
export class WhatsAppEventHandler {
  constructor(sessionManager) {
    this.sessionManager = sessionManager
    this.eventDispatcher = null
    
    // Minimal tracking
    this.eventCount = 0
    this.lastCleanup = Date.now()
    
    // Constants
    this.CLEANUP_INTERVAL = 50000 // 50 seconds
    this.MAX_EVENTS_BEFORE_CLEANUP = 500
  }

  /**
   * Setup all event handlers for a session
   */
  setupAllEventHandlers(sock, sessionId) {
    try {

      // Get or create event dispatcher
      if (!this.eventDispatcher) {
        this._initializeEventDispatcher()
      }

      // Setup handlers through dispatcher
      this.eventDispatcher.setupEventHandlers(sock, sessionId)

      // Setup cache invalidation
      const { setupCacheInvalidation } = require('../../config/baileys.js')
      setupCacheInvalidation(sock)

      // Track event
      this.trackEvent()

      logger.info(`Event handlers setup for ${sessionId}`)

    } catch (error) {
      logger.error(`Failed to setup event handlers for ${sessionId}:`, error)
      throw error
    }
  }

  /**
   * Initialize event dispatcher
   * @private
   */
  _initializeEventDispatcher() {
    const { EventDispatcher } = require('../events/index.js')
    this.eventDispatcher = new EventDispatcher(this.sessionManager)
  }

  /**
   * Resolve LID to actual JID
   * Wrapper for backward compatibility
   */
  async resolveLidToActualJid(sock, groupJid, lidJid, messageMetadata = null) {
    try {
      if (!lidJid?.endsWith('@lid')) {
        return lidJid
      }

      const { resolveLidToJid } = await import('../groups/index.js')
      return await resolveLidToJid(sock, groupJid, lidJid)

    } catch (error) {
      logger.error(`Error resolving LID ${lidJid}:`, error)
      return lidJid
    }
  }

  /**
   * Process message with LID resolution
   * Wrapper for backward compatibility
   */
  async processMessageWithLidResolution(message, sock) {
    try {
      if (!message?.key) {
        return message
      }

      const isGroup = message.key.remoteJid?.endsWith('@g.us')

      // Resolve participant LID
      if (message.key.participant?.endsWith('@lid') && isGroup) {
        message.participant = await this.resolveLidToActualJid(
          sock,
          message.key.remoteJid,
          message.key.participant
        )
      } else {
        message.participant = message.key.participant
      }

      // Resolve quoted participant LID
      const quotedParticipant =
        message.message?.contextInfo?.participant ||
        message.message?.extendedTextMessage?.contextInfo?.participant

      if (quotedParticipant?.endsWith('@lid') && isGroup) {
        const resolvedQuoted = await this.resolveLidToActualJid(
          sock,
          message.key.remoteJid,
          quotedParticipant
        )

        if (message.message?.contextInfo) {
          message.message.contextInfo.participant = resolvedQuoted
        }
        if (message.message?.extendedTextMessage?.contextInfo) {
          message.message.extendedTextMessage.contextInfo.participant = resolvedQuoted
        }

        message.quotedParticipant = resolvedQuoted
      }

      return message

    } catch (error) {
      logger.error('Error processing message with LID resolution:', error)
      return message
    }
  }

  /**
   * Track event for cleanup
   */
  trackEvent(eventType = null) {
    this.eventCount++

    // Automatic cleanup when limits reached
    if (this.eventCount >= this.MAX_EVENTS_BEFORE_CLEANUP) {
      this.performCleanup()
    }

    // Time-based cleanup
    const now = Date.now()
    if (now - this.lastCleanup > this.CLEANUP_INTERVAL) {
      this.performCleanup()
    }
  }

  /**
   * Perform cleanup
   */
  performCleanup() {
    // Reset counters
    this.eventCount = 0
    this.lastCleanup = Date.now()

    // Force garbage collection if available
    if (global.gc) {
      global.gc()
    }

    // Clear session cache if too large
    if (this.sessionManager?.storage?.sessionCache) {
      if (this.sessionManager.storage.sessionCache.size > 100) {
        this.sessionManager.storage.sessionCache.clear()
      }
    }

    logger.debug('Event handler cleanup performed')
  }

  /**
   * Cleanup for session
   */
  cleanup(sessionId) {
    this.performCleanup()
    logger.debug(`Cleanup performed for ${sessionId}`)
  }

  /**
   * Get event statistics
   */
  getEventStats() {
    return {
      total: this.eventCount,
      lastCleanup: new Date(this.lastCleanup).toISOString()
    }
  }

  /**
   * Force cleanup
   */
  forceCleanup() {
    this.eventCount = 0
    this.lastCleanup = Date.now()

    if (global.gc) {
      global.gc()
    }

    logger.info('Forced cleanup performed')
  }

  /**
   * Manual control methods (wrapper)
   */
  async markMessageAsRead(sock, messageKey) {
    try {
      await sock.readMessages([messageKey])
    } catch (error) {
      logger.error('Mark as read error:', error)
    }
  }

  async setPresence(sock, status = 'unavailable') {
    try {
      await sock.sendPresenceUpdate(status)
    } catch (error) {
      logger.error('Set presence error:', error)
    }
  }

/**
 * Check if socket is ready
 */
isSocketReady(sock) {
  return !!(sock?.user && sock.ws?.socket?._readyState === 1)
}

  /**
   * Wait for socket to be ready
   */
  async waitForSocketReady(sock, timeout = 3000) {
    if (this.isSocketReady(sock)) {
      return true
    }

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        sock.ev.off('connection.update', handler)
        resolve(false)
      }, timeout)

      const handler = (update) => {
        if (update.connection === 'open') {
          clearTimeout(timeoutId)
          sock.ev.off('connection.update', handler)
          resolve(true)
        }
      }

      sock.ev.on('connection.update', handler)
    })
  }
}