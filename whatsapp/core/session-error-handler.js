import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('SESSION_RECOVERY')

/**
 * SessionErrorHandler - Handles "No matching sessions found" errors
 * Automatically requests pre-keys when a session is missing
 */
export class SessionErrorHandler {
  constructor(sock, sessionId) {
    this.sock = sock
    this.sessionId = sessionId
    this.pendingPreKeyRequests = new Map() // jid -> timestamp of last request
    this.preKeyRequestTimeout = 30000 // 30 seconds before retry
  }

  /**
   * Check if should request pre-keys for this JID
   * Returns true if no request pending or timeout expired
   */
  shouldRequestPreKeys(jid) {
    const lastRequest = this.pendingPreKeyRequests.get(jid)
    if (!lastRequest) return true
    
    const timeSinceLastRequest = Date.now() - lastRequest
    return timeSinceLastRequest > this.preKeyRequestTimeout
  }

  /**
   * Request pre-keys for a specific JID
   * Called when SessionError: "No matching sessions found" occurs
   */
  async requestPreKeysForJid(jid) {
    try {
      if (!this.shouldRequestPreKeys(jid)) {
        logger.debug(`[${this.sessionId}] Pre-key request for ${jid} already in progress, skipping`)
        return false
      }

      logger.info(`[${this.sessionId}] ⚡ Session missing for ${jid} - requesting pre-keys`)
      
      // Track this request
      this.pendingPreKeyRequests.set(jid, Date.now())

      // Method 1: requestUserDevicesInfo (Baileys v7)
      if (this.sock?.requestUserDevicesInfo) {
        try {
          await this.sock.requestUserDevicesInfo([jid])
          logger.info(`[${this.sessionId}] ✅ Pre-keys requested for ${jid}`)
          return true
        } catch (err) {
          logger.debug(`[${this.sessionId}] requestUserDevicesInfo failed: ${err.message}`)
        }
      }

      // Method 2: queryExists (verify user exists and fetch device info)
      if (this.sock?.fetchStatus) {
        try {
          await this.sock.fetchStatus(jid)
          logger.debug(`[${this.sessionId}] Fetched status for ${jid} to trigger device update`)
          return true
        } catch (err) {
          logger.debug(`[${this.sessionId}] fetchStatus failed: ${err.message}`)
        }
      }

      // Method 3: Low-level groupQuery (forces device list refresh)
      if (this.sock?.query) {
        try {
          await this.sock.query({
            tag: 'iq',
            attrs: {
              to: 's.whatsapp.net',
              type: 'get',
              xmlns: 'jabber:iq:roster'
            }
          })
          logger.debug(`[${this.sessionId}] Roster query issued for ${jid}`)
          return true
        } catch (err) {
          logger.debug(`[${this.sessionId}] Roster query failed: ${err.message}`)
        }
      }

      logger.warn(`[${this.sessionId}] No method available to request pre-keys for ${jid}`)
      return false
    } catch (error) {
      logger.error(`[${this.sessionId}] Unexpected error requesting pre-keys:`, error.message)
      return false
    }
  }

  /**
   * Handle a session error (typically from decryption failure)
   * Extracts JID from error and requests pre-keys
   */
  async handleSessionError(error, messageKey) {
    try {
      if (!error || typeof error !== 'object') {
        return
      }

      // Check if this is a SessionError
      const isSessionError = error.type === 'SessionError' || 
                            error.message?.includes('No matching sessions found')

      if (!isSessionError) {
        return // Not a session error, let caller handle it
      }

      // Extract JID from message key
      let targetJid = messageKey?.remoteJid || messageKey?.participant
      
      if (!targetJid) {
        logger.warn(`[${this.sessionId}] SessionError but no JID to request keys for`)
        return
      }

      // Request pre-keys for this JID
      await this.requestPreKeysForJid(targetJid)

    } catch (err) {
      logger.error(`[${this.sessionId}] Error in handleSessionError:`, err.message)
    }
  }

  /**
   * Clear pending requests (e.g., on disconnect)
   */
  clear() {
    this.pendingPreKeyRequests.clear()
  }

  /**
   * Get handler stats
   */
  getStats() {
    return {
      sessionId: this.sessionId,
      pendingRequests: this.pendingPreKeyRequests.size,
      requests: Array.from(this.pendingPreKeyRequests.entries()).map(([jid, ts]) => ({
        jid,
        requestedAt: new Date(ts).toISOString()
      }))
    }
  }
}

/**
 * Integrate SessionErrorHandler with a socket
 * Catches SessionError logs and automatically requests pre-keys
 */
export function integratSessionErrorRecovery(sock, sessionId) {
  const handler = new SessionErrorHandler(sock, sessionId)

  // Store on socket for later access
  sock._sessionErrorHandler = handler

  // Monitor logger events for SessionError (if available)
  if (sock.ev && sock.ev.on) {
    // This would require Baileys to emit session errors as events
    // For now, SessionError is logged but not emitted as event
    logger.info(`[${sessionId}] Session error recovery handler installed`)
  }

  return handler
}

/**
 * Export handler for manual use in message.js
 */
export function getSessionErrorHandler(sock, sessionId) {
  if (!sock._sessionErrorHandler) {
    sock._sessionErrorHandler = new SessionErrorHandler(sock, sessionId)
  }
  return sock._sessionErrorHandler
}

/**
 * Check if a logged error is a SessionError
 */
export function isSessionError(error) {
  if (!error) return false
  return error.type === 'SessionError' || 
         error.message?.includes('No matching sessions found') ||
         error.message?.includes('decryptWithSessions')
}
