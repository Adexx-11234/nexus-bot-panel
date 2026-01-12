// ============================================================================
// session-manager.js - Optimized Session Orchestrator
// ============================================================================

import { createComponentLogger } from "../../utils/logger.js"
import { SessionState } from "./state.js"
import { WebSessionDetector } from "./detector.js"
import { SessionEventHandlers } from "./handlers.js"

const logger = createComponentLogger("SESSION_MANAGER")

const CONFIG = {
  MAX_SESSIONS: 10,
  CONCURRENCY: 3,
  STAGGER_DELAY: 800,
  BATCH_DELAY: 1500,
  RETRY_INTERVAL: 300000, // 5 min
  SYNC_INTERVAL: 7000, // 7 sec
  CLEANUP_INTERVAL: 60000, // 1 min
  MAX_RETRY_ATTEMPTS: 10,
  ENABLE_515_FLOW: process.env.ENABLE_515_FLOW === "true",
}

// ==================== SESSION MANAGER CLASS ====================
export class SessionManager {
  constructor(telegramBot = null, sessionDir = "./sessions") {
    this.telegramBot = telegramBot
    this.sessionDir = sessionDir

    // Dependencies (lazy loaded)
    this.storage = null
    this.connectionManager = null
    this.fileManager = null
    this.eventDispatcher = null

    // Session tracking
    this.activeSockets = new Map()
    this.sessionState = new SessionState()
    this.webSessionDetector = null
    this.sessionEventHandlers = new SessionEventHandlers(this)

    // Flags
    this.initializingSessions = new Set()
    this.voluntarilyDisconnected = new Set()
    this.detectedWebSessions = new Set()

    if (CONFIG.ENABLE_515_FLOW) {
      this.sessions515Restart = new Set()
      this.completed515Restart = new Set()
    }

    this.isInitialized = false
    this.eventHandlersEnabled = false

    this._startTrackingCleanup()
    this._startFailedSessionRetry()
    this._startDeletedSessionSync()

    logger.info(`Session manager created (max: ${CONFIG.MAX_SESSIONS}, 515: ${CONFIG.ENABLE_515_FLOW})`)
  }

  // ==================== INITIALIZATION ====================
  async initialize() {
    try {
      logger.info("Initializing session manager...")

      await this._initializeStorage()
      await this._initializeConnectionManager()

      const mode = process.env.STORAGE_MODE || "mongodb"
      if (mode === "mongodb") {
        await this._waitForMongoDB()
      } else {
        logger.info("File mode - skipping MongoDB wait")
      }

      logger.info("Session manager ready")
      return true
    } catch (error) {
      logger.error("Initialization failed:", error)
      throw error
    }
  }

  async _initializeStorage() {
    const { SessionStorage } = await import("../storage/index.js")
    this.storage = new SessionStorage()
    logger.info("Storage initialized")
  }

  async _initializeConnectionManager() {
    const { ConnectionManager } = await import("../core/index.js")
    const { FileManager } = await import("../storage/index.js")

    this.fileManager = new FileManager(this.sessionDir)
    this.connectionManager = new ConnectionManager()
    this.connectionManager.initialize(this.fileManager, this.storage)

    logger.info("Connection manager initialized")
  }

  async _waitForMongoDB(maxWait = 90000) {
    const mode = process.env.STORAGE_MODE || "mongodb"

    if (mode !== "mongodb") {
      if (this.storage.isMongoConnected && this.storage.client) {
        this.connectionManager.mongoClient = this.storage.client
      }
      return true
    }

    const start = Date.now()
    let lastLog = 0

    while (Date.now() - start < maxWait) {
      if (this.storage.isMongoConnected && this.storage.sessions) {
        logger.info("MongoDB ready")
        return true
      }

      const elapsed = Date.now() - start
      if (elapsed - lastLog > 3000) {
        logger.debug(`Waiting for MongoDB... (${Math.round(elapsed / 1000)}s)`)
        lastLog = elapsed
      }

      await new Promise((r) => setTimeout(r, 500))
    }

    logger.info("MongoDB connection pending - continuing")
    return true
  }

  // ==================== INITIALIZE EXISTING SESSIONS ====================
  async initializeExistingSessions() {
    try {
      if (!this.storage) await this.initialize()

      const mode = process.env.STORAGE_MODE || "mongodb"
      if (mode === "mongodb") await this._waitForMongoDB()

      const sessions = await this._getActiveSessionsFromDatabase()

      if (sessions.length === 0) {
        this.isInitialized = true
        this._enablePostInitFeatures()
        logger.info("No existing sessions")
        return { initialized: 0, total: 0 }
      }

      logger.info(`Found ${sessions.length} existing sessions`)

      const toProcess = sessions.slice(0, CONFIG.MAX_SESSIONS)
      let initialized = 0
      const failed = []

      const estimatedTime = Math.ceil((toProcess.length / CONFIG.CONCURRENCY) * 3)
      logger.info(`Starting initialization (concurrency=${CONFIG.CONCURRENCY}, est. ${estimatedTime}s)`)

      // Process in batches
      for (let i = 0; i < toProcess.length; i += CONFIG.CONCURRENCY) {
        const batch = toProcess.slice(i, i + CONFIG.CONCURRENCY)
        const batchNum = Math.floor(i / CONFIG.CONCURRENCY) + 1
        const totalBatches = Math.ceil(toProcess.length / CONFIG.CONCURRENCY)

        logger.info(`Batch ${batchNum}/${totalBatches} (${batch.length} sessions)`)

        const results = await Promise.allSettled(
          batch.map(async (data, idx) => {
            await new Promise((r) => setTimeout(r, idx * CONFIG.STAGGER_DELAY))

            const overall = i + idx
            logger.info(`[${overall + 1}/${toProcess.length}] Initializing ${data.sessionId}`)

            const success = await this._initializeSession(data)

            if (success) {
              logger.info(`✅ [${overall + 1}/${toProcess.length}] ${data.sessionId}`)
              return { success: true, data }
            } else {
              logger.warn(`❌ [${overall + 1}/${toProcess.length}] ${data.sessionId}`)
              return { success: false, data }
            }
          })
        )

        for (const result of results) {
          if (result.status === "fulfilled" && result.value.success) {
            initialized++
          } else if (result.status === "fulfilled" && !result.value.success) {
            failed.push(result.value.data)
          }
        }

        const batchSuccess = results.filter((r) => r.status === "fulfilled" && r.value.success).length
        logger.info(`Batch ${batchNum}/${totalBatches}: ${batchSuccess}/${batch.length} (total: ${initialized}/${toProcess.length})`)

        if (i + CONFIG.CONCURRENCY < toProcess.length) {
          await new Promise((r) => setTimeout(r, CONFIG.BATCH_DELAY))
        }
      }

      // Retry failed sessions
      if (failed.length > 0) {
        logger.info(`🔄 Retrying ${failed.length} failed sessions...`)

        for (let i = 0; i < failed.length; i++) {
          const data = failed[i]
          logger.info(`[Retry ${i + 1}/${failed.length}] ${data.sessionId}`)

          await new Promise((r) => setTimeout(r, 2000))

          if (await this._initializeSession(data)) {
            initialized++
            logger.info(`✅ [Retry ${i + 1}/${failed.length}] ${data.sessionId}`)
          } else {
            logger.warn(`❌ [Retry ${i + 1}/${failed.length}] ${data.sessionId}`)
          }
        }
      }

      this.isInitialized = true
      this._enablePostInitFeatures()

      logger.info(`✅ Initialization complete: ${initialized}/${toProcess.length} (${toProcess.length - initialized} failed)`)

      return {
        initialized,
        total: toProcess.length,
        failed: toProcess.length - initialized,
      }
    } catch (error) {
      logger.error("Failed to initialize sessions:", error)
      return { initialized: 0, total: 0, failed: 0 }
    }
  }

  async _initializeSession(data) {
    if (this.voluntarilyDisconnected.has(data.sessionId)) {
      return false
    }

    try {
      const authCheck = await this.connectionManager.checkAuthAvailability(data.sessionId)

      if (authCheck.preferred === "none") {
        logger.warn(`No auth for ${data.sessionId} - performing cleanup`)
        await this.performCompleteUserCleanup(data.sessionId)
        // Mark as voluntarily disconnected to prevent any reconnection attempts
        this.voluntarilyDisconnected.add(data.sessionId)
        return false
      }

      const sock = await this.createSession(
        data.userId,
        data.phoneNumber,
        {},
        false,
        data.source || "telegram",
        false
      )

      if (!sock) {
        logger.warn(`Failed to create socket for ${data.sessionId}`)
        await this.storage.updateSession(data.sessionId, {
          isConnected: false,
          connectionStatus: "failed",
          reconnectAttempts: (data.reconnectAttempts || 0) + 1,
        })
        return false
      }

      return true
    } catch (error) {
      logger.error(`Session init failed for ${data.sessionId}:`, error)
      await this.storage.updateSession(data.sessionId, {
        isConnected: false,
        connectionStatus: "error",
        reconnectAttempts: (data.reconnectAttempts || 0) + 1,
      })
      return false
    }
  }

  async _getActiveSessionsFromDatabase() {
    try {
      const mode = process.env.STORAGE_MODE || "mongodb"

      if (mode === "file") {
        logger.info("📁 File mode: Scanning disk...")
        return await this._getSessionsFromFileSystem()
      }

      logger.info("🗄️ MongoDB mode: Loading from database...")
      const sessions = await this.storage.getAllSessions()

      const active = sessions.filter(
        (s) =>
          s.sessionId &&
          (s.phoneNumber || s.isConnected || ["connected", "connecting"].includes(s.connectionStatus))
      )

      return active.map((s) => ({
        sessionId: s.sessionId,
        userId: s.telegramId || s.userId,
        telegramId: s.telegramId || s.userId,
        phoneNumber: s.phoneNumber,
        isConnected: s.isConnected !== undefined ? s.isConnected : false,
        connectionStatus: s.connectionStatus || "disconnected",
        source: s.source || "telegram",
        detected: s.detected !== false,
      }))
    } catch (error) {
      logger.error("Failed to get active sessions:", error)
      return []
    }
  }

  async _getSessionsFromFileSystem() {
    try {
      const fs = await import("fs/promises")
      const path = await import("path")

      try {
        await fs.access(this.sessionDir)
      } catch {
        logger.info(`Sessions directory ${this.sessionDir} does not exist`)
        return []
      }

      const entries = await fs.readdir(this.sessionDir, { withFileTypes: true })
      const folders = entries.filter((e) => e.isDirectory() && e.name.startsWith("session_"))

      logger.info(`Found ${folders.length} session folders`)

      const valid = []

      for (const folder of folders) {
        const sessionId = folder.name
        const sessionPath = path.join(this.sessionDir, sessionId)
        const credsPath = path.join(sessionPath, "creds.json")

        try {
          await fs.access(credsPath)

          let phoneNumber = null
          try {
            const credsData = await fs.readFile(credsPath, "utf8")
            const creds = JSON.parse(credsData)
            phoneNumber = creds.me?.id?.split(":")[0] || null
          } catch {}

          const userId = sessionId.replace("session_", "")
          let dbSession = null

          try {
            dbSession = await this.storage.getSession(sessionId)
          } catch {}

          valid.push({
            sessionId,
            userId: dbSession?.userId || userId,
            telegramId: dbSession?.telegramId || userId,
            phoneNumber: phoneNumber || dbSession?.phoneNumber,
            isConnected: false,
            connectionStatus: "disconnected",
            source: dbSession?.source || "telegram",
            detected: dbSession?.detected !== false,
          })

          logger.debug(`✅ Valid: ${sessionId} (phone: ${phoneNumber || "unknown"})`)
        } catch {
          logger.debug(`⏭️ Skipping ${sessionId}: No valid auth`)
        }
      }

      logger.info(`Found ${valid.length} valid sessions with auth`)
      return valid
    } catch (error) {
      logger.error("Failed to scan file system:", error)
      return []
    }
  }

  _enablePostInitFeatures() {
    setTimeout(() => {
      this.enableEventHandlers()
      this._startWebSessionDetection()
    }, 2000)
  }

  // ==================== EVENT HANDLERS ====================
  enableEventHandlers() {
    this.eventHandlersEnabled = true

    for (const [sessionId, sock] of this.activeSockets) {
      if (sock?.user && sock.ws?.socket?._readyState === 1 && !sock.eventHandlersSetup) {
        this._setupEventHandlers(sock, sessionId).catch(() => {})
      }
    }

    logger.info("Event handlers enabled")
  }

  async _setupEventHandlers(sock, sessionId) {
    try {
      if (!sock || sock.eventHandlersSetup || !sock.user) return
      if (!sock.ws?.socket || sock.ws.socket._readyState !== 1) return

      const { EventDispatcher } = await import("../events/index.js")

      if (!this.eventDispatcher) {
        this.eventDispatcher = new EventDispatcher(this)
      }

      this.eventDispatcher.setupEventHandlers(sock, sessionId)
      sock.eventHandlersSetup = true

      if (sock.ev.isBuffering && sock.ev.isBuffering()) {
        sock.ev.flush()
      }

      logger.info(`Event handlers set up for ${sessionId}`)
    } catch (error) {
      logger.error(`Failed to setup handlers for ${sessionId}:`, error)
    }
  }

  _startWebSessionDetection() {
    if (this.webSessionDetector) {
      this.webSessionDetector.stop()
    }

    this.webSessionDetector = new WebSessionDetector(this.storage, this)
    this.webSessionDetector.start()

    logger.info("Web session detection started")
  }

  stopWebSessionDetection() {
    if (this.webSessionDetector) {
      this.webSessionDetector.stop()
    }
  }

  // ==================== CREATE SESSION ====================
  async createSession(userId, phoneNumber = null, callbacks = {}, isReconnect = false, source = "telegram", allowPairing = true) {
    const userIdStr = String(userId)
    const sessionId = userIdStr.startsWith("session_") ? userIdStr : `session_${userIdStr}`

    try {
      if (this.initializingSessions.has(sessionId)) {
        logger.warn(`${sessionId} already initializing`)
        return this.activeSockets.get(sessionId)
      }

      if (this.activeSockets.has(sessionId) && !isReconnect) {
        const existing = this.activeSockets.get(sessionId)
        const isConnected = existing?.user && existing?.ws?.socket?._readyState === 1

        if (isConnected) {
          logger.info(`${sessionId} already connected`)
          return existing
        } else {
          logger.warn(`${sessionId} exists but not connected - recreating`)
          await this._cleanupSocketInMemory(sessionId)
        }
      }

      if (this.activeSockets.size >= CONFIG.MAX_SESSIONS) {
        throw new Error(`Maximum sessions limit (${CONFIG.MAX_SESSIONS}) reached`)
      }

      this.initializingSessions.add(sessionId)
      logger.info(`Creating ${sessionId} (${source}, reconnect: ${isReconnect})`)

      if (isReconnect) {
        logger.info(`🔄 Reconnecting ${sessionId} - preserving files`)
        await this._cleanupSocketInMemory(sessionId)
      } else if (allowPairing) {
        const existing = this.activeSockets.has(sessionId)
        const authCheck = await this.connectionManager.checkAuthAvailability(sessionId)

        if (authCheck.preferred !== "none" && !existing) {
          logger.info(`Cleaning stale auth for NEW pairing: ${sessionId}`)
          await this.performCompleteUserCleanup(sessionId)
          await new Promise((r) => setTimeout(r, 1000))
        }
      }

      const sock = await this.connectionManager.createConnection(sessionId, phoneNumber, callbacks, allowPairing)

      if (!sock) {
        throw new Error("Failed to create socket")
      }

      this.activeSockets.set(sessionId, sock)
      sock.connectionCallbacks = callbacks

      this.sessionState.set(sessionId, {
        userId: userIdStr,
        phoneNumber,
        source,
        isConnected: true,
        connectionStatus: "connected",
        callbacks,
      })

      this.sessionEventHandlers.setupConnectionHandler(sock, sessionId, callbacks)
      this.sessionEventHandlers.setupCredsHandler(sock, sessionId)

      if (!sock.eventHandlersSetup) {
        await this._setupEventHandlers(sock, sessionId)
      }

      await this.storage.saveSession(sessionId, {
        userId: userIdStr,
        telegramId: userIdStr,
        phoneNumber,
        isConnected: true,
        connectionStatus: "connected",
        reconnectAttempts: 0,
        source,
        detected: source === "web" ? false : true,
      })

      logger.info(`✅ ${sessionId} created`)
      return sock
    } catch (error) {
      logger.error(`Failed to create ${sessionId}:`, error)
      throw error
    } finally {
      this.initializingSessions.delete(sessionId)
    }
  }

  async createWebSession(webSessionData) {
    const { sessionId, userId, phoneNumber } = webSessionData

    try {
      logger.info(`📌 Marking ${sessionId} as detected`)
      await this.storage.markSessionAsDetected(sessionId, true)
      this.detectedWebSessions.add(sessionId)

      const sock = await this.createSession(
        userId,
        phoneNumber,
        {
          onConnected: () => logger.info(`✅ Web session ${sessionId} connected`),
          onError: () => {
            logger.error(`❌ Web session ${sessionId} error`)
            this.detectedWebSessions.delete(sessionId)
            this.storage.markSessionAsDetected(sessionId, false).catch(() => {})
          },
        },
        false,
        "web",
        true
      )

      return !!sock
    } catch (error) {
      logger.error(`Failed to create web session ${sessionId}:`, error)
      this.detectedWebSessions.delete(sessionId)
      await this.storage.markSessionAsDetected(sessionId, false)
      return false
    }
  }

  // ==================== DISCONNECT SESSION ====================
  async disconnectSession(sessionId, forceCleanup = false) {
    try {
      logger.info(`Disconnecting ${sessionId} (force: ${forceCleanup})`)

      const eventDispatcher = this.getEventDispatcher()
      const connectionHandler = eventDispatcher?.connectionEventHandler
      if (connectionHandler) {
        connectionHandler.cancelReconnection(sessionId)
      }

      const sessionData = await this.storage.getSession(sessionId)
      const isWeb = sessionData?.source === "web"

      if (forceCleanup) {
        return await this.performCompleteUserCleanup(sessionId)
      }

      this.initializingSessions.delete(sessionId)
      this.voluntarilyDisconnected.add(sessionId)
      this.detectedWebSessions.delete(sessionId)

      const sock = this.activeSockets.get(sessionId)
      if (sock) {
        await this._cleanupSocket(sessionId, sock)
      }

      this.activeSockets.delete(sessionId)
      this.sessionState.delete(sessionId)

      if (isWeb) {
        await this.storage.updateSession(sessionId, {
          isConnected: false,
          connectionStatus: "disconnected",
        })
        logger.info(`Web user ${sessionId} disconnected (metadata preserved)`)
      } else {
        await this.storage.deleteSession(sessionId)
        logger.info(`Telegram user ${sessionId} disconnected (can reconnect)`)
      }

      logger.info(`${sessionId} disconnected`)
      return true
    } catch (error) {
      logger.error(`Failed to disconnect ${sessionId}:`, error)
      return false
    }
  }

  // ==================== CLEANUP METHODS ====================
  async _cleanupSocketInMemory(sessionId) {
    try {
      logger.info(`🧹 In-memory cleanup for ${sessionId}`)

      const results = { messageStore: false }
      try {
        const { deleteSessionStore } = await import("../core/index.js")
        await deleteSessionStore(sessionId)
        results.messageStore = true
        logger.info(`✅ Message store deleted for ${sessionId}`)
      } catch (error) {
        logger.error(`Message store deletion failed: ${error.message}`)
      }

      const sock = this.activeSockets.get(sessionId)

      if (sock) {
        if (sock?.ev?.isBuffering?.()) {
          try {
            sock.ev.flush()
          } catch {}
        }

        if (sock.ev && typeof sock.ev.removeAllListeners === "function") {
          sock.ev.removeAllListeners()
        }

        if (sock.ws?.socket && sock.ws.socket._readyState === 1) {
          sock.ws.close(1000, "Reconnect")
        }

        sock.user = null
        sock.eventHandlersSetup = false
        sock.connectionCallbacks = null
        sock._sessionStore = null
      }

      this.activeSockets.delete(sessionId)
      this.sessionState.delete(sessionId)

      logger.info(`✅ Socket cleaned in-memory for ${sessionId}`)
      return true
    } catch (error) {
      logger.error(`Failed in-memory cleanup for ${sessionId}:`, error)
      return false
    }
  }

  async _cleanupSocket(sessionId, sock) {
    try {
      if (sock?.ev?.isBuffering?.()) {
        try {
          sock.ev.flush()
        } catch {}
      }

      if (sock._storeCleanup) {
        sock._storeCleanup()
      }

      if (sock.ev && typeof sock.ev.removeAllListeners === "function") {
        sock.ev.removeAllListeners()
      }

      if (sock.ws?.socket && sock.ws.socket._readyState === 1) {
        sock.ws.close(1000, "Cleanup")
      }

      sock.user = null
      sock.eventHandlersSetup = false
      sock.connectionCallbacks = null
      sock._sessionStore = null

      return true
    } catch (error) {
      logger.error(`Socket cleanup failed for ${sessionId}:`, error)
      return false
    }
  }

  async performCompleteUserCleanup(sessionId) {
    const results = { socket: false, database: false, authState: false, messageStore: false }

    try {
      logger.info(`🗑️ COMPLETE cleanup for ${sessionId} (logout)`)

      const sessionData = await this.storage.getSession(sessionId)
      const isWeb = sessionData?.source === "web"

      const eventDispatcher = this.getEventDispatcher()
      const connectionHandler = eventDispatcher?.connectionEventHandler
      if (connectionHandler) {
        connectionHandler.cancelReconnection(sessionId)
      }

      const sock = this.activeSockets.get(sessionId)
      if (sock) {
        results.socket = await this._cleanupSocket(sessionId, sock)
      }

      this.activeSockets.delete(sessionId)
      this.sessionState.delete(sessionId)
      this.initializingSessions.delete(sessionId)
      this.voluntarilyDisconnected.add(sessionId)
      this.detectedWebSessions.delete(sessionId)

      try {
        const { deleteSessionStore } = await import("../core/index.js")
        await deleteSessionStore(sessionId)
        results.messageStore = true
        logger.info(`✅ Message store deleted for ${sessionId}`)
      } catch (error) {
        logger.error(`Message store deletion failed: ${error.message}`)
      }

      try {
        await this.storage.fileManager.cleanupSessionFiles(sessionId)

        if (this.storage.isMongoConnected) {
          await this.storage.mongoStorage.completeCleanup(sessionId)
        }

        results.database = true
        results.authState = true
        logger.info(`✅ MongoDB + Files cleanup complete for ${sessionId}`)
      } catch (error) {
        logger.error(`Database cleanup failed: ${error.message}`)
      }

      if (this.storage.isPostgresConnected) {
        if (isWeb) {
          try {
            await this.storage.postgresStorage.updateSession(sessionId, {
              isConnected: false,
              connectionStatus: "disconnected",
              updatedAt: new Date(),
            })
            logger.info(`✅ Web user ${sessionId} PostgreSQL preserved`)
          } catch (error) {
            logger.error(`PostgreSQL update failed: ${error.message}`)
          }
        } else {
          try {
            await this.storage.postgresStorage.completelyDeleteSession(sessionId)
            logger.info(`✅ Telegram user ${sessionId} deleted from PostgreSQL`)
          } catch (error) {
            logger.error(`PostgreSQL deletion failed: ${error.message}`)
          }
        }
      }

      logger.info(`✅ Complete cleanup for ${sessionId}:`, results)
      return results
    } catch (error) {
      logger.error(`Complete cleanup failed for ${sessionId}:`, error)
      return results
    }
  }

  // ==================== BACKGROUND TASKS ====================
  _startTrackingCleanup() {
    setInterval(() => {
      const activeIds = new Set(this.activeSockets.keys())
      let cleaned = 0

      const cleanSet = (set) => {
        const toRemove = []
        for (const id of set) {
          if (!activeIds.has(id)) toRemove.push(id)
        }
        toRemove.forEach((id) => {
          set.delete(id)
          cleaned++
        })
      }

      cleanSet(this.initializingSessions)
      cleanSet(this.voluntarilyDisconnected)
      cleanSet(this.detectedWebSessions)

      if (CONFIG.ENABLE_515_FLOW) {
        cleanSet(this.sessions515Restart)
        cleanSet(this.completed515Restart)
      }

      if (cleaned > 0) {
        logger.debug(`Tracking cleanup: ${cleaned} stale entries, ${this.activeSockets.size} active`)
      }

      const mem = process.memoryUsage()
      logger.debug(`Memory: RSS ${Math.round(mem.rss / 1024 / 1024)}MB, Heap ${Math.round(mem.heapUsed / 1024 / 1024)}MB`)
    }, CONFIG.CLEANUP_INTERVAL)
  }

  _startFailedSessionRetry() {
    setInterval(async () => {
      if (!this.isInitialized) return

      try {
        const sessions = await this.storage.getAllSessions()
        const failed = sessions.filter(
          (s) =>
            !s.isConnected &&
            s.connectionStatus !== "disconnected" &&
            !this.voluntarilyDisconnected.has(s.sessionId) &&
            !this.activeSockets.has(s.sessionId) &&
            (s.reconnectAttempts || 0) < CONFIG.MAX_RETRY_ATTEMPTS
        )

        if (failed.length > 0) {
          logger.info(`🔄 Retrying ${failed.length} failed sessions...`)

          for (const data of failed.slice(0, 3)) {
            await this._initializeSession(data)
            await new Promise((r) => setTimeout(r, 2000))
          }
        }
      } catch (error) {
        logger.error("Failed session retry:", error)
      }
    }, CONFIG.RETRY_INTERVAL)
  }

  _startDeletedSessionSync() {
    setInterval(async () => {
      if (!this.isInitialized) return

      try {
        const activeSessions = Array.from(this.activeSockets.keys())

        for (const sessionId of activeSessions) {
          const sessionData = await this.storage.getSession(sessionId)

          if (this.storage.isPostgresConnected) {
            const pgSession = await this.storage.postgresStorage.getSession(sessionId)

            if (pgSession?.source === "web") {
              const hasMongoAuth = this.storage.isMongoConnected
                ? await this.storage.mongoStorage.hasValidAuthData(sessionId)
                : false

              if (!sessionData && !hasMongoAuth) {
                logger.warn(`🔄 Web session ${sessionId} deleted from MongoDB - cleaning`)

                const sock = this.activeSockets.get(sessionId)
                if (sock) {
                  await this._cleanupSocket(sessionId, sock)
                }

                this.activeSockets.delete(sessionId)
                this.sessionState.delete(sessionId)
                this.detectedWebSessions.delete(sessionId)

                await this.storage.fileManager.cleanupSessionFiles(sessionId)

                try {
                  const { deleteSessionStore } = await import("../core/index.js")
                  await deleteSessionStore(sessionId)
                } catch {}

                await this.storage.postgresStorage.updateSession(sessionId, {
                  isConnected: false,
                  connectionStatus: "disconnected",
                  updatedAt: new Date(),
                })

                logger.info(`✅ Web session ${sessionId} cleaned`)
              }
            }
          }
        }
      } catch (error) {
        logger.error("Deleted session sync:", error)
      }
    }, CONFIG.SYNC_INTERVAL)
  }

  // ==================== GETTERS ====================
  getSession(sessionId) {
    const sock = this.activeSockets.get(sessionId)

    if (!sock && sessionId) {
      import("../utils/index.js")
        .then(({ invalidateSessionLookupCache }) => {
          invalidateSessionLookupCache(sessionId)
        })
        .catch(() => {})
    }

    return sock
  }

  async getSessionByWhatsAppJid(jid) {
    if (!jid) return null

    try {
      const { getSessionByRemoteJid } = await import("../utils/session-lookup.js")
      return await getSessionByRemoteJid(jid, this)
    } catch (error) {
      logger.error(`Error in getSessionByWhatsAppJid:`, error)
      return null
    }
  }

  /**
   * Get all sessions from database
   */
  async getAllSessions() {
    return await this.storage.getAllSessions()
  }

  /**
   * Check if session is connected
   */
  async isSessionConnected(sessionId) {
    const session = await this.storage.getSession(sessionId)
    return session?.isConnected || false
  }

  /**
   * Check if session is really connected (socket + database)
   */
  async isReallyConnected(sessionId) {
    const sock = this.activeSockets.get(sessionId)
    const session = await this.storage.getSession(sessionId)
    return !!(sock && sock.user && session?.isConnected)
  }

  /**
   * Get session information
   */
  async getSessionInfo(sessionId) {
    const session = await this.storage.getSession(sessionId)
    const hasSocket = this.activeSockets.has(sessionId)
    const stateInfo = this.sessionState.get(sessionId)

    return {
      ...session,
      hasSocket,
      stateInfo,
    }
  }

  /**
   * Check if session is voluntarily disconnected
   */
  isVoluntarilyDisconnected(sessionId) {
    return this.voluntarilyDisconnected.has(sessionId)
  }

  /**
   * Clear voluntary disconnection flag
   */
  clearVoluntaryDisconnection(sessionId) {
    this.voluntarilyDisconnected.delete(sessionId)
  }

  /**
   * Check if web session is detected
   */
  isWebSessionDetected(sessionId) {
    return this.detectedWebSessions.has(sessionId)
  }

  /**
   * Get initialization status
   */
  getInitializationStatus() {
    return {
      isInitialized: this.isInitialized,
      activeSessions: this.activeSockets.size,
      initializingSessions: this.initializingSessions.size,
      eventHandlersEnabled: this.eventHandlersEnabled,
      webDetectionActive: this.webSessionDetector?.isRunning() || false,
      enable515Flow: ENABLE_515_FLOW,
    }
  }

  /**
   * Get statistics
   */
  async getStats() {
    try {
      const allSessions = await this.storage.getAllSessions()
      const connectedSessions = allSessions.filter((s) => s.isConnected)
      const telegramSessions = allSessions.filter((s) => s.source === "telegram" || !s.source)
      const webSessions = allSessions.filter((s) => s.source === "web")

      return {
        totalSessions: allSessions.length,
        connectedSessions: connectedSessions.length,
        telegramSessions: telegramSessions.length,
        webSessions: webSessions.length,
        detectedWebSessions: this.detectedWebSessions.size,
        activeSockets: this.activeSockets.size,
        eventHandlersEnabled: this.eventHandlersEnabled,
        maxSessions: this.maxSessions,
        isInitialized: this.isInitialized,
        enable515Flow: ENABLE_515_FLOW,
        storage: this.storage?.isConnected ? "Connected" : "Disconnected",
        webDetection: this.webSessionDetector?.isRunning() ? "Active" : "Inactive",
        mongoConnected: this.storage?.isMongoConnected || false,
        postgresConnected: this.storage?.isPostgresConnected || false,
        stateStats: this.sessionState.getStats(),
      }
    } catch (error) {
      logger.error("Failed to get stats:", error)
      return {
        error: "Failed to retrieve statistics",
        activeSockets: this.activeSockets.size,
      }
    }
  }

  /**
   * Shutdown session manager
   */
  async shutdown() {
    try {
      logger.info("Shutting down session manager...")

      // Stop web session detection
      this.stopWebSessionDetection()

      // Disconnect all sessions
      const disconnectPromises = []
      for (const sessionId of this.activeSockets.keys()) {
        disconnectPromises.push(this.disconnectSession(sessionId))
      }

      await Promise.allSettled(disconnectPromises)

      // Close storage
      if (this.storage) {
        await this.storage.close()
      }

      // Cleanup connection manager
      if (this.connectionManager) {
        await this.connectionManager.cleanup()
      }

      logger.info("Session manager shutdown complete")
    } catch (error) {
      logger.error("Shutdown error:", error)
    }
  }

  /**
   * Perform maintenance tasks
   */
  async performMaintenance() {
    try {
      logger.debug("Performing session manager maintenance")

      // Cleanup stale session states
      this.sessionState.cleanupStale()

      // Flush storage write buffers
      if (this.storage?.flushWriteBuffers) {
        await this.storage.flushWriteBuffers()
      }

      // Cleanup orphaned session files
      if (this.fileManager) {
        await this.fileManager.cleanupOrphanedSessions(this.storage)
      }
    } catch (error) {
      logger.error("Maintenance error:", error)
    }
  }

  /**
   * Get connection manager instance
   */
  getConnectionManager() {
    return this.connectionManager
  }

  /**
   * Get storage instance
   */
  getStorage() {
    return this.storage
  }

  /**
   * Get session state instance
   */
  getSessionState() {
    return this.sessionState
  }

  /**
   * Get event dispatcher instance
   */
  getEventDispatcher() {
    return this.eventDispatcher
  }
}

// Export singleton pattern functions
let sessionManagerInstance = null

/**
 * Initialize session manager singleton
 */
export function initializeSessionManager(telegramBot, sessionDir = "./sessions") {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager(telegramBot, sessionDir)
  }
  return sessionManagerInstance
}

/**
 * Get session manager instance
 */
export function getSessionManager() {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager(null, "./sessions")
  }
  return sessionManagerInstance
}

/**
 * Reset session manager (for testing)
 */
export function resetSessionManager() {
  sessionManagerInstance = null
}
