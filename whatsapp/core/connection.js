import { createComponentLogger } from '../../utils/logger.js'
import { useMultiFileAuthState as initFileAuth, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys'
import pino from 'pino'
import { extendSocket } from "./socket-extensions.js"
import { sessionManager } from "../../index.js"
import { createSessionStore, createBaileysSocket, bindStoreToSocket, deleteSessionStore } from './config.js'
import { useMongoDBAuthState as initMongoAuth, hasValidAuthData, cleanupSessionAuthData } from '../storage/index.js'

const logger = createComponentLogger('CONNECTION_MANAGER')

export class ConnectionManager {
  constructor() {
    this.fileManager = null
    this.mongoClient = null
    this.pairingInProgress = new Set()
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
      const store = createSessionStore(sessionId)

      // ✅ CRITICAL: Create getMessage BEFORE socket creation
      const getMessage = async (key) => {
        if (store) {
          try {
            const msg = await store.loadMessage(key.remoteJid, key.id)
            return msg?.message || undefined
          } catch (error) {
            logger.debug(`getMessage failed for ${key.id}:`, error.message)
            return undefined
          }
        }
        return undefined
      }

      // ✅ Create socket WITH getMessage function
      const sock = createBaileysSocket(authState.state, sessionId, getMessage)
      extendSocket(sock)

      // ✅ CRITICAL: Bind store to socket IMMEDIATELY and wait for initial sync
      logger.info(`Binding store to socket for ${sessionId}`)
      bindStoreToSocket(sock, sessionId)

      // ✅ IMPORTANT: Give the store a moment to start listening to events
      // This ensures it catches all the initial sync data
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
      const hasMongoClient = !!this.mongoClient
      const hasFileManager = !!this.fileManager

      // Get auth state helpers based on availability
      const mongoAuthState = hasMongoClient ? await this._getMongoDBAuthState(sessionId) : null
      const fileAuthState = hasFileManager ? await this._getFileAuthState(sessionId) : null

      // Use MongoDB auth if valid
      if (mongoAuthState?.isValid) {
        logger.info(`Using MongoDB auth for ${sessionId}`)
        return mongoAuthState.result
      }

      // Fall back to file auth if valid
      if (fileAuthState?.isValid) {
        logger.info(`Using file auth for ${sessionId}`)
        return fileAuthState.result
      }

      throw new Error('No valid auth state found')

    } catch (error) {
      logger.error(`Auth state retrieval failed for ${sessionId}:`, error)
      return null
    }
  }

  async _getMongoDBAuthState(sessionId) {
    try {
      if (!this.mongoClient) return { isValid: false }

      const db = this.mongoClient.db()
      const collection = db.collection('auth_baileys')
      const mongoAuth = await initMongoAuth(collection, sessionId)

      // Validate MongoDB auth
      if (mongoAuth?.state?.creds?.noiseKey && mongoAuth.state.creds?.signedIdentityKey) {
        // ✅ CRITICAL: Wrap keys with makeCacheableSignalKeyStore
        const authState = {
          creds: mongoAuth.state.creds,
          keys: makeCacheableSignalKeyStore(
            mongoAuth.state.keys,
            pino({ level: 'silent' })
          )
        }

        return {
          isValid: true,
          result: {
            state: authState,
            saveCreds: mongoAuth.saveCreds,
            cleanup: mongoAuth.cleanup,
            method: 'mongodb'
          }
        }
      }

      return { isValid: false }

    } catch (error) {
      logger.warn(`MongoDB auth retrieval failed for ${sessionId}:`, error.message)
      return { isValid: false }
    }
  }

  async _getFileAuthState(sessionId) {
    try {
      if (!this.fileManager) return { isValid: false }

      this.fileManager.ensureSessionDirectory(sessionId)
      const sessionPath = this.fileManager.getSessionPath(sessionId)
      const fileAuth = await initFileAuth(sessionPath)

      // Validate file auth
      if (fileAuth?.state?.creds?.noiseKey && fileAuth.state.creds?.signedIdentityKey) {
        // ✅ CRITICAL: Wrap keys with makeCacheableSignalKeyStore
        const authState = {
          creds: fileAuth.state.creds,
          keys: makeCacheableSignalKeyStore(
            fileAuth.state.keys,
            pino({ level: 'silent' })
          )
        }

        return {
          isValid: true,
          result: {
            state: authState,
            saveCreds: fileAuth.saveCreds,
            cleanup: () => {},
            method: 'file'
          }
        }
      }

      return { isValid: false }

    } catch (error) {
      logger.warn(`File auth retrieval failed for ${sessionId}:`, error.message)
      return { isValid: false }
    }
  }

  _schedulePairing(sock, sessionId, phoneNumber, callbacks) {
    if (this.pairingInProgress.has(sessionId)) {
      logger.warn(`Pairing already in progress for ${sessionId}`)
      return
    }

    this.pairingInProgress.add(sessionId)

    setTimeout(async () => {
      try {
        const { handlePairing } = await import('../utils/index.js')
        await handlePairing(sock, sessionId, phoneNumber, new Map(), callbacks)

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

  async checkAuthAvailability(sessionId) {
    const availability = {
      mongodb: false,
      file: false,
      preferred: 'none'
    }

    if (this.mongoClient) {
      try {
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
    deleteSessionStore(sessionId)

    logger.info(`Auth state cleaned for ${sessionId}`)
    return results
  }

  async disconnectSocket(sessionId) {
    try {
      const sock = sessionManager.getSession(sessionId)

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
      deleteSessionStore(sessionId)

      logger.info(`Socket disconnected for ${sessionId}`)
      return true

    } catch (error) {
      logger.error(`Disconnect error for ${sessionId}:`, error)
      return false
    }
  }

  setConnectionTimeout(sessionId, callback, duration = 300000) {
    const timeout = setTimeout(callback, duration)
    logger.debug(`Connection timeout set for ${sessionId} (${duration}ms)`)
    return timeout
  }

  clearConnectionTimeout(timeout) {
    if (timeout) {
      clearTimeout(timeout)
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
      mongoAvailable: !!this.mongoClient,
      fileManagerAvailable: !!this.fileManager
    }
  }

  async cleanup() {
    logger.info('Starting connection manager cleanup')

    if (sessionManager) {
      await sessionManager.cleanup()
    }

    logger.info('Connection manager cleanup completed')
  }
}