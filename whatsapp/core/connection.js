import { createComponentLogger } from '../../utils/logger.js'
import { createBaileysSocket } from './config.js'
import { useMultiFileAuthState } from '@whiskeysockets/baileys'
const logger = createComponentLogger('CONNECTION_MANAGER')

/**
 * ConnectionManager - Manages WhatsApp socket connections
 * Handles auth state retrieval and socket creation
 */
export class ConnectionManager {
  constructor() {
    this.fileManager = null
    this.mongoClient = null
    this.activeSockets = new Map()
    this.pairingInProgress = new Set()
    this.connectionTimeouts = new Map()
  }

  /**
   * Initialize with dependencies
   */
  initialize(fileManager, mongoClient = null) {
    this.fileManager = fileManager
    this.mongoClient = mongoClient
    logger.info('Connection manager initialized')
  }

  /**
   * Create a new WhatsApp socket connection
   * @param {string} sessionId - Session identifier
   * @param {string} phoneNumber - Phone number for pairing (optional)
   * @param {Object} callbacks - Connection callbacks
   * @param {boolean} allowPairing - Whether to allow pairing code generation
   * @returns {Promise<Object>} WhatsApp socket instance
   */
  async createConnection(sessionId, phoneNumber = null, callbacks = {}, allowPairing = true) {
    try {
      logger.info(`Creating connection for ${sessionId}`)

      // Get authentication state
      const authState = await this._getAuthState(sessionId)
      if (!authState) {
        throw new Error('Failed to get authentication state')
      }

      // Create socket
      const sock = createBaileysSocket(authState.state, {
        // Additional config can be passed here
      })

      // Setup credentials update handler
      sock.ev.on('creds.update', authState.saveCreds)

      // Store socket metadata
      sock.sessionId = sessionId
      sock.authMethod = authState.method
      sock.authCleanup = authState.cleanup
      sock.connectionCallbacks = callbacks

      // Track active socket
      this.activeSockets.set(sessionId, sock)

      // Handle pairing if needed
      if (allowPairing && phoneNumber && !authState.state.creds?.registered) {
        this._schedulePairing(sock, sessionId, phoneNumber, callbacks)
      }

      logger.info(`Socket created for ${sessionId} using ${authState.method} auth`)
      return sock

    } catch (error) {
      logger.error(`Failed to create connection for ${sessionId}:`, error)
      throw error
    }
  }

  /**
   * Get authentication state (MongoDB or file-based)
   * @private
   */
  async _getAuthState(sessionId) {
    try {
      // Try MongoDB first if available
      if (this.mongoClient) {
        try {
            const { useMongoDBAuthState } = await import('../storage/index.js')
          const db = this.mongoClient.db()
          const collection = db.collection('auth_baileys')
          const mongoAuth = await useMongoDBAuthState(collection, sessionId)

          // Validate MongoDB auth
          if (mongoAuth?.state?.creds?.noiseKey && mongoAuth.state.creds?.signedIdentityKey) {
            logger.info(`Using MongoDB auth for ${sessionId}`)
            return {
              state: mongoAuth.state,
              saveCreds: mongoAuth.saveCreds,
              cleanup: mongoAuth.cleanup,
              method: 'mongodb'
            }
          } else {
            logger.warn(`Invalid MongoDB auth for ${sessionId}, falling back to file`)
          }
        } catch (mongoError) {
          logger.warn(`MongoDB auth failed for ${sessionId}: ${mongoError.message}`)
        }
      }

      // Fall back to file-based auth
      if (!this.fileManager) {
        throw new Error('No auth state provider available')
      }

      this.fileManager.ensureSessionDirectory(sessionId)
      const sessionPath = this.fileManager.getSessionPath(sessionId)
      const fileAuth = await useMultiFileAuthState(sessionPath)

      // Validate file auth
      if (fileAuth?.state?.creds?.noiseKey && fileAuth.state.creds?.signedIdentityKey) {
        logger.info(`Using file auth for ${sessionId}`)
        return {
          state: fileAuth.state,
          saveCreds: fileAuth.saveCreds,
          cleanup: () => {},
          method: 'file'
        }
      }

      throw new Error('No valid auth state found')

    } catch (error) {
      logger.error(`Auth state retrieval failed for ${sessionId}:`, error)
      return null
    }
  }

  /**
   * Schedule pairing code generation
   * @private
   */
  _schedulePairing(sock, sessionId, phoneNumber, callbacks) {
    // Prevent duplicate pairing
    if (this.pairingInProgress.has(sessionId)) {
      logger.warn(`Pairing already in progress for ${sessionId}`)
      return
    }

    this.pairingInProgress.add(sessionId)

    // Wait a bit before requesting pairing code
    setTimeout(async () => {
      try {
        const { handlePairing } = await import('../utils/index.js')
        await handlePairing(sock, sessionId, phoneNumber, new Map(), callbacks)

        // Clear pairing state after 5 minutes
        setTimeout(() => {
          this.pairingInProgress.delete(sessionId)
        }, 500000)

      } catch (error) {
        logger.error(`Pairing error for ${sessionId}:`, error)
        this.pairingInProgress.delete(sessionId)
        
        if (callbacks?.onError) {
          callbacks.onError(error)
        }
      }
    }, 2000)
  }

  /**
   * Check authentication availability across storage methods
   */
  async checkAuthAvailability(sessionId) {
    const availability = {
      mongodb: false,
      file: false,
      preferred: 'none'
    }

    // Check MongoDB auth
    if (this.mongoClient) {
      try {
        const { hasValidAuthData } = await import('../storage/index.js')
        const db = this.mongoClient.db()
        const collection = db.collection('auth_baileys')
        availability.mongodb = await hasValidAuthData(collection, sessionId)
      } catch (error) {
        availability.mongodb = false
      }
    }

    // Check file-based auth
    if (this.fileManager) {
      availability.file = this.fileManager.hasValidCredentials(sessionId)
    }

    // Determine preferred method
    availability.preferred = availability.mongodb ? 'mongodb' : 
                            availability.file ? 'file' : 'none'

    return availability
  }

  /**
   * Cleanup authentication state from all storage methods
   */
  async cleanupAuthState(sessionId) {
    const results = { mongodb: false, file: false }

    logger.info(`Cleaning up auth state for ${sessionId}`)

    // Cleanup MongoDB auth
    if (this.mongoClient) {
      try {
        const { cleanupSessionAuthData } = await import('../storage/index.js')
        const db = this.mongoClient.db()
        const collection = db.collection('auth_baileys')
        results.mongodb = await cleanupSessionAuthData(collection, sessionId)
      } catch (error) {
        logger.error(`MongoDB auth cleanup error:`, error)
      }
    }

    // Cleanup file-based auth
    if (this.fileManager) {
      try {
        results.file = await this.fileManager.cleanupSessionFiles(sessionId)
      } catch (error) {
        logger.error(`File auth cleanup error:`, error)
      }
    }

    // Remove from tracking
    this.activeSockets.delete(sessionId)
    this.pairingInProgress.delete(sessionId)
    this.clearConnectionTimeout(sessionId)

    return results
  }

  /**
   * Disconnect a socket
   */
  async disconnectSocket(sessionId) {
    try {
      const sock = this.activeSockets.get(sessionId)
      
      if (sock) {
        // Call socket cleanup if available
        if (typeof sock.authCleanup === 'function') {
          sock.authCleanup()
        }

        // Remove event listeners
        if (sock.ev && typeof sock.ev.removeAllListeners === 'function') {
          sock.ev.removeAllListeners()
        }

        // Close WebSocket
        if (sock.ws && sock.ws.readyState === sock.ws.OPEN) {
          sock.ws.close(1000, 'Disconnect')
        }
      }

      // Remove from tracking
      this.activeSockets.delete(sessionId)
      this.pairingInProgress.delete(sessionId)
      this.clearConnectionTimeout(sessionId)

      logger.info(`Socket disconnected for ${sessionId}`)
      return true

    } catch (error) {
      logger.error(`Disconnect error for ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Set connection timeout for a session
   */
  setConnectionTimeout(sessionId, callback, duration = 300000) {
    // Clear existing timeout
    this.clearConnectionTimeout(sessionId)

    // Set new timeout
    const timeout = setTimeout(callback, duration)
    this.connectionTimeouts.set(sessionId, timeout)
    
    logger.debug(`Connection timeout set for ${sessionId} (${duration}ms)`)
  }

  /**
   * Clear connection timeout
   */
  clearConnectionTimeout(sessionId) {
    const timeout = this.connectionTimeouts.get(sessionId)
    if (timeout) {
      clearTimeout(timeout)
      this.connectionTimeouts.delete(sessionId)
      return true
    }
    return false
  }

  /**
   * Check if socket is ready
   */
  isSocketReady(sock) {
    return !!(sock?.user && sock.readyState === sock.ws?.OPEN)
  }

  /**
   * Wait for socket to be ready
   */
  async waitForSocketReady(sock, timeout = 30000) {
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

  /**
   * Get connection statistics
   */
  getStats() {
    return {
      activeSockets: this.activeSockets.size,
      activeSocketIds: Array.from(this.activeSockets.keys()),
      pairingInProgress: this.pairingInProgress.size,
      activeTimeouts: this.connectionTimeouts.size,
      mongoAvailable: !!this.mongoClient,
      fileManagerAvailable: !!this.fileManager
    }
  }

  /**
   * Cleanup all connections (for shutdown)
   */
  async cleanup() {
    logger.info('Starting connection manager cleanup')

    // Clear all timeouts
    for (const [sessionId, timeout] of this.connectionTimeouts.entries()) {
      clearTimeout(timeout)
    }
    this.connectionTimeouts.clear()

    // Disconnect all sockets
    const disconnectPromises = []
    for (const sessionId of this.activeSockets.keys()) {
      disconnectPromises.push(this.disconnectSocket(sessionId))
    }
    await Promise.allSettled(disconnectPromises)

    // Clear tracking
    this.activeSockets.clear()
    this.pairingInProgress.clear()

    logger.info('Connection manager cleanup completed')
  }
}