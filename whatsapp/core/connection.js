import { createComponentLogger } from '../../utils/logger.js'
import { useMultiFileAuthState, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys'
import pino from 'pino'
import { extendSocket } from "./socket-extensions.js"
const logger = createComponentLogger('CONNECTION_MANAGER')

export class ConnectionManager {
  constructor() {
    this.fileManager = null
    this.mongoClient = null
    this.activeSockets = new Map()
    this.pairingInProgress = new Set()
    this.connectionTimeouts = new Map()
  }

  initialize(fileManager, mongoClient = null) {
    this.fileManager = fileManager
    this.mongoClient = mongoClient
    logger.info('Connection manager initialized')
  }

async createConnection(sessionId, phoneNumber = null, callbacks = {}, allowPairing = true) {
  try {
    logger.info(`Creating connection for ${sessionId}`)

    // Get authentication state
    const authState = await this._getAuthState(sessionId)
    if (!authState) {
      throw new Error('Failed to get authentication state')
    }

    // ✅ Create store BEFORE socket
    const { createSessionStore, createBaileysSocket, bindStoreToSocket } = await import('./config.js')
    
    // ✅ CRITICAL FIX: Import proto for fallback
    const { proto } = await import('@whiskeysockets/baileys')
    
    const store = createSessionStore(sessionId)

    // ✅ CRITICAL: Create getMessage with proper fallback BEFORE socket creation
    const getMessage = async (key) => {
      if (!key || !key.remoteJid || !key.id) {
        logger.debug(`Invalid key in getMessage`)
        return proto.Message.fromObject({})
      }
      
      if (store) {
        try {
          const msg = await store.loadMessage(key.remoteJid, key.id)
          if (msg?.message) {
            return msg.message
          }
        } catch (error) {
          logger.debug(`getMessage failed for ${key.id}:`, error.message)
        }
      }
      
      return proto.Message.fromObject({})
    }
        

    // ✅ Create socket WITH getMessage function
    const sock = createBaileysSocket(authState.state, sessionId, getMessage)
    extendSocket(sock)
    
    // ✅ Bind store to socket IMMEDIATELY
    logger.info(`Binding store to socket for ${sessionId}`)
    await bindStoreToSocket(sock, sessionId)
    
    // ✅ Give store time to sync initial data
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    logger.info(`Store bound and ready for ${sessionId}`)

    // Setup credentials update handler
    sock.ev.on('creds.update', authState.saveCreds)

    // Store socket metadata
    sock.sessionId = sessionId
    sock.authMethod = authState.method
    sock.authCleanup = authState.cleanup
    sock.connectionCallbacks = callbacks
    sock._sessionStore = store
    sock._storeCleanup = () => {
      if (authState.cleanup) authState.cleanup()
    }

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
            
            // ✅ CRITICAL: Wrap keys with makeCacheableSignalKeyStore
            const authState = {
              creds: mongoAuth.state.creds,
              keys: makeCacheableSignalKeyStore(
                mongoAuth.state.keys,
                pino({ level: 'silent' })
              )
            }
            
            return {
              state: authState,
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
        
        // ✅ CRITICAL: Wrap keys with makeCacheableSignalKeyStore
        const authState = {
          creds: fileAuth.state.creds,
          keys: makeCacheableSignalKeyStore(
            fileAuth.state.keys,
            pino({ level: 'silent' })
          )
        }
        
        return {
          state: authState,
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

  _schedulePairing(sock, sessionId, phoneNumber, callbacks) {
  if (this.pairingInProgress.has(sessionId)) {
    logger.warn(`Pairing already in progress for ${sessionId}`)
    return
  }

  this.pairingInProgress.add(sessionId)

  // ✅ CRITICAL FIX: Wait for WebSocket to be initialized, then request pairing
  const waitForWebSocketAndPair = async () => {
    try {
      logger.info(`Waiting for WebSocket initialization for ${sessionId}`)
      
      // Wait for sock.ws to exist and be in a valid state
      const maxWait = 30000 // 30 seconds
      const checkInterval = 100 // Check every 100ms
      let waited = 0
      
      while (waited < maxWait) {
        // Check if WebSocket exists and is CONNECTING or OPEN
        if (sock.ws && (sock.ws.readyState === sock.ws.CONNECTING || sock.ws.readyState === sock.ws.OPEN)) {
          logger.info(`WebSocket initialized after ${waited}ms (readyState: ${sock.ws.readyState})`)
          break
        }
        
        await new Promise(resolve => setTimeout(resolve, checkInterval))
        waited += checkInterval
      }
      
      // Timeout check
      if (waited >= maxWait) {
        throw new Error('WebSocket initialization timeout')
      }
      
      // Additional small delay to ensure WebSocket is stable
      await new Promise(resolve => setTimeout(resolve, 500))
      
      logger.info(`Requesting pairing code for ${sessionId}`)
      
      const { handlePairing } = await import('../utils/index.js')
      await handlePairing(sock, sessionId, phoneNumber, new Map(), callbacks)

      // Keep pairing flag for extended period
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
  }
  
  // Start waiting
  waitForWebSocketAndPair()
}

  async checkAuthAvailability(sessionId) {
    const availability = {
      mongodb: false,
      file: false,
      preferred: 'none'
    }

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

    if (this.fileManager) {
      availability.file = this.fileManager.hasValidCredentials(sessionId)
    }

    availability.preferred = availability.mongodb ? 'mongodb' : 
                            availability.file ? 'file' : 'none'

    return availability
  }

  async cleanupAuthState(sessionId) {
    const results = { mongodb: false, file: false }

    logger.info(`Cleaning up auth state for ${sessionId}`)

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

    if (this.fileManager) {
      try {
        results.file = await this.fileManager.cleanupSessionFiles(sessionId)
      } catch (error) {
        logger.error(`File auth cleanup error:`, error)
      }
    }

    // ✅ CRITICAL: Delete store on cleanup
    const { deleteSessionStore } = await import('./config.js')
    deleteSessionStore(sessionId)

    this.activeSockets.delete(sessionId)
    this.pairingInProgress.delete(sessionId)
    this.clearConnectionTimeout(sessionId)

    return results
  }

  async disconnectSocket(sessionId) {
    try {
      const sock = this.activeSockets.get(sessionId)
      
      if (sock) {
        // Call store cleanup
        if (sock._storeCleanup) {
          sock._storeCleanup()
        }

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

      // ✅ Delete store
      const { deleteSessionStore } = await import('./config.js')
      deleteSessionStore(sessionId)

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

  setConnectionTimeout(sessionId, callback, duration = 300000) {
    this.clearConnectionTimeout(sessionId)
    const timeout = setTimeout(callback, duration)
    this.connectionTimeouts.set(sessionId, timeout)
    logger.debug(`Connection timeout set for ${sessionId} (${duration}ms)`)
  }

  clearConnectionTimeout(sessionId) {
    const timeout = this.connectionTimeouts.get(sessionId)
    if (timeout) {
      clearTimeout(timeout)
      this.connectionTimeouts.delete(sessionId)
      return true
    }
    return false
  }

  isSocketReady(sock) {
    return !!(sock?.user && sock.readyState === sock.ws?.OPEN)
  }

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

  async cleanup() {
    logger.info('Starting connection manager cleanup')

    for (const [sessionId, timeout] of this.connectionTimeouts.entries()) {
      clearTimeout(timeout)
    }
    this.connectionTimeouts.clear()

    const disconnectPromises = []
    for (const sessionId of this.activeSockets.keys()) {
      disconnectPromises.push(this.disconnectSocket(sessionId))
    }
    await Promise.allSettled(disconnectPromises)

    this.activeSockets.clear()
    this.pairingInProgress.clear()

    logger.info('Connection manager cleanup completed')
  }
}