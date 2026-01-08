// ============================================================================
// session-coordinator.js - Optimized MongoDB/File/Postgres Coordination
// ============================================================================

import crypto from "crypto"
import { createComponentLogger } from "../../utils/logger.js"
import { MongoDBStorage } from "./mongodb.js"
import { PostgreSQLStorage } from "./postgres.js"
import { FileManager } from "./file.js"

const logger = createComponentLogger("SESSION_STORAGE")

const CONFIG = {
  CACHE_MAX_SIZE: 200,
  CACHE_TTL: 300000,
  WRITE_FLUSH_INTERVAL: 500,
  ORPHAN_CLEANUP_INTERVAL: 1800000, // 30 min
  PREKEY_CLEANUP_INTERVAL: 600000, // 10 min
  BACKUP_INTERVAL: 14400000, // 4 hours
  BACKUP_JITTER_MAX: 1800000, // 30 min
  BATCH_SIZE: 4,
  BATCH_DELAY: 10000,
}

// ==================== SESSION STORAGE CLASS ====================
export class SessionStorage {
  constructor() {
    this.storageMode = process.env.STORAGE_MODE || "mongodb"
    this.mongoStorage = new MongoDBStorage()
    this.postgresStorage = new PostgreSQLStorage()
    this.fileManager = new FileManager()
    
    this.sessionCache = new Map()
    this.writeBuffer = new Map()
    this.encryptionKey = this._getEncryptionKey()
    
    this.timers = {
      health: null,
      orphan: null,
      cache: null,
      prekey: null,
      backup: null,
    }

    this._startHealthCheck()
    this._startOrphanCleanup()
    this._startCacheCleanup()
  }

  get isConnected() {
    return true
  }

  get isMongoConnected() {
    return this.mongoStorage.isConnected
  }

  get isPostgresConnected() {
    return this.postgresStorage.isConnected
  }

  get client() {
    return this.mongoStorage.client
  }

  get sessions() {
    return this.mongoStorage.sessions
  }

  get postgresPool() {
    return this.postgresStorage.pool
  }

  // ==================== SAVE SESSION ====================
async saveSession(sessionId, sessionData, credentials = null) {
  if (this.sessionCache.size < CONFIG.CACHE_MAX_SIZE) {
    this.sessionCache.set(sessionId, { ...sessionData, credentials, lastCached: Date.now() })
  }

  const isWeb = sessionData.source === "web"
  let saved = false

  // Create metadata file first
  const metadata = {
    sessionId,
    telegramId: sessionData.telegramId || sessionData.userId,
    userId: sessionData.userId || sessionData.telegramId,
    phoneNumber: sessionData.phoneNumber,
    isConnected: sessionData.isConnected !== undefined ? sessionData.isConnected : false,
    connectionStatus: sessionData.connectionStatus || "disconnected",
    reconnectAttempts: sessionData.reconnectAttempts || 0,
    source: sessionData.source || "telegram",
    detected: sessionData.detected !== false,
    detectedAt: sessionData.detectedAt,
    createdAt: sessionData.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  await this.fileManager.saveSession(sessionId, metadata)

  if (this.postgresStorage.isConnected) {
    this.postgresStorage.saveSession(sessionId, sessionData).catch(() => {})
  }

  if (this.storageMode === "file") {
    saved = await this.fileManager.saveSession(sessionId, sessionData)

    if (isWeb && this.mongoStorage.isConnected) {
      this.mongoStorage.saveSession(sessionId, sessionData).catch(() => {})
    }
  } else {
    if (this.mongoStorage.isConnected) {
      saved = await this.mongoStorage.saveSession(sessionId, sessionData)
    }

    if (!saved) {
      saved = await this.fileManager.saveSession(sessionId, sessionData)
    }
  }

  return saved
}

  // ==================== GET SESSION ====================
  async getSession(sessionId) {
    // Check cache
    const cached = this.sessionCache.get(sessionId)
    if (cached && Date.now() - cached.lastCached < CONFIG.CACHE_TTL) {
      return this._format(cached)
    }

    let data = null

    if (this.storageMode === "file") {
      data = await this.fileManager.getSession(sessionId)
      
      // Check MongoDB for web sessions
      if (!data && this.mongoStorage.isConnected) {
        const mongoData = await this.mongoStorage.getSession(sessionId)
        if (mongoData?.source === "web") data = mongoData
      }
    } else {
      // Try MongoDB then file
      if (this.mongoStorage.isConnected) {
        data = await this.mongoStorage.getSession(sessionId)
      }
      if (!data) {
        data = await this.fileManager.getSession(sessionId)
      }
    }

    // Update cache
    if (data && this.sessionCache.size < CONFIG.CACHE_MAX_SIZE) {
      this.sessionCache.set(sessionId, { ...data, lastCached: Date.now() })
    }

    return data ? this._format(data) : null
  }

  // ==================== UPDATE SESSION ====================
  async updateSession(sessionId, updates) {
    // Update cache immediately
    if (this.sessionCache.has(sessionId)) {
      const cached = this.sessionCache.get(sessionId)
      Object.assign(cached, updates, { lastCached: Date.now() })
    }

    // Buffer write
    const bufferId = `${sessionId}_update`
    const existing = this.writeBuffer.get(bufferId)
    
    if (existing) {
      if (existing.timeout) clearTimeout(existing.timeout)
      Object.assign(existing.data, updates)
    } else {
      this.writeBuffer.set(bufferId, { data: { ...updates }, timeout: null })
    }

    const timeoutId = setTimeout(async () => {
      const buffer = this.writeBuffer.get(bufferId)
      if (!buffer) return

      buffer.data.updatedAt = new Date()
      const session = await this.getSession(sessionId)
      const isWeb = session?.source === "web"

      if (this.storageMode === "file") {
        await this.fileManager.updateSession(sessionId, buffer.data)
        
        // Web sessions also update MongoDB
        if (isWeb && this.mongoStorage.isConnected) {
          this.mongoStorage.updateSession(sessionId, buffer.data).catch(() => {})
        }
      } else {
        if (this.mongoStorage.isConnected) {
          await this.mongoStorage.updateSession(sessionId, buffer.data)
        } else {
          await this.fileManager.updateSession(sessionId, buffer.data)
        }
      }

      // Background PostgreSQL update
      if (this.postgresStorage.isConnected) {
        this.postgresStorage.updateSession(sessionId, buffer.data).catch(() => {})
      }

      this.writeBuffer.delete(bufferId)
    }, CONFIG.WRITE_FLUSH_INTERVAL)

    this.writeBuffer.get(bufferId).timeout = timeoutId
    return true
  }

  // ==================== DELETE SESSION ====================
  async deleteSession(sessionId) {
    logger.info(`🗑️ Delete: ${sessionId}`)
    
    this.sessionCache.delete(sessionId)
    this._clearBuffer(sessionId)

    await Promise.allSettled([
      this.fileManager.cleanupSessionFiles(sessionId),
      this.mongoStorage.isConnected && this.mongoStorage.deleteSession(sessionId),
      this.postgresStorage.isConnected && this.postgresStorage.deleteSession(sessionId),
    ].filter(Boolean))

    return true
  }

  async deleteSessionKeepUser(sessionId) {
    logger.info(`🗑️ Delete (keep user): ${sessionId}`)

    this.sessionCache.delete(sessionId)
    this._clearBuffer(sessionId)

    const session = await this.getSession(sessionId)
    const isWeb = session?.source === "web"
    // ✅ Delete makeinstore
  try {
    const { deleteFileStore } = await import("../whatsapp/index.js")
    await deleteFileStore(sessionId)
    logger.info(`✅ Deleted makeinstore for ${sessionId}`)
  } catch (error) {
    logger.error(`Failed to delete makeinstore for ${sessionId}: ${error.message}`)
  }

    const results = {
      file: await this.fileManager.cleanupSessionFiles(sessionId),
      mongo: { metadata: false, auth: false },
      postgres: false,
    }

    // MongoDB cleanup
    if (this.mongoStorage.isConnected) {
      const cleanup = await this.mongoStorage.completeCleanup(sessionId)
      results.mongo = cleanup
      logger.info(`✅ MongoDB: metadata=${cleanup.metadata}, auth=${cleanup.auth}`)
    }

    // PostgreSQL handling
    if (this.postgresStorage.isConnected) {
      const pgResult = await this.postgresStorage.deleteSessionKeepUser(sessionId)
      results.postgres = pgResult.updated || pgResult.deleted

      if (isWeb) {
        logger.info(`✅ PostgreSQL: Web ${pgResult.hadWebAuth ? "kept" : "deleted"}`)
      } else {
        logger.info(`✅ PostgreSQL: Telegram disconnected`)
      }
    }

    return results.file || results.mongo.metadata || results.postgres
  }

  async completelyDeleteSession(sessionId) {
  logger.info(`🗑️ COMPLETE delete: ${sessionId}`)

  this.sessionCache.delete(sessionId)
  this._clearBuffer(sessionId)

  const session = await this.getSession(sessionId)
  const isWeb = session?.source === "web"
  // ✅ CRITICAL: Delete makeinstore FIRST
  try {
    const { deleteFileStore } = await import("../whatsapp/index.js")
    await deleteFileStore(sessionId)
    logger.info(`✅ Deleted makeinstore for ${sessionId}`)
  } catch (error) {
    logger.error(`Failed to delete makeinstore for ${sessionId}: ${error.message}`)
  }

  // ✅ CRITICAL: Delete ALL files first (including metadata.json)
  await this.fileManager.cleanupSessionFiles(sessionId)
  logger.info(`✅ All session files deleted for ${sessionId}`)

  const ops = []

  // MongoDB cleanup
  if (this.mongoStorage.isConnected) {
    ops.push(this.mongoStorage.completeCleanup(sessionId))
  }

  // PostgreSQL handling
  if (this.postgresStorage.isConnected) {
    if (isWeb) {
      ops.push(
        this.postgresStorage.updateSession(sessionId, {
          isConnected: false,
          connectionStatus: "disconnected",
          updatedAt: new Date(),
        })
      )
      logger.info(`Web user ${sessionId} preserved in PostgreSQL`)
    } else {
      ops.push(this.postgresStorage.completelyDeleteSession(sessionId))
      logger.info(`Telegram user ${sessionId} deleted from PostgreSQL`)
    }
  }

  await Promise.allSettled(ops)
  logger.info(`✅ Complete deletion: ${sessionId}`)
  return true
}

  // ==================== GET ALL SESSIONS ====================
  async getAllSessions() {
    let sessions = []

    // PostgreSQL first (most reliable)
    if (this.postgresStorage.isConnected) {
      sessions = await this.postgresStorage.getAllSessions()
      if (sessions.length > 0) {
        return sessions.map(s => this._format(s))
      }
    }

    // Based on mode
    if (this.storageMode === "file") {
      sessions = await this.fileManager.getAllSessions()

      // Add web sessions from MongoDB
      if (this.mongoStorage.isConnected) {
        const webSessions = await this.mongoStorage.getAllSessions()
        const webOnly = webSessions.filter(s => s.source === "web")
        const fileIds = new Set(sessions.map(s => s.sessionId))
        
        for (const web of webOnly) {
          if (!fileIds.has(web.sessionId)) sessions.push(web)
        }
      }
    } else if (this.mongoStorage.isConnected) {
      sessions = await this.mongoStorage.getAllSessions()
    } else {
      sessions = await this.fileManager.getAllSessions()
    }

    return sessions.map(s => this._format(s))
  }

  // ==================== WEB SESSION DETECTION ====================
  async getUndetectedWebSessions() {
    if (!this.mongoStorage.isConnected) {
      logger.debug("MongoDB not connected - no web detection")
      return []
    }

    const sessions = await this.mongoStorage.getUndetectedWebSessions()
    return sessions.map(s => this._format(s))
  }

  async markSessionAsDetected(sessionId, detected = true) {
  logger.info(`${detected ? "✅" : "❌"} Detected=${detected}: ${sessionId}`)

  const update = {
    detected,
    detectedAt: detected ? new Date() : null,
  }
  // ✅ CRITICAL: Update MongoDB IMMEDIATELY (no buffering for detected flag)
  const ops = []
  if (this.mongoStorage.isConnected) {
    // Force immediate MongoDB update (bypass buffer)
    ops.push(this.mongoStorage.updateSession(sessionId, update))
  }
  if (this.storageMode === "file") {
    ops.push(this.fileManager.updateSession(sessionId, update))
  }
  // Wait for ALL updates to complete before returning
  await Promise.all(ops)
  // Update cache AFTER database is updated
  if (this.sessionCache.has(sessionId)) {
    Object.assign(this.sessionCache.get(sessionId), update)
  }

  logger.info(`✅ Detection status persisted to storage for ${sessionId}`)
  return true
}

  // ==================== ORPHAN CLEANUP ====================
  async cleanupOrphanedSessions() {
    return this.storageMode === "file" 
      ? await this._cleanupFileOrphans() 
      : await this._cleanupMongoOrphans()
  }

  async _cleanupFileOrphans() {
    logger.info("🧹 File orphan cleanup...")

    const sessions = await this.fileManager.getAllSessions()
    let cleaned = 0

    for (const session of sessions) {
      const age = Date.now() - new Date(session.createdAt || session.updatedAt).getTime()
      if (age < 180000) continue // 3 min grace

      const hasAuth = await this.fileManager.hasValidCredentials(session.sessionId)
      if (!hasAuth) {
        logger.warn(`🗑️ Orphan: ${session.sessionId}`)
        await this.fileManager.cleanupSessionFiles(session.sessionId)
        this.sessionCache.delete(session.sessionId)
        cleaned++
      }
    }

    logger.info(`✅ File orphans: ${cleaned} cleaned`)
    return { cleaned, errors: 0 }
  }

  async _cleanupMongoOrphans() {
    if (!this.mongoStorage.isConnected) return { cleaned: 0, errors: 0 }

    logger.info("🧹 MongoDB orphan cleanup...")

    const orphans = await this.mongoStorage.findOrphanedSessions()
    let cleaned = 0

    for (const sessionId of orphans) {
      try {
        const session = await this.mongoStorage.getSession(sessionId)
        const isWeb = session?.source === "web"

        await this.mongoStorage.completeCleanup(sessionId)
        await this.fileManager.cleanupSessionFiles(sessionId)

        if (this.postgresStorage.isConnected) {
          if (isWeb) {
            await this.postgresStorage.updateSession(sessionId, {
              isConnected: false,
              connectionStatus: "disconnected",
              updatedAt: new Date(),
            })
          } else {
            await this.postgresStorage.completelyDeleteSession(sessionId)
          }
        }

        this.sessionCache.delete(sessionId)
        cleaned++
      } catch (error) {
        logger.error(`Orphan cleanup failed ${sessionId}: ${error.message}`)
      }
    }

    logger.info(`✅ MongoDB orphans: ${cleaned} cleaned`)
    return { cleaned, errors: 0 }
  }

  // ==================== SYNC CHECKS ====================
  async checkWebSessionsWithoutMongoAuth() {
    if (!this.mongoStorage.isConnected) return { cleaned: 0 }

    try {
      const fs = await import("fs/promises")
      const entries = await fs.readdir(this.fileManager.sessionDir, { withFileTypes: true })
      const folders = entries.filter(e => e.isDirectory() && e.name.startsWith("session_"))
      
      let cleaned = 0

      for (const folder of folders) {
        const sessionId = folder.name

        if (!this.postgresStorage.isConnected) continue

        const pgSession = await this.postgresStorage.getSession(sessionId)
        if (pgSession?.source !== "web") continue

        const mongoSession = await this.mongoStorage.getSession(sessionId)
        const hasAuth = await this.mongoStorage.hasValidAuthData(sessionId)

        if (!mongoSession && !hasAuth) {
          logger.warn(`🧹 Web ${sessionId} deleted from MongoDB - cleaning files`)

          await this.fileManager.cleanupSessionFiles(sessionId)
          this.sessionCache.delete(sessionId)

          await this.postgresStorage.updateSession(sessionId, {
            isConnected: false,
            connectionStatus: "disconnected",
            updatedAt: new Date(),
          })

          cleaned++
        }
      }

      if (cleaned > 0) {
        logger.info(`✅ Cleaned ${cleaned} web sessions without MongoDB auth`)
      }

      return { cleaned }
    } catch (error) {
      logger.error("checkWebSessionsWithoutMongoAuth:", error.message)
      return { cleaned: 0 }
    }
  }

  async checkAndSyncDeletedSessions() {
    if (!this.mongoStorage.isConnected) return { synced: 0 }

    try {
      const fileSessions = await this.fileManager.getAllSessions()
      let synced = 0

      for (const fileSession of fileSessions) {
        if (fileSession.source !== "web") continue // Only web sessions

        const mongoSession = await this.mongoStorage.getSession(fileSession.sessionId)
        if (!mongoSession) {
          logger.warn(`🔄 Sync deletion: ${fileSession.sessionId}`)
          await this.fileManager.cleanupSessionFiles(fileSession.sessionId)
          this.sessionCache.delete(fileSession.sessionId)
          synced++
        }
      }

      if (synced > 0) logger.info(`✅ Synced ${synced} deleted web sessions`)
      return { synced }
    } catch (error) {
      logger.error("Sync deleted sessions:", error.message)
      return { synced: 0 }
    }
  }

  // ==================== HELPERS ====================
  _format(data) {
    if (!data) return null

    return {
      sessionId: data.sessionId,
      userId: data.userId || data.telegramId,
      telegramId: data.telegramId || data.userId,
      phoneNumber: data.phoneNumber,
      isConnected: Boolean(data.isConnected),
      connectionStatus: data.connectionStatus || "disconnected",
      reconnectAttempts: data.reconnectAttempts || 0,
      source: data.source || "telegram",
      detected: data.detected !== false,
      detectedAt: data.detectedAt,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    }
  }

  _clearBuffer(sessionId) {
    const bufferId = `${sessionId}_update`
    const buffer = this.writeBuffer.get(bufferId)
    if (buffer?.timeout) clearTimeout(buffer.timeout)
    this.writeBuffer.delete(bufferId)
  }

  _getEncryptionKey() {
    const key = process.env.SESSION_ENCRYPTION_KEY || "default-key-change-in-production"
    return crypto.createHash("sha256").update(key).digest()
  }

  // ==================== BACKGROUND TASKS ====================
  _startHealthCheck() {
    this.timers.health = setInterval(() => {
      logger.debug("Health:", {
        mongodb: this.mongoStorage.isConnected,
        postgresql: this.postgresStorage.isConnected,
        mode: this.storageMode,
      })
    }, 60000)
  }

  _startOrphanCleanup() {
    this.timers.orphan = setInterval(async () => {
      await this.cleanupOrphanedSessions().catch(() => {})
      await this.checkAndSyncDeletedSessions().catch(() => {})
      await this.checkWebSessionsWithoutMongoAuth().catch(() => {})
    }, CONFIG.ORPHAN_CLEANUP_INTERVAL)

    // Initial cleanup after 2 min
    setTimeout(async () => {
      await this.cleanupOrphanedSessions().catch(() => {})
      await this.checkAndSyncDeletedSessions().catch(() => {})
      await this.checkWebSessionsWithoutMongoAuth().catch(() => {})
    }, 120000)

    this._startPreKeyCleanup()
    this._startSessionBackup()
  }

  _startPreKeyCleanup() {
    this.timers.prekey = setInterval(async () => {
      try {
        logger.info("🧹 Pre-key cleanup...")

        if (this.mongoStorage.isConnected) {
          const mongoResult = await this.mongoStorage.cleanupAllPreKeys(500, 300)
          if (mongoResult.deleted > 0) {
            logger.info(`✅ MongoDB pre-keys: ${mongoResult.deleted}`)
          }
        }

        const { cleanupAllSessionPreKeys } = await import("./auth-state.js")
        const fileResult = await cleanupAllSessionPreKeys(this.fileManager.sessionDir)
        if (fileResult.deleted > 0) {
          logger.info(`✅ File pre-keys: ${fileResult.deleted}`)
        }
      } catch (error) {
        logger.error("Pre-key cleanup:", error.message)
      }
    }, CONFIG.PREKEY_CLEANUP_INTERVAL)

    // Initial cleanup after 5 min
    setTimeout(async () => {
      try {
        if (this.mongoStorage.isConnected) {
          await this.mongoStorage.cleanupAllPreKeys(500, 300)
        }
        const { cleanupAllSessionPreKeys } = await import("./auth-state.js")
        await cleanupAllSessionPreKeys(this.fileManager.sessionDir)
      } catch (error) {
        logger.debug("Initial pre-key cleanup:", error.message)
      }
    }, 300000)
  }

  _startSessionBackup() {
    if (this.storageMode !== "file" || !this.mongoStorage.isConnected) {
      return
    }

    const scheduleBackup = () => {
      const jitter = Math.random() * CONFIG.BACKUP_JITTER_MAX
      this.timers.backup = setTimeout(async () => {
        await this._performBulkBackup()
        scheduleBackup()
      }, CONFIG.BACKUP_INTERVAL + jitter)
    }

    // Initial backup after 1 hour
    setTimeout(async () => {
      await this._performBulkBackup()
      scheduleBackup()
    }, 3600000)
  }

  async _performBulkBackup() {
    if (!this.mongoStorage.isConnected) return

    try {
      logger.info("📦 Bulk backup to MongoDB (batched)...")

      const fs = await import("fs/promises")
      const path = await import("path")

      const entries = await fs.readdir(this.fileManager.sessionDir, { withFileTypes: true })
      const folders = entries.filter(e => e.isDirectory() && e.name.startsWith("session_"))

      let totalBacked = 0
      let sessionsProcessed = 0
      const fileQueue = []

      for (const folder of folders) {
        const sessionId = folder.name
        const sessionPath = path.join(this.fileManager.sessionDir, sessionId)

        try {
          const files = await fs.readdir(sessionPath)
          const toBackup = files.filter(f => 
            f.endsWith(".json") && !/^pre[-_]?key/i.test(f)
          )

          for (const fileName of toBackup) {
            fileQueue.push({
              sessionId,
              fileName,
              filePath: path.join(sessionPath, fileName),
            })
          }

          // Backup metadata
          try {
            const metadataPath = path.join(sessionPath, "metadata.json")
            const content = await fs.readFile(metadataPath, "utf8")
            if (content) {
              const metadata = JSON.parse(content)
              await this.mongoStorage.saveSession(sessionId, metadata)
            }
          } catch {}

          sessionsProcessed++
        } catch {}
      }

      logger.info(`📦 Processing ${fileQueue.length} files...`)

      for (let i = 0; i < fileQueue.length; i += CONFIG.BATCH_SIZE) {
        const batch = fileQueue.slice(i, i + CONFIG.BATCH_SIZE)
        
        const promises = batch.map(async ({ sessionId, fileName, filePath }) => {
          try {
            const content = await fs.readFile(filePath, "utf8")
            if (content?.trim()) {
              return await this.mongoStorage.writeAuthData(sessionId, fileName, content)
            }
          } catch {}
          return false
        })

        const results = await Promise.all(promises)
        totalBacked += results.filter(Boolean).length

        if (i + CONFIG.BATCH_SIZE < fileQueue.length) {
          await new Promise(r => setTimeout(r, CONFIG.BATCH_DELAY))
        }
      }

      logger.info(`✅ Backup: ${totalBacked} files from ${sessionsProcessed} sessions`)
    } catch (error) {
      logger.error("Bulk backup:", error.message)
    }
  }

  _startCacheCleanup() {
    this.timers.cache = setInterval(() => {
      const now = Date.now()
      for (const [key, value] of this.sessionCache.entries()) {
        if (value.lastCached && now - value.lastCached > CONFIG.CACHE_TTL) {
          this.sessionCache.delete(key)
        }
      }
    }, 15000)
  }

  // ==================== CLEANUP ====================
  async flushWriteBuffers() {
    for (const [bufferId, buffer] of this.writeBuffer.entries()) {
      if (buffer?.timeout) clearTimeout(buffer.timeout)
      this.writeBuffer.delete(bufferId)
    }
  }

  async close() {
    Object.values(this.timers).forEach(timer => {
      if (timer) clearInterval(timer)
    })

    await this.flushWriteBuffers()
    this.sessionCache.clear()

    await Promise.allSettled([
      this.mongoStorage.close(),
      this.postgresStorage.close(),
    ])
  }

  // ==================== STATUS ====================
  getConnectionStatus() {
    return {
      mode: this.storageMode,
      mongodb: this.mongoStorage.isConnected,
      postgresql: this.postgresStorage.isConnected,
      fileManager: true,
      cacheSize: this.sessionCache.size,
      bufferSize: this.writeBuffer.size,
    }
  }

  getStats() {
    return {
      mode: this.storageMode,
      connections: {
        mongodb: this.mongoStorage.isConnected,
        postgresql: this.postgresStorage.isConnected,
      },
      cache: {
        size: this.sessionCache.size,
        maxSize: CONFIG.CACHE_MAX_SIZE,
      },
      writeBuffer: {
        size: this.writeBuffer.size,
      },
    }
  }
}

// ==================== SINGLETON ====================
let storageInstance = null

export function initializeStorage() {
  if (!storageInstance) {
    storageInstance = new SessionStorage()
  }
  return storageInstance
}

export function getSessionStorage() {
  if (!storageInstance) {
    storageInstance = new SessionStorage()
  }
  return storageInstance
}