import { createComponentLogger } from "../../utils/logger.js"
import { useMultiFileAuthState as createMultiFileAuthState, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys"
import pino from "pino"
import path from "path"
import fs from "fs"
import { extendSocket } from "./socket-extensions.js"
import { STORAGE_CONFIG, isFileBasedStorage } from "../../config/constant.js"
import { hasValidAuthData, cleanupSessionAuthData } from "./auth-utils.js"

const logger = createComponentLogger("CONNECTION_MANAGER")

export class ConnectionManager {
  constructor() {
    this.fileManager = null
    this.mongoClient = null
    this.activeSockets = new Map()
    this.pairingInProgress = new Set()
    this.connectionTimeouts = new Map()

    logger.info(`Connection manager using ${STORAGE_CONFIG.TYPE} storage for auth state`)
  }

  initialize(fileManager, mongoClient = null) {
    this.fileManager = fileManager
    this.mongoClient = mongoClient
    logger.info("Connection manager initialized")
  }

  async createConnection(sessionId, phoneNumber = null, callbacks = {}, allowPairing = true) {
    try {
      logger.info(`Creating connection for ${sessionId}`)

      // Get authentication state
      const authState = await this._getAuthState(sessionId)
      if (!authState) {
        throw new Error("Failed to get authentication state")
      }

      // Create store BEFORE socket
      const { createSessionStore, createBaileysSocket, bindStoreToSocket } = await import("./config.js")

      // CRITICAL FIX: Import proto for fallback
      const { proto } = await import("@whiskeysockets/baileys")

      const store = createSessionStore(sessionId)

      // CRITICAL: Create getMessage with proper fallback BEFORE socket creation
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

      // Create socket WITH getMessage function
      const sock = createBaileysSocket(authState.state, sessionId, getMessage)
      extendSocket(sock)

      // Bind store to socket IMMEDIATELY
      logger.info(`Binding store to socket for ${sessionId}`)
      await bindStoreToSocket(sock, sessionId)

      // Give store time to sync initial data
      await new Promise((resolve) => setTimeout(resolve, 1000))

      logger.info(`Store bound and ready for ${sessionId}`)

      // Setup credentials update handler
      sock.ev.on("creds.update", authState.saveCreds)

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
      // Check storage type from environment
      const shouldUseFileBased = isFileBasedStorage()

      if (shouldUseFileBased) {
        // FILE-BASED STORAGE: Use Baileys' multi-file auth state directly
        return await this._getFileBasedAuthState(sessionId)
      }

      // MONGODB STORAGE: Try MongoDB first if available
      if (this.mongoClient) {
        const { useMongoDBAuthState: createMongoDBAuthState } = await import("../storage/index.js")
        const db = this.mongoClient.db()
        const collection = db.collection("auth_baileys")
        const mongoAuth = await createMongoDBAuthState(collection, sessionId)

        // Validate MongoDB auth
        if (mongoAuth?.state?.creds?.noiseKey && mongoAuth.state.creds?.signedIdentityKey) {
          logger.info(`Using MongoDB auth for ${sessionId}`)

          // CRITICAL: Wrap keys with makeCacheableSignalKeyStore
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
        } else {
          logger.warn(`Invalid MongoDB auth for ${sessionId}, falling back to file`)
        }
      }

      // Fall back to file-based auth if MongoDB failed
      return await this._getFileBasedAuthState(sessionId)
    } catch (error) {
      logger.error(`Auth state retrieval failed for ${sessionId}:`, error)
      return null
    }
  }

  async _getFileBasedAuthState(sessionId) {
    try {
      // Use auth_sessions directory for file-based storage
      const authDir = path.resolve(process.cwd(), STORAGE_CONFIG.AUTH_SESSIONS_DIR)
      const sessionPath = path.join(authDir, sessionId)

      // Ensure the session directory exists
      if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true })
        logger.info(`Created auth session directory: ${sessionPath}`)
      }

      // Use Baileys' built-in multi-file auth state
      const fileAuth = await createMultiFileAuthState(sessionPath)

      // Check if we have valid credentials
      if (fileAuth?.state?.creds?.noiseKey && fileAuth.state.creds?.signedIdentityKey) {
        logger.info(`Using file-based auth for ${sessionId} (existing session)`)
      } else {
        logger.info(`Using file-based auth for ${sessionId} (new session)`)
      }

      // Wrap keys with makeCacheableSignalKeyStore for better performance
      const authState = {
        creds: fileAuth.state.creds,
        keys: makeCacheableSignalKeyStore(fileAuth.state.keys, pino({ level: "silent" })),
      }

      return {
        state: authState,
        saveCreds: fileAuth.saveCreds,
        cleanup: () => {}, // File-based doesn't need cleanup
        method: "file",
      }
    } catch (error) {
      logger.error(`File-based auth state failed for ${sessionId}:`, error)

      // If fileManager is available, try the legacy approach
      if (this.fileManager) {
        try {
          this.fileManager.ensureSessionDirectory(sessionId)
          const sessionPath = this.fileManager.getSessionPath(sessionId)
          const fileAuth = await createMultiFileAuthState(sessionPath)

          const authState = {
            creds: fileAuth.state.creds,
            keys: makeCacheableSignalKeyStore(fileAuth.state.keys, pino({ level: "silent" })),
          }

          return {
            state: authState,
            saveCreds: fileAuth.saveCreds,
            cleanup: () => {},
            method: "file-legacy",
          }
        } catch (legacyError) {
          logger.error(`Legacy file auth also failed for ${sessionId}:`, legacyError)
        }
      }

      return null
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
        const { handlePairing } = await import("../utils/index.js")
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
      preferred: "none",
    }

    const shouldUseFileBased = isFileBasedStorage()

    if (shouldUseFileBased) {
      // Check file-based auth in auth_sessions directory
      const authDir = path.resolve(process.cwd(), STORAGE_CONFIG.AUTH_SESSIONS_DIR)
      const sessionPath = path.join(authDir, sessionId)
      const credsPath = path.join(sessionPath, "creds.json")

      if (fs.existsSync(credsPath)) {
        try {
          const credsData = JSON.parse(fs.readFileSync(credsPath, "utf8"))
          availability.file = !!(credsData?.noiseKey && credsData?.signedIdentityKey)
        } catch {
          availability.file = false
        }
      }

      availability.preferred = availability.file ? "file" : "none"
    } else {
      // Check MongoDB auth
      if (this.mongoClient) {
        try {
          const db = this.mongoClient.db()
          const collection = db.collection("auth_baileys")
          availability.mongodb = await hasValidAuthData(collection, sessionId)
        } catch (error) {
          availability.mongodb = false
        }
      }

      // Also check file fallback
      if (this.fileManager) {
        availability.file = this.fileManager.hasValidCredentials(sessionId)
      }

      availability.preferred = availability.mongodb ? "mongodb" : availability.file ? "file" : "none"
    }

    return availability
  }

  async cleanupAuthState(sessionId) {
    const results = { mongodb: false, file: false }

    logger.info(`Cleaning up auth state for ${sessionId}`)

    const shouldUseFileBased = isFileBasedStorage()

    if (shouldUseFileBased) {
      // Clean up file-based auth in auth_sessions directory
      try {
        const authDir = path.resolve(process.cwd(), STORAGE_CONFIG.AUTH_SESSIONS_DIR)
        const sessionPath = path.join(authDir, sessionId)

        if (fs.existsSync(sessionPath)) {
          fs.rmSync(sessionPath, { recursive: true, force: true })
          results.file = true
          logger.info(`Cleaned up file-based auth for ${sessionId}`)
        }
      } catch (error) {
        logger.error(`File auth cleanup error for ${sessionId}:`, error)
      }
    } else {
      // Clean up MongoDB auth
      if (this.mongoClient) {
        try {
          const db = this.mongoClient.db()
          const collection = db.collection("auth_baileys")
          results.mongodb = await cleanupSessionAuthData(collection, sessionId)
        } catch (error) {
          logger.error(`MongoDB auth cleanup error:`, error)
        }
      }
    }

    // Also cleanup legacy file manager path
    if (this.fileManager) {
      try {
        results.file = (await this.fileManager.cleanupSessionFiles(sessionId)) || results.file
      } catch (error) {
        logger.error(`File auth cleanup error:`, error)
      }
    }

    // Delete store on cleanup
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
        // Call store cleanup
        if (sock._storeCleanup) {
          sock._storeCleanup()
        }

        // Call socket cleanup if available
        if (typeof sock.authCleanup === "function") {
          sock.authCleanup()
        }

        // Remove event listeners
        if (sock.ev && typeof sock.ev.removeAllListeners === "function") {
          sock.ev.removeAllListeners()
        }

        // Close WebSocket
        if (sock.ws && sock.ws.readyState === sock.ws.OPEN) {
          sock.ws.close(1000, "Disconnect")
        }
      }

      // Delete store
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

  getStats() {
    return {
      activeSockets: this.activeSockets.size,
      activeSocketIds: Array.from(this.activeSockets.keys()),
      pairingInProgress: this.pairingInProgress.size,
      activeTimeouts: this.connectionTimeouts.size,
      mongoAvailable: !!this.mongoClient,
      fileManagerAvailable: !!this.fileManager,
      storageType: STORAGE_CONFIG.TYPE,
    }
  }

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

    logger.info("Connection manager cleanup completed")
  }
}
