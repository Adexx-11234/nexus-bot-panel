import { createComponentLogger } from "../../utils/logger.js"
import { useMultiFileAuthState, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys"
import pino from "pino"
import { extendSocket } from "./socket-extensions.js"
import { WAProto as proto } from "@whiskeysockets/baileys"

const logger = createComponentLogger("CONNECTION_MANAGER")

// ==================== MESSAGE CACHE ====================
class MessageCache {
  constructor(maxSize = 1000) {
    this.cache = new Map()
    this.maxSize = maxSize
    this.hits = 0
    this.misses = 0
  }

  get(key) {
    if (this.cache.has(key)) {
      this.hits++
      return this.cache.get(key)
    }
    this.misses++
    return null
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    this.cache.set(key, value)
  }

  getStats() {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: this.hits + this.misses > 0 ? (this.hits / (this.hits + this.misses) * 100).toFixed(2) : 0,
    }
  }

  clear() {
    this.cache.clear()
    this.hits = 0
    this.misses = 0
  }
}

// ==================== CONNECTION MANAGER ====================
export class ConnectionManager {
  constructor() {
    this.fileManager = null
    this.storage = null
    this.activeSockets = new Map()
    this.pairingInProgress = new Set()
    this.connectionTimeouts = new Map()
    this.messageCache = new MessageCache(1000)
  }

  initialize(fileManager, storage = null) {
    this.fileManager = fileManager
    this.storage = storage

    logger.info("Connection manager initialized")
  }

  get mongoStorage() {
    return this.storage?.mongoStorage || null
  }

  get isMongoAvailable() {
    return !!(this.storage?.isMongoConnected && this.storage?.mongoStorage)
  }

  // ==================== CREATE CONNECTION ====================
  async createConnection(sessionId, phoneNumber = null, callbacks = {}, allowPairing = true) {
    try {
      logger.info(`Creating connection for ${sessionId}`)

      const authState = await this._getAuthState(sessionId, allowPairing)
      if (!authState) {
        throw new Error("Failed to get authentication state")
      }

      const { createSessionStore, createBaileysSocket, bindStoreToSocket } = await import("./config.js")

      const store = createSessionStore(sessionId)

      // Create optimized getMessage function
      const getMessage = this._createGetMessage(store)

      let sock = createBaileysSocket(authState.state, sessionId, getMessage)
      extendSocket(sock)

      // Setup credentials update handler
      sock.ev.on("creds.update", authState.saveCreds)

      // Bind store
      logger.info(`Binding store to socket for ${sessionId}`)
      await bindStoreToSocket(sock, sessionId)
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Store metadata
      sock.sessionId = sessionId
      sock.authMethod = authState.method
      sock.authCleanup = authState.cleanup
      sock.connectionCallbacks = callbacks
      sock._sessionStore = store
      sock._storeCleanup = () => {
        if (authState.cleanup) authState.cleanup()
      }
      sock._messageCache = getMessage._cache

      this.activeSockets.set(sessionId, sock)

      // Handle pairing
      if (allowPairing && phoneNumber && !authState.state.creds?.registered) {
        this._schedulePairing(sock, sessionId, phoneNumber, callbacks)
      }

      logger.info(`✅ Socket created for ${sessionId} using ${authState.method} auth`)
      return sock
    } catch (error) {
      logger.error(`Failed to create connection for ${sessionId}:`, error)
      throw error
    }
  }

  // ==================== GET MESSAGE (OPTIMIZED) ====================
  _createGetMessage(store) {
    const cache = this.messageCache

    const getMessage = async (key) => {
      if (!key || !key.remoteJid || !key.id) {
        return proto.Message.fromObject({})
      }

      const cacheKey = `${key.remoteJid}:${key.id}`

      // Fast in-memory cache check
      const cached = cache.get(cacheKey)
      if (cached) return cached

      // Try store lookup with timeout
      if (store) {
        try {
          const msg = await Promise.race([
            store.loadMessage(key.remoteJid, key.id),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
          ])

          if (msg?.message) {
            cache.set(cacheKey, msg.message)
            return msg.message
          }
        } catch (error) {
          logger.debug(`getMessage store lookup failed: ${error.message}`)
        }
      }

      return proto.Message.fromObject({})
    }

    getMessage._cache = cache
    return getMessage
  }

  // ==================== AUTH STATE ====================
  async _getAuthState(sessionId, allowPairing = true) {
    try {
      logger.info(`[${sessionId}] Getting auth state (pairing: ${allowPairing})`)

      // Try MongoDB first if available
      if (this.isMongoAvailable && this.mongoStorage) {
        try {
          const { useMongoDBAuthState } = await import("../storage/index.js")

          logger.info(`[${sessionId}] Attempting MongoDB auth`)

          const mongoAuth = await useMongoDBAuthState(
            this.mongoStorage,
            sessionId,
            allowPairing,
            "telegram"
          )

          if (mongoAuth?.state?.creds) {
            const hasCreds = mongoAuth.state.creds.noiseKey && mongoAuth.state.creds.signedIdentityKey

            if (hasCreds || allowPairing) {
              logger.info(`[${sessionId}] ✅ Using MongoDB auth`)

              const authState = {
                creds: mongoAuth.state.creds,
                keys: makeCacheableSignalKeyStore(mongoAuth.state.keys, pino({ level: "silent" })),
              }

              return {
                state: authState,
                saveCreds: mongoAuth.saveCreds,
                cleanup: mongoAuth.cleanup,
                method: "mongodb",
              }
            }
          }

          logger.warn(`[${sessionId}] MongoDB auth invalid`)
        } catch (mongoError) {
          logger.error(`[${sessionId}] MongoDB auth error: ${mongoError.message}`)
        }
      }

      // Fallback to file auth
      if (!this.fileManager) {
        throw new Error("No auth provider available")
      }

      logger.info(`[${sessionId}] Using file auth`)

      await this.fileManager.ensureSessionDirectory(sessionId)
      const sessionPath = this.fileManager.getSessionPath(sessionId)
      const fileAuth = await useMultiFileAuthState(sessionPath)

      if (fileAuth?.state?.creds) {
        const hasCreds = fileAuth.state.creds.noiseKey && fileAuth.state.creds.signedIdentityKey
        logger.info(`[${sessionId}] ✅ File auth loaded`)

        const authState = {
          creds: fileAuth.state.creds,
          keys: makeCacheableSignalKeyStore(fileAuth.state.keys, pino({ level: "silent" })),
        }

        return {
          state: authState,
          saveCreds: fileAuth.saveCreds,
          cleanup: () => {},
          method: "file",
        }
      }

      throw new Error("No valid auth state found")
    } catch (error) {
      logger.error(`[${sessionId}] Auth retrieval failed: ${error.message}`)
      return null
    }
  }

  // ==================== PAIRING ====================
  _schedulePairing(sock, sessionId, phoneNumber, callbacks) {
    if (this.pairingInProgress.has(sessionId)) {
      logger.warn(`Pairing already in progress for ${sessionId}`)
      return
    }

    this.pairingInProgress.add(sessionId)

    const waitForWebSocketAndPair = async () => {
      try {
        logger.info(`Waiting for WebSocket to open: ${sessionId}`)

        const maxWait = 30000
        const checkInterval = 100
        let waited = 0

        while (waited < maxWait) {
          const readyState = sock.ws?.socket?._readyState

          if (sock.ws && readyState === 1) {
            logger.info(`✅ WebSocket OPEN after ${waited}ms`)
            break
          }

          if (waited % 1000 === 0 && waited > 0) {
            logger.debug(`Waiting... readyState: ${readyState}, waited: ${waited}ms`)
          }

          await new Promise((resolve) => setTimeout(resolve, checkInterval))
          waited += checkInterval
        }

        const finalReadyState = sock.ws?.socket?._readyState
        if (finalReadyState !== 1) {
          throw new Error(`WebSocket not ready after ${maxWait}ms`)
        }

        // Wait for stability
        await new Promise((resolve) => setTimeout(resolve, 500))

        logger.info(`Requesting pairing code for ${sessionId}`)

        const { handlePairing } = await import("../utils/index.js")
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

    waitForWebSocketAndPair()
  }

  // ==================== AUTH AVAILABILITY ====================
  async checkAuthAvailability(sessionId) {
    try {
      const { checkAuthAvailability } = await import("../storage/index.js")

      const result = await checkAuthAvailability(this.mongoStorage, sessionId)

      return {
        mongodb: result.hasMongo,
        file: result.hasFile,
        preferred: result.preferred,
      }
    } catch (error) {
      logger.error(`[${sessionId}] Auth check failed: ${error.message}`)

      const hasFile = this.fileManager ? await this.fileManager.hasValidCredentials(sessionId) : false
      return {
        mongodb: false,
        file: hasFile,
        preferred: hasFile ? "file" : "none",
      }
    }
  }

  // ==================== CLEANUP ====================
  async cleanupAuthState(sessionId) {
    const results = { mongodb: false, file: false }

    logger.info(`Cleaning up auth state for ${sessionId}`)

    if (this.mongoStorage) {
      try {
        results.mongodb = await this.mongoStorage.deleteAuthState(sessionId)
      } catch (error) {
        logger.error(`MongoDB auth cleanup error: ${error.message}`)
      }
    }

    if (this.fileManager) {
      try {
        results.file = await this.fileManager.cleanupSessionFiles(sessionId)
      } catch (error) {
        logger.error(`File cleanup error: ${error.message}`)
      }
    }

    const { deleteSessionStore } = await import("./config.js")
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
        if (sock._storeCleanup) sock._storeCleanup()
        if (typeof sock.authCleanup === "function") sock.authCleanup()
        if (sock.ev && typeof sock.ev.removeAllListeners === "function") sock.ev.removeAllListeners()
        if (sock.ws && sock.ws.socket._readyState === 1) sock.ws.close(1000, "Disconnect")
      }

      const { deleteSessionStore } = await import("./config.js")
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

  // ==================== TIMEOUTS ====================
  setConnectionTimeout(sessionId, callback, duration = 300000) {
    this.clearConnectionTimeout(sessionId)
    const timeout = setTimeout(callback, duration)
    this.connectionTimeouts.set(sessionId, timeout)
    logger.debug(`Connection timeout set for ${sessionId}`)
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

  // ==================== SOCKET READY ====================
  isSocketReady(sock) {
    return !!(sock?.user && sock?.ws?.socket?._readyState === 1)
  }

  async waitForSocketReady(sock, timeout = 30000) {
    if (this.isSocketReady(sock)) {
      return true
    }

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        sock.ev.off("connection.update", handler)
        resolve(false)
      }, timeout)

      const handler = (update) => {
        if (update.connection === "open") {
          clearTimeout(timeoutId)
          sock.ev.off("connection.update", handler)
          resolve(true)
        }
      }

      sock.ev.on("connection.update", handler)
    })
  }

  // ==================== STATS ====================
  getStats() {
    return {
      activeSockets: this.activeSockets.size,
      activeSocketIds: Array.from(this.activeSockets.keys()),
      pairingInProgress: this.pairingInProgress.size,
      activeTimeouts: this.connectionTimeouts.size,
      mongoAvailable: this.isMongoAvailable,
      fileManagerAvailable: !!this.fileManager,
      messageCache: this.messageCache.getStats(),
    }
  }

  // ==================== CLEANUP ====================
  async cleanup() {
    logger.info("Starting connection manager cleanup")

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
    this.messageCache.clear()

    logger.info("Connection manager cleanup completed")
  }
}