import { createComponentLogger } from '../../utils/logger.js'
import { Boom } from '@hapi/boom'

const logger = createComponentLogger('DECRYPTION_HANDLER')

/**
 * DecryptionHandler - Handles message decryption failures and session recovery
 * Fixes Bad MAC errors, session desync, and corrupted message keys
 */
export class DecryptionHandler {
  constructor() {
    this.failedDecryptions = new Map() // Track failed messages
    this.sessionResets = new Map() // Track reset attempts per contact
    this.MAX_RESET_ATTEMPTS = 3
    this.RESET_COOLDOWN = 300000 // 5 minutes cooldown between resets
    this.CLEANUP_INTERVAL = 600000 // Cleanup every 10 minutes
    
    // Start periodic cleanup
    this.startPeriodicCleanup()
  }

  /**
   * Handle message decryption error
   * Main entry point for fixing decryption issues
   */
  async handleDecryptionError(sock, sessionId, error, message) {
    const messageId = message?.key?.id
    const remoteJid = message?.key?.remoteJid
    const participant = message?.key?.participant
    const isGroup = remoteJid?.endsWith('@g.us')
    
    // Determine the actual contact JID (for groups, it's the participant)
    const contactJid = isGroup ? participant : remoteJid

    if (!messageId || !contactJid) {
      logger.debug('Cannot handle decryption - missing message ID or contact JID')
      return { recovered: false, shouldSkip: true }
    }

    // Check error type
    const errorType = this._identifyErrorType(error)
    
    logger.warn(
      `Decryption error (${errorType}) for message ${messageId} from ${contactJid} in ${sessionId}`
    )

    // Track this failure
    this._trackFailedDecryption(messageId, contactJid)

    // Handle based on error type
    switch (errorType) {
      case 'BAD_MAC':
        return await this._handleBadMacError(sock, sessionId, contactJid, messageId)
      
      case 'NO_SESSION':
        return await this._handleNoSessionError(sock, sessionId, contactJid, messageId)
      
      case 'MESSAGE_COUNTER':
        return await this._handleMessageCounterError(sock, sessionId, contactJid, messageId)
      
      case 'DUPLICATE':
        // Message already processed
        return { recovered: false, shouldSkip: true, reason: 'duplicate' }
      
      default:
        return await this._handleGenericError(sock, sessionId, contactJid, messageId)
    }
  }

  /**
   * Identify error type from error object
   * @private
   */
  _identifyErrorType(error) {
    const errorMsg = error?.message || ''

    if (errorMsg.includes('Bad MAC')) {
      return 'BAD_MAC'
    }
    if (errorMsg.includes('No matching sessions') || errorMsg.includes('No session')) {
      return 'NO_SESSION'
    }
    if (errorMsg.includes('Key used already') || errorMsg.includes('never filled')) {
      return 'MESSAGE_COUNTER'
    }
    if (errorMsg.includes('duplicate')) {
      return 'DUPLICATE'
    }

    return 'UNKNOWN'
  }

  /**
   * Handle Bad MAC error - Most common decryption failure
   * @private
   */
  async _handleBadMacError(sock, sessionId, contactJid, messageId) {
    try {
      // Check if we've recently reset this contact's session
      if (this._isInResetCooldown(contactJid)) {
        logger.debug(`Contact ${contactJid} is in reset cooldown - skipping message`)
        return { recovered: false, shouldSkip: true, reason: 'cooldown' }
      }

      // Check reset attempts
      const attempts = this.sessionResets.get(contactJid) || { count: 0, lastReset: 0 }
      
      if (attempts.count >= this.MAX_RESET_ATTEMPTS) {
        logger.error(`Max reset attempts reached for ${contactJid} - giving up`)
        this.sessionResets.delete(contactJid)
        return { recovered: false, shouldSkip: true, reason: 'max_attempts' }
      }

      logger.info(`Attempting session reset for ${contactJid} (attempt ${attempts.count + 1})`)

      // Reset the session for this contact
      const success = await this._resetContactSession(sock, sessionId, contactJid)

      if (success) {
        // Update reset tracking
        this.sessionResets.set(contactJid, {
          count: attempts.count + 1,
          lastReset: Date.now()
        })

        logger.info(`Session reset successful for ${contactJid}`)
        return { recovered: true, shouldSkip: false, reason: 'session_reset' }
      }

      return { recovered: false, shouldSkip: true, reason: 'reset_failed' }

    } catch (error) {
      logger.error(`Bad MAC handler failed:`, error)
      return { recovered: false, shouldSkip: true, reason: 'error' }
    }
  }

  /**
   * Handle no session error
   * @private
   */
  async _handleNoSessionError(sock, sessionId, contactJid, messageId) {
    try {
      logger.info(`No session found for ${contactJid} - requesting prekeys`)

      // Request prekey bundle to establish session
      await this._requestPreKeys(sock, contactJid)

      return { recovered: true, shouldSkip: false, reason: 'prekey_requested' }

    } catch (error) {
      logger.error(`No session handler failed:`, error)
      return { recovered: false, shouldSkip: true, reason: 'error' }
    }
  }

  /**
   * Handle message counter error (duplicate/out of order)
   * @private
   */
  async _handleMessageCounterError(sock, sessionId, contactJid, messageId) {
    logger.info(`Message counter error for ${contactJid} - likely duplicate or out of order`)
    
    // These messages are usually duplicates or already processed
    // Skip them to prevent issues
    return { recovered: false, shouldSkip: true, reason: 'duplicate_message' }
  }

  /**
   * Handle generic/unknown decryption errors
   * @private
   */
  async _handleGenericError(sock, sessionId, contactJid, messageId) {
    logger.warn(`Unknown decryption error for ${contactJid} - skipping message`)
    return { recovered: false, shouldSkip: true, reason: 'unknown_error' }
  }

  /**
   * Reset session for a specific contact
   * Clears corrupted session data and forces renegotiation
   * @private
   */
  async _resetContactSession(sock, sessionId, contactJid) {
    try {
      const phoneNumber = contactJid.split('@')[0].split(':')[0]
      
      logger.info(`Resetting session storage for ${phoneNumber} in ${sessionId}`)

      // Get connection manager and storage
      const { getSessionManager } = await import('../sessions/index.js')
      const sessionManager = getSessionManager()
      const connectionManager = sessionManager.getConnectionManager()
      const storage = sessionManager.getStorage()

      if (!connectionManager) {
        logger.error('Connection manager not available')
        return false
      }

      // Clear from MongoDB auth storage - KEEP ONLY creds.json
      if (connectionManager.mongoClient) {
        try {
          const db = connectionManager.mongoClient.db()
          const collection = db.collection('auth_baileys')
          
          // Delete EVERYTHING except creds.json
          // This includes all sessions, sender-keys, app-state-sync-keys, etc.
          const result = await collection.deleteMany({
            sessionId: sessionId,
            key: { $ne: 'creds.json' }
          })
          
          logger.info(`Cleared ${result.deletedCount} MongoDB records for ${sessionId} (kept creds.json only)`)
        } catch (mongoError) {
          logger.warn(`MongoDB session clear failed:`, mongoError)
        }
      }

      // Clear from file storage - KEEP ONLY creds.json
      if (connectionManager.fileManager) {
        try {
          const sessionPath = connectionManager.fileManager.getSessionPath(sessionId)
          const fs = await import('fs').then(m => m.promises)
          
          const files = await fs.readdir(sessionPath).catch(() => [])
          
          let deletedCount = 0
          for (const file of files) {
            // Delete EVERYTHING except creds.json
            if (file !== 'creds.json') {
              await fs.unlink(`${sessionPath}/${file}`).catch(() => {})
              deletedCount++
            }
          }
          
          if (deletedCount > 0) {
            logger.info(`Deleted ${deletedCount} session files for ${sessionId} (kept creds.json only)`)
          }
        } catch (fileError) {
          logger.warn(`File session clear failed:`, fileError)
        }
      }

      // Request new prekeys to establish fresh session
      await this._requestPreKeys(sock, contactJid)

      logger.info(`Session reset complete for ${sessionId} - all sessions cleared, will rebuild from creds`)
      return true

    } catch (error) {
      logger.error(`Session reset failed for ${contactJid}:`, error)
      return false
    }
  }

  /**
   * Request prekey bundle for contact
   * @private
   */
  async _requestPreKeys(sock, contactJid) {
    try {
      // Extract JID components
      const [number] = contactJid.split('@')
      const formattedJid = contactJid.includes('@') ? contactJid : `${number}@s.whatsapp.net`

      // Send empty message to trigger prekey exchange
      await sock.sendMessage(formattedJid, {
        text: ''
      }).catch(() => {
        // Ignore send error - we just want to trigger key exchange
      })

      logger.debug(`Prekey request sent for ${formattedJid}`)
      return true

    } catch (error) {
      logger.error(`Prekey request failed for ${contactJid}:`, error)
      return false
    }
  }

  /**
   * Check if contact is in reset cooldown
   * @private
   */
  _isInResetCooldown(contactJid) {
    const resetInfo = this.sessionResets.get(contactJid)
    if (!resetInfo) return false

    const timeSinceReset = Date.now() - resetInfo.lastReset
    return timeSinceReset < this.RESET_COOLDOWN
  }

  /**
   * Track failed decryption for monitoring
   * @private
   */
  _trackFailedDecryption(messageId, contactJid) {
    const key = `${contactJid}:${messageId}`
    this.failedDecryptions.set(key, {
      timestamp: Date.now(),
      contactJid,
      messageId
    })
  }

  /**
   * Start periodic cleanup of tracking maps
   */
  startPeriodicCleanup() {
    this.cleanupInterval = setInterval(() => {
      this._cleanupOldEntries()
    }, this.CLEANUP_INTERVAL)
  }

  /**
   * Cleanup old entries from tracking maps
   * @private
   */
  _cleanupOldEntries() {
    const now = Date.now()
    const maxAge = 3600000 // 1 hour

    // Cleanup failed decryptions
    for (const [key, value] of this.failedDecryptions.entries()) {
      if (now - value.timestamp > maxAge) {
        this.failedDecryptions.delete(key)
      }
    }

    // Cleanup old session resets
    for (const [key, value] of this.sessionResets.entries()) {
      if (now - value.lastReset > maxAge) {
        this.sessionResets.delete(key)
      }
    }

    logger.debug('Cleanup completed - removed old tracking entries')
  }

  /**
   * Get statistics about decryption failures
   */
  getStats() {
    return {
      failedDecryptions: this.failedDecryptions.size,
      sessionResets: this.sessionResets.size,
      maxResetAttempts: this.MAX_RESET_ATTEMPTS,
      resetCooldown: this.RESET_COOLDOWN
    }
  }

  /**
   * Stop cleanup interval
   */
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  /**
   * Reset all tracking data
   */
  reset() {
    this.failedDecryptions.clear()
    this.sessionResets.clear()
  }
}

// Singleton instance
let decryptionHandlerInstance = null

/**
 * Get decryption handler singleton
 */
export function getDecryptionHandler() {
  if (!decryptionHandlerInstance) {
    decryptionHandlerInstance = new DecryptionHandler()
  }
  return decryptionHandlerInstance
}

/**
 * Reset decryption handler (for testing)
 */
export function resetDecryptionHandler() {
  if (decryptionHandlerInstance) {
    decryptionHandlerInstance.stop()
    decryptionHandlerInstance = null
  }
}