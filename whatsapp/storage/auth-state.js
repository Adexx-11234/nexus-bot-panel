// ============================================================================
// auth-state.js - Auth Sync Between MongoDB & File Storage
// ============================================================================

import { WAProto as proto, initAuthCreds } from "@nexustechpro/baileys"
import { createComponentLogger } from "../../utils/logger.js"
import fs from "fs/promises"
import path from "path"

const logger = createComponentLogger("AUTH_STATE")
const globalCollectionRefs = new Map()
const preKeyDebounceTimers = new Map() // sessionId -> Map<fileName, timer>

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  MONGODB_TIMEOUT: 5000,
  MIGRATION_DELAY: 15000,
  BACKUP_INTERVAL: 4 * 60 * 60 * 1000,
  PREKEY_CLEANUP_INTERVAL: 10 * 60 * 1000,
  PREKEY_MAX: 500,
  PREKEY_THRESHOLD: 30,
  PREKEY_WRITE_DEBOUNCE: 100,
}

// ============================================================================
// BUFFER SERIALIZATION
// ============================================================================

const BufferJSON = {
  replacer: (k, value) => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === "Buffer") {
      return { type: "Buffer", data: Buffer.from(value?.data || value).toString("base64") }
    }
    return value
  },
  reviver: (_, value) => {
    if (typeof value === "object" && value && (value.buffer === true || value.type === "Buffer")) {
      const val = value.data || value.value
      return typeof val === "string" ? Buffer.from(val, "base64") : Buffer.from(val || [])
    }
    return value
  },
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const getStorageMode = () => (process.env.STORAGE_MODE || "mongodb").toLowerCase()
const isMongoDBMode = () => getStorageMode() === "mongodb"
const isFileMode = () => getStorageMode() === "file"

const sanitizeFileName = (name) => name?.replace(/::/g, "__").replace(/:/g, "-").replace(/[/\\]/g, "_")

const isPreKeyFile = (name) => /^pre[-_]?key/i.test(name)
const extractPreKeyId = (name) => Number.parseInt(name.match(/pre-?key-?(\d+)/i)?.[1] || "0", 10)

// ============================================================================
// FILE STORAGE CLASS
// ============================================================================

class FileStorage {
  constructor(sessionId, baseDir = "./sessions") {
    this.sessionId = sessionId
    this.dir = path.join(baseDir, sessionId)
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true })
  }

  async read(fileName) {
    try {
      const filePath = path.join(this.dir, sanitizeFileName(fileName))
      const content = await fs.readFile(filePath, "utf8")
      return content ? JSON.parse(content, BufferJSON.reviver) : null
    } catch {
      return null
    }
  }

  async write(fileName, data) {
    try {
      const filePath = path.join(this.dir, sanitizeFileName(fileName))
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, JSON.stringify(data, BufferJSON.replacer, 2), "utf8")
      return true
    } catch (error) {
      logger.error(`[${this.sessionId}] Write failed ${fileName}: ${error.message}`)
      return false
    }
  }

  async delete(fileName) {
    try {
      await fs.unlink(path.join(this.dir, sanitizeFileName(fileName)))
      return true
    } catch {
      return false
    }
  }

  async cleanup() {
    try {
      await fs.rm(this.dir, { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  }

  async listFiles(filterFn = null) {
    try {
      const files = await fs.readdir(this.dir)
      const jsonFiles = files.filter((f) => f.endsWith(".json"))
      return filterFn ? jsonFiles.filter(filterFn) : jsonFiles
    } catch {
      return []
    }
  }

  async cleanupPreKeys() {
    try {
      const preKeys = await this.listFiles(isPreKeyFile)

      if (preKeys.length <= CONFIG.PREKEY_THRESHOLD) {
        return { deleted: 0, total: preKeys.length }
      }

      preKeys.sort((a, b) => extractPreKeyId(a) - extractPreKeyId(b))
      const toDelete = preKeys.slice(0, Math.max(0, preKeys.length - CONFIG.PREKEY_MAX))

      let deleted = 0
      for (const file of toDelete) {
        if (await this.delete(file)) deleted++
      }

      logger.info(`[${this.sessionId}] Cleaned ${deleted}/${toDelete.length} pre-keys`)
      return { deleted, total: preKeys.length }
    } catch (error) {
      return { deleted: 0, error: error.message }
    }
  }
}

// ============================================================================
// MONGODB STORAGE CLASS
// ============================================================================

class MongoStorage {
  constructor(mongoStorage, sessionId) {
    this.mongo = mongoStorage
    this.sessionId = sessionId
    this.healthy = !!mongoStorage?.isConnected
    this.failures = 0
    this.consecutiveFailures = 0
    this.lastSuccessTime = Date.now()
  }

  async safeOp(operation, fallback = null) {
    if (!this.mongo?.isConnected || !this.mongo?.authBaileys) {
      return fallback
    }

    if (this.consecutiveFailures >= 5) {
      const timeSinceLastSuccess = Date.now() - this.lastSuccessTime
      if (timeSinceLastSuccess > 30000) {
        this.consecutiveFailures = 0
      } else {
        return fallback
      }
    }

    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), CONFIG.MONGODB_TIMEOUT))
      const result = await Promise.race([operation(), timeout])
      this.failures = 0
      this.consecutiveFailures = 0
      this.lastSuccessTime = Date.now()
      return result
    } catch (error) {
      this.failures++
      this.consecutiveFailures++
      this.healthy = this.failures < 3

      if (error.message?.includes("Client must be connected") || error.message?.includes("connection pool")) {
        logger.warn(`[${this.sessionId}] MongoDB connection lost during operation`)
      }

      return fallback
    }
  }

  async read(fileName) {
    return this.safeOp(async () => {
      const data = await this.mongo.readAuthData(this.sessionId, fileName)
      return data ? JSON.parse(data, BufferJSON.reviver) : null
    })
  }

  async write(fileName, data) {
    const json = JSON.stringify(data, BufferJSON.replacer)
    return this.safeOp(() => this.mongo.writeAuthData(this.sessionId, fileName, json), false)
  }

  async delete(fileName) {
    return this.safeOp(() => this.mongo.deleteAuthData(this.sessionId, fileName), false)
  }

  async cleanup() {
    return this.safeOp(() => this.mongo.deleteAuthState(this.sessionId), false)
  }

  async listFiles() {
    return this.safeOp(() => this.mongo.getAllAuthFiles(this.sessionId), [])
  }

  async cleanupPreKeys() {
    return this.safeOp(
      async () => {
        const files = await this.mongo.getAllAuthFiles(this.sessionId)
        const preKeys = files.filter(isPreKeyFile)

        if (preKeys.length <= CONFIG.PREKEY_THRESHOLD) {
          return { deleted: 0, total: preKeys.length }
        }

        preKeys.sort((a, b) => extractPreKeyId(a) - extractPreKeyId(b))
        const toDelete = preKeys.slice(0, Math.max(0, preKeys.length - CONFIG.PREKEY_MAX))

        let deleted = 0
        for (const file of toDelete) {
          if (await this.mongo.deleteAuthData(this.sessionId, file)) deleted++
        }

        logger.info(`[${this.sessionId}] MongoDB cleaned ${deleted}/${toDelete.length} pre-keys`)
        return { deleted, total: preKeys.length }
      },
      { deleted: 0 },
    )
  }
}

// ============================================================================
// CREDENTIAL VALIDATION
// ============================================================================

const isFullyInitialized = (creds) =>
  !!(creds?.noiseKey && creds?.signedIdentityKey && creds?.me && creds?.account && creds?.registered === true)

const hasBasicKeys = (creds) => !!(creds?.noiseKey && creds?.signedIdentityKey)

const validateCredsForWrite = (creds, sessionId) => {
  const missing = []

  if (!creds?.noiseKey) missing.push("noiseKey")
  if (!creds?.signedIdentityKey) missing.push("signedIdentityKey")
  if (!creds?.me) missing.push("me")
  if (!creds?.account) missing.push("account")
  if (creds?.registered !== true) missing.push("registered")

  if (missing.length > 0) {
    logger.error(`[${sessionId}] ❌ INVALID creds.json write - Missing: ${missing.join(", ")}`)
    return false
  }

  return true
}

// ============================================================================
// STORAGE SELECTION LOGIC
// ============================================================================

const determineStorage = async (mode, mongoStore, fileStore, isPairing) => {
  if (mode === "file") {
    return { primary: "file", migrate: false }
  }

  const mongoCreds = mongoStore ? await mongoStore.read("creds.json") : null
  const fileCreds = await fileStore.read("creds.json")

  if (hasBasicKeys(mongoCreds)) {
    return { primary: "mongodb", migrate: false }
  }

  if (hasBasicKeys(fileCreds)) {
    return { primary: "file", migrate: !!mongoStore }
  }

  if (isPairing && mongoStore) {
    return { primary: "mongodb", migrate: false }
  }

  return { primary: "mongodb", migrate: false }
}

// ============================================================================
// MAIN AUTH STATE FUNCTION
// ============================================================================

export const useMongoDBAuthState = async (mongoStorage, sessionId, isPairing = false, source = "telegram") => {
  if (!sessionId?.startsWith("session_")) {
    throw new Error(`Invalid sessionId: ${sessionId}`)
  }

  const mode = getStorageMode()
  logger.info(`[${sessionId}] Auth: ${mode.toUpperCase()} | Source: ${source} | Pairing: ${isPairing}`)

  const fileStore = new FileStorage(sessionId)
  await fileStore.init()

  const mongoStore =
    (mode === "mongodb" || source === "web") && mongoStorage?.isConnected
      ? new MongoStorage(mongoStorage, sessionId)
      : null

  if (mongoStore) {
    globalCollectionRefs.set(sessionId, mongoStorage)
  }

  const { primary, migrate } = await determineStorage(mode, mongoStore, fileStore, isPairing)

  if (migrate) {
    logger.info(`[${sessionId}] Will migrate to MongoDB in ${CONFIG.MIGRATION_DELAY / 1000}s`)
  }

  const credsCheckDone = false

  // ============================================================================
  // READ OPERATION
  // ============================================================================

  const readData = async (fileName) => {
    if (primary === "mongodb" && mongoStore) {
      const data = await mongoStore.read(fileName)
      if (data) return data
    }
    return fileStore.read(fileName)
  }

  // ============================================================================
  // WRITE OPERATION
  // ============================================================================

  const writeData = async (data, fileName) => {
    await fs.mkdir(fileStore.dir, { recursive: true }).catch(() => {})

    if (fileName === "creds.json") {
      if (!validateCredsForWrite(data, sessionId)) {
        logger.error(`[${sessionId}] 🚫 BLOCKED incomplete creds.json write`)
        return false
      }

      logger.info(`[${sessionId}] ✅ Force writing validated creds.json`)

      const isMongoMode = mode === "mongodb"
      const useMongo = (primary === "mongodb" && mongoStore) || (isMongoMode && mongoStore && isPairing)

      const fileSuccess = await fileStore.write(fileName, data)

      if (useMongo) {
        await mongoStore.write(fileName, data).catch((err) => {
          logger.error(`[${sessionId}] MongoDB write failed: ${err.message}`)
        })
      }

      logger.info(`[${sessionId}] ✅ creds.json written successfully (file: ${fileSuccess}, mongo: ${useMongo})`)
      return fileSuccess
    }

    const isMongoMode = mode === "mongodb"
    const useMongo = (primary === "mongodb" && mongoStore) || (isMongoMode && mongoStore && isPairing)
    const isPreKey = isPreKeyFile(fileName)

    if (isPairing) {
      if (isPreKey) {
        fileStore.write(fileName, data).catch(() => {})
        if (useMongo) mongoStore.write(fileName, data).catch(() => {})
        return true
      }

      const fileSuccess = await fileStore.write(fileName, data)
      if (useMongo) mongoStore.write(fileName, data).catch(() => {})
      return fileSuccess
    }

    if (isPreKey) {
      if (useMongo) mongoStore.write(fileName, data).catch(() => {})
      fileStore.write(fileName, data).catch(() => {})
      return true
    }

    if (useMongo) {
      const success = await mongoStore.write(fileName, data)
      fileStore.write(fileName, data).catch(() => {})
      return success
    }

    const success = await fileStore.write(fileName, data)
    if (isMongoMode && mongoStore) {
      mongoStore.write(fileName, data).catch(() => {})
    }
    return success
  }

  // ============================================================================
  // DELETE OPERATION
  // ============================================================================

  const removeData = async (fileName) => {
    const ops = [fileStore.delete(fileName)]
    if (mongoStore) ops.push(mongoStore.delete(fileName))
    await Promise.all(ops)
  }

  // ============================================================================
  // LOAD OR CREATE CREDENTIALS
  // ============================================================================

  const existing = await readData("creds.json")
  const creds = hasBasicKeys(existing) ? existing : initAuthCreds()
  const isNew = !existing

  if (isNew) {
    logger.info(`[${sessionId}] Creating new credentials`)
    await writeData(creds, "creds.json")
  } else {
    logger.info(`[${sessionId}] Loaded credentials from ${primary}`)
  }

  if (mode === "mongodb" && mongoStore && primary === "mongodb" && !isNew) {
    const mongoCreds = await mongoStore.read("creds.json")
    if (hasBasicKeys(mongoCreds)) {
      const syncSuccess = await fileStore.write("creds.json", mongoCreds)
      if (syncSuccess) {
        logger.info(`[${sessionId}] Synced creds.json from MongoDB to file`)
      }
    }
  }

  // ============================================================================
  // MIGRATION TIMER
  // ============================================================================

  let migrationTimer = null

  if (migrate && mongoStore && !isNew) {
    migrationTimer = setTimeout(async () => {
      try {
        logger.info(`[${sessionId}] Starting migration...`)

        const files = await fileStore.listFiles()
        if (!files.length) return

        let migrated = 0
        for (const file of files) {
          const data = await fileStore.read(file)
          if (data && (await mongoStore.write(file, data))) {
            migrated++
          }
          await new Promise((r) => setTimeout(r, 50))
        }

        if (migrated / files.length >= 0.95) {
          logger.info(`[${sessionId}] Migration complete: ${migrated}/${files.length}`)
        }
      } catch (error) {
        logger.error(`[${sessionId}] Migration error: ${error.message}`)
      }
    }, CONFIG.MIGRATION_DELAY)
  }

  // ============================================================================
  // BACKUP TIMER (FILE MODE ONLY)
  // ============================================================================

  let backupTimer = null

  if (mode === "file" && mongoStore && !isNew) {
    const backup = async () => {
      try {
        const files = await fileStore.listFiles((f) => !isPreKeyFile(f))
        let backed = 0

        for (const file of files) {
          const data = await fileStore.read(file)
          if (data && (await mongoStore.write(file, data))) backed++
        }

        logger.info(`[${sessionId}] Backup: ${backed}/${files.length}`)
      } catch (error) {
        logger.error(`[${sessionId}] Backup failed: ${error.message}`)
      }
    }

    setTimeout(
      () => {
        backup()
        backupTimer = setInterval(backup, CONFIG.BACKUP_INTERVAL)
      },
      60 * 60 * 1000,
    )
  }

  // ============================================================================
  // PRE-KEY CLEANUP TIMER
  // ============================================================================

  let cleanupTimer = null

  setTimeout(
    () => {
      cleanupTimer = setInterval(async () => {
        try {
          await fileStore.cleanupPreKeys()
          if (mongoStore) await mongoStore.cleanupPreKeys()
        } catch (error) {
          logger.error(`[${sessionId}] Cleanup error: ${error.message}`)
        }
      }, CONFIG.PREKEY_CLEANUP_INTERVAL)
    },
    2 * 60 * 1000,
  )

  // ============================================================================
  // RETURN AUTH STATE OBJECT
  // ============================================================================

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {}
          for (const id of ids) {
            const fileName = `${type}-${id}.json`
            let value = await readData(fileName)

            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value)
            }

            if (value) data[id] = value
          }
          return data
        },
        set: async (data) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const file = `${category}-${id}.json`
              if (value) {
                debouncePreKeyWrite(sessionId, file, async () => {
                  await writeData(value, file)
                })
              } else {
                await removeData(file)
              }
            }
          }
        },
      },
    },
    saveCreds: () => writeData(creds, "creds.json"),
    cleanup: async () => {
      if (migrationTimer) clearTimeout(migrationTimer)
      if (backupTimer) clearInterval(backupTimer)
      if (cleanupTimer) clearInterval(cleanupTimer)

      const ops = [fileStore.cleanup()]
      if (mongoStore) ops.push(mongoStore.cleanup())

      await Promise.allSettled(ops)
      globalCollectionRefs.delete(sessionId)
      preKeyDebounceTimers.delete(sessionId)

      logger.info(`[${sessionId}] Cleanup complete`)
    },
  }
}

// ============================================================================
// EXPORTED UTILITY FUNCTIONS
// ============================================================================

export const cleanupSessionAuthData = async (mongoStorage, sessionId) => {
  try {
    const ops = []

    if (isMongoDBMode() && mongoStorage?.isConnected) {
      ops.push(mongoStorage.deleteAuthState(sessionId).catch(() => false))
    }

    const fileStore = new FileStorage(sessionId)
    await fileStore.init()
    ops.push(fileStore.cleanup())

    const results = await Promise.allSettled(ops)
    globalCollectionRefs.delete(sessionId)
    preKeyDebounceTimers.delete(sessionId)

    return results.some((r) => r.status === "fulfilled" && r.value)
  } catch (error) {
    logger.error(`[${sessionId}] Cleanup failed: ${error.message}`)
    return false
  }
}

export const hasValidAuthData = async (mongoStorage, sessionId) => {
  try {
    const fileStore = new FileStorage(sessionId)
    await fileStore.init()

    const fileCreds = await fileStore.read("creds.json")
    if (hasBasicKeys(fileCreds)) return true

    if (isMongoDBMode() && mongoStorage?.isConnected) {
      return await mongoStorage.hasValidAuthData(sessionId)
    }

    return false
  } catch {
    return false
  }
}

export const checkAuthAvailability = async (mongoStorage, sessionId) => {
  const fileStore = new FileStorage(sessionId)
  await fileStore.init()

  const hasFile = (await fileStore.read("creds.json")) !== null
  let hasMongo = false

  if (isMongoDBMode() && mongoStorage?.isConnected) {
    hasMongo = await mongoStorage.hasValidAuthData(sessionId)
  }

  return {
    hasFile,
    hasMongo,
    hasAuth: hasFile || hasMongo,
    preferred: isFileMode() ? (hasFile ? "file" : "none") : hasMongo ? "mongodb" : hasFile ? "file" : "none",
  }
}

export const getAuthStorageStats = () => ({
  storageMode: getStorageMode(),
  isMongoDBMode: isMongoDBMode(),
  isFileMode: isFileMode(),
  migrationDelay: `${CONFIG.MIGRATION_DELAY / 1000}s`,
  backupInterval: `${CONFIG.BACKUP_INTERVAL / 3600000}h`,
  preKeyCleanupInterval: `${CONFIG.PREKEY_CLEANUP_INTERVAL / 60000}min`,
  preKeyMaxCount: CONFIG.PREKEY_MAX,
  preKeyCleanupThreshold: CONFIG.PREKEY_THRESHOLD,
  activeCollectionRefs: globalCollectionRefs.size,
})

export const cleanupAllSessionPreKeys = async (sessionsDir = "./sessions") => {
  try {
    const entries = await fs.readdir(sessionsDir, { withFileTypes: true })
    const sessionFolders = entries.filter((e) => e.isDirectory() && e.name.startsWith("session_"))

    let totalDeleted = 0

    for (const folder of sessionFolders) {
      const fileStore = new FileStorage(folder.name, sessionsDir.replace("/" + folder.name, ""))
      await fileStore.init()

      const result = await fileStore.cleanupPreKeys()
      totalDeleted += result.deleted || 0
    }

    logger.info(`Global cleanup: ${totalDeleted} pre-keys deleted across ${sessionFolders.length} sessions`)
    return { deleted: totalDeleted, sessions: sessionFolders.length }
  } catch (error) {
    logger.error(`Global cleanup failed: ${error.message}`)
    return { deleted: 0, error: error.message }
  }
}

const debouncePreKeyWrite = (sessionId, fileName, writeFn) => {
  if (!preKeyDebounceTimers.has(sessionId)) {
    preKeyDebounceTimers.set(sessionId, new Map())
  }

  const sessionTimers = preKeyDebounceTimers.get(sessionId)

  if (sessionTimers.has(fileName)) {
    clearTimeout(sessionTimers.get(fileName))
  }

  sessionTimers.set(
    fileName,
    setTimeout(async () => {
      sessionTimers.delete(fileName)
      try {
        await writeFn()
      } catch (error) {}
    }, CONFIG.PREKEY_WRITE_DEBOUNCE),
  )

  return true
}
