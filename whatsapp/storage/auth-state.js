// ============================================================================
// auth-state.js - FIXED: Auth Sync Between MongoDB & Files
// ============================================================================

import { WAProto as proto, initAuthCreds } from "@whiskeysockets/baileys"
import { createComponentLogger } from "../../utils/logger.js"
import fs from "fs/promises"
import path from "path"

const logger = createComponentLogger("AUTH_STATE")

// ✅ Global collection references to prevent garbage collection
const globalCollectionRefs = new Map()

// ==================== CONFIGURATION ====================
const CONFIG = {
  MONGODB_OPERATION_TIMEOUT: 5000,
  MIGRATION_DELAY: 15000, // 15 seconds before migrating file → MongoDB
}

// ==================== SERIALIZATION ====================
const BufferJSON = {
  replacer: (k, value) => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === "Buffer") {
      return { type: "Buffer", data: Buffer.from(value?.data || value).toString("base64") }
    }
    return value
  },
  reviver: (_, value) => {
    if (typeof value === "object" && !!value && (value.buffer === true || value.type === "Buffer")) {
      const val = value.data || value.value
      return typeof val === "string" ? Buffer.from(val, "base64") : Buffer.from(val || [])
    }
    return value
  },
}

// ==================== STORAGE MODE ====================
const getStorageMode = () => (process.env.STORAGE_MODE || 'mongodb').toLowerCase()
const isMongoDBMode = () => getStorageMode() === 'mongodb'
const isFileMode = () => getStorageMode() === 'file'

// ==================== FILENAME SANITIZATION ====================
const sanitizeFileName = (fileName) => {
  if (!fileName) return fileName
  return fileName
    .replace(/::/g, '__')
    .replace(/:/g, '-')
    .replace(/\//g, '_')
    .replace(/\\/g, '_')
}

// ==================== FILE STORAGE MANAGER ====================
class FileStorageManager {
  constructor(sessionId, sessionDir = "./sessions") {
    this.sessionId = sessionId
    this.sessionDir = path.join(sessionDir, sessionId)
    this.initialized = false
  }

  async init() {
    try {
      await fs.mkdir(this.sessionDir, { recursive: true })
      this.initialized = true
      logger.debug(`[${this.sessionId}] 📁 File auth storage ready`)
    } catch (error) {
      logger.error(`[${this.sessionId}] Failed to init file storage:`, error.message)
      throw error
    }
  }

  async readFile(fileName) {
    if (!this.initialized) throw new Error('File storage not initialized')

    try {
      const sanitizedName = sanitizeFileName(fileName)
      const filePath = path.join(this.sessionDir, sanitizedName)
      
      try {
        await fs.access(filePath)
      } catch (error) {
        return null
      }
      
      const content = await fs.readFile(filePath, "utf8")
      
      if (!content || content.trim() === '') {
        return null
      }
      
      return JSON.parse(content, BufferJSON.reviver)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.debug(`[${this.sessionId}] Read ${fileName} error:`, error.message)
      }
      return null
    }
  }

  async writeFile(fileName, data) {
    if (!this.initialized) throw new Error('File storage not initialized')

    try {
      await fs.mkdir(this.sessionDir, { recursive: true })
      
      const sanitizedName = sanitizeFileName(fileName)
      const filePath = path.join(this.sessionDir, sanitizedName)
      const fileDir = path.dirname(filePath)
      
      await fs.mkdir(fileDir, { recursive: true })
      
      await fs.writeFile(filePath, JSON.stringify(data, BufferJSON.replacer, 2), "utf8")
      return true
    } catch (error) {
      logger.error(`[${this.sessionId}] Write ${fileName} error:`, error.message)
      return false
    }
  }

  async deleteFile(fileName) {
    if (!this.initialized) return false

    try {
      const sanitizedName = sanitizeFileName(fileName)
      const filePath = path.join(this.sessionDir, sanitizedName)
      await fs.unlink(filePath)
      return true
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.debug(`[${this.sessionId}] Delete ${fileName} error:`, error.message)
      }
      return false
    }
  }

  async cleanup() {
    try {
      await fs.rm(this.sessionDir, { recursive: true, force: true })
      logger.info(`[${this.sessionId}] 🗑️ File auth storage cleaned`)
      return true
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error(`[${this.sessionId}] File cleanup error:`, error.message)
      }
      return false
    }
  }

  async getAllFiles() {
    if (!this.initialized) return []

    try {
      const files = await fs.readdir(this.sessionDir)
      const authFiles = files.filter(f => f.endsWith('.json'))
      
      if (authFiles.length > 0) {
        logger.debug(`[${this.sessionId}] Found ${authFiles.length} auth files`)
      }
      
      return authFiles
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error(`[${this.sessionId}] Failed to list files:`, error.message)
      }
      return []
    }
  }
}

// ==================== MONGODB STORAGE MANAGER ====================
class MongoDBStorageManager {
  constructor(mongoStorage, sessionId) {
    this.mongoStorage = mongoStorage
    this.sessionId = sessionId
    this.isHealthy = true
    this.consecutiveFailures = 0
    this.maxFailures = 3
    
    if (!mongoStorage) {
      logger.error(`[${sessionId}] MongoDBStorageManager created with NULL storage!`)
      this.isHealthy = false
    } else {
      logger.debug(`[${sessionId}] MongoDB storage manager created`)
    }
  }

  _checkHealth() {
    return this.mongoStorage?.isConnected && this.mongoStorage?.authBaileys
  }

  _recordResult(success) {
    if (success) {
      this.consecutiveFailures = 0
      this.isHealthy = true
    } else {
      this.consecutiveFailures++
      if (this.consecutiveFailures >= this.maxFailures) {
        this.isHealthy = false
      }
    }
  }

  async _safeOperation(operationName, operation, fallbackValue = null) {
    if (!this._checkHealth()) {
      logger.debug(`[${this.sessionId}] MongoDB not healthy for ${operationName}`)
      return fallbackValue
    }

    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), CONFIG.MONGODB_OPERATION_TIMEOUT)
      )

      const result = await Promise.race([operation(), timeoutPromise])
      this._recordResult(true)
      return result
    } catch (error) {
      this._recordResult(false)
      if (error.message === 'timeout') {
        logger.debug(`[${this.sessionId}] MongoDB ${operationName}: timeout`)
      } else {
        logger.error(`[${this.sessionId}] MongoDB ${operationName}: ${error.message}`)
      }
      return fallbackValue
    }
  }

  async readData(fileName) {
    return await this._safeOperation(
      `read(${fileName})`,
      async () => {
        const dataStr = await this.mongoStorage.readAuthData(this.sessionId, fileName)
        if (dataStr) {
          return JSON.parse(dataStr, BufferJSON.reviver)
        }
        return null
      },
      null
    )
  }

  async writeData(fileName, data) {
    const dataStr = JSON.stringify(data, BufferJSON.replacer)
    
    const result = await this._safeOperation(
      `write(${fileName})`,
      async () => {
        return await this.mongoStorage.writeAuthData(this.sessionId, fileName, dataStr)
      },
      false
    )

    return result
  }

  async deleteData(fileName) {
    return await this._safeOperation(
      `delete(${fileName})`,
      async () => {
        return await this.mongoStorage.deleteAuthData(this.sessionId, fileName)
      },
      false
    )
  }

  async cleanup() {
    return await this._safeOperation(
      'cleanup',
      async () => {
        return await this.mongoStorage.deleteAuthState(this.sessionId)
      },
      false
    )
  }

  async getAllFiles() {
    return await this._safeOperation(
      'getAllFiles',
      async () => {
        return await this.mongoStorage.getAllAuthFiles(this.sessionId)
      },
      []
    )
  }
}

// ==================== MAIN AUTH STATE FUNCTION ====================
export const useMongoDBAuthState = async (mongoStorage, sessionId, isPairing = false, source = 'telegram') => {
  if (!sessionId?.startsWith("session_")) {
    throw new Error(`Invalid sessionId: ${sessionId}`)
  }

  const storageMode = getStorageMode()
  const isWebSession = source === 'web'
  
  logger.info(`[${sessionId}] 🔐 Auth mode: ${storageMode.toUpperCase()} | Source: ${source}`)

  // Initialize file storage (always needed)
  const fileStorage = new FileStorageManager(sessionId)
  await fileStorage.init()

  // Initialize MongoDB storage if available
  let mongoStore = null
  
  if ((storageMode === 'mongodb' || isWebSession) && mongoStorage?.isConnected) {
    mongoStore = new MongoDBStorageManager(mongoStorage, sessionId)
    globalCollectionRefs.set(sessionId, mongoStorage)
    logger.info(`[${sessionId}] ✅ MongoDB storage manager created`)
  }

  // ==================== DETERMINE PRIMARY STORAGE ====================
  
  let primaryStorage = 'file'
  let shouldMigrateToMongo = false

  if (storageMode === 'file') {
    primaryStorage = 'file'
    logger.info(`[${sessionId}] 📁 FILE MODE: Using file storage only`)
    
  } else if (storageMode === 'mongodb') {
    const mongoHasAuth = mongoStore ? await mongoStore.readData('creds.json') : null
    const fileHasAuth = await fileStorage.readFile('creds.json')
    
    if (mongoHasAuth?.noiseKey && mongoHasAuth?.signedIdentityKey) {
      primaryStorage = 'mongodb'
      logger.info(`[${sessionId}] 📦 MONGODB MODE: Using MongoDB (auth exists)`)
      
    } else if (fileHasAuth?.noiseKey && fileHasAuth?.signedIdentityKey) {
      primaryStorage = 'file'
      shouldMigrateToMongo = mongoStore !== null
      if (shouldMigrateToMongo) {
        logger.info(`[${sessionId}] 📁→📦 MONGODB MODE: Using file, will migrate in 15s`)
      }
      
    } else if (isPairing) {
      primaryStorage = 'file'
      logger.info(`[${sessionId}] 📁 MONGODB MODE: New pairing, starting with file`)
      
    } else {
      primaryStorage = 'mongodb'
      logger.info(`[${sessionId}] 📦 MONGODB MODE: New session, using MongoDB`)
    }
  }

  // ==================== READ/WRITE OPERATIONS ====================

  const readData = async (fileName) => {
    // Try primary storage first
    if (primaryStorage === 'mongodb' && mongoStore) {
      const mongoData = await mongoStore.readData(fileName)
      if (mongoData) {
        return mongoData
      }
    }
    
    // Fallback to file
    return await fileStorage.readFile(fileName)
  }

const writeData = async (data, fileName) => {
  let success = false

  // ✅ CRITICAL: ALWAYS ensure directory exists before ANY write attempt
  try {
    const fs = await import('fs/promises')
    await fs.mkdir(fileStorage.sessionDir, { recursive: true })
  } catch (error) {
    logger.error(`[${sessionId}] Failed to ensure directory exists:`, error.message)
  }

  // Write based on primary storage
  if (primaryStorage === 'mongodb' && mongoStore) {
    success = await mongoStore.writeData(fileName, data)
    // Always backup to file (background) - ensure directory first
    (async () => {
      try {
        await fs.mkdir(fileStorage.sessionDir, { recursive: true })
        await fileStorage.writeFile(fileName, data)
      } catch (err) {
        logger.debug(`[${sessionId}] Background file write failed: ${err.message}`)
      }
    })()
    
  } else {
    // Ensure directory exists again right before file write
    try {
      await fs.mkdir(fileStorage.sessionDir, { recursive: true })
    } catch (error) {
      logger.debug(`[${sessionId}] Directory ensure retry: ${error.message}`)
    }
    success = await fileStorage.writeFile(fileName, data)
  }

  return success
}

  const removeData = async (fileName) => {
    const promises = []
    
    if (mongoStore) {
      promises.push(mongoStore.deleteData(fileName))
    }
    
    promises.push(fileStorage.deleteFile(fileName))
    
    await Promise.all(promises)
  }

  // ==================== LOAD OR CREATE CREDENTIALS ====================

  const existingCreds = await readData("creds.json")
  const creds = existingCreds?.noiseKey && existingCreds?.signedIdentityKey
    ? existingCreds
    : initAuthCreds()

  const isNewSession = !existingCreds

  if (isNewSession) {
    logger.info(`[${sessionId}] 🆕 Creating new credentials`)
    await writeData(creds, "creds.json")
  } else {
    logger.info(`[${sessionId}] ✅ Loaded existing credentials from ${primaryStorage}`)
  }

  // ==================== MIGRATION TIMER ====================

  let migrationTimer = null
  
  if (shouldMigrateToMongo && mongoStore && !isNewSession) {
    logger.info(`[${sessionId}] ⏰ Scheduling file→MongoDB migration in ${CONFIG.MIGRATION_DELAY/1000}s`)
    
    migrationTimer = setTimeout(async () => {
      try {
        logger.info(`[${sessionId}] 🔄 Starting file→MongoDB migration`)
        
        // Verify directory exists
        try {
          await fs.access(fileStorage.sessionDir)
        } catch (error) {
          logger.error(`[${sessionId}] ❌ Directory doesn't exist, staying on file storage`)
          primaryStorage = 'file'
          return
        }
        
        const fileNames = await fileStorage.getAllFiles()
        
        if (fileNames.length === 0) {
          logger.warn(`[${sessionId}] No auth files found to migrate`)
          return
        }
        
        logger.info(`[${sessionId}] Found ${fileNames.length} files to migrate`)
        
        let migrated = 0
        let failed = 0
        
        for (const fileName of fileNames) {
          try {
            const data = await fileStorage.readFile(fileName)
            
            if (!data) {
              failed++
              continue
            }
            
            const success = await mongoStore.writeData(fileName, data)
            
            if (success) {
              migrated++
              if (migrated % 50 === 0) {
                logger.info(`[${sessionId}] Migration progress: ${migrated}/${fileNames.length}`)
              }
            } else {
              failed++
            }
            
            await new Promise(resolve => setTimeout(resolve, 50))
            
          } catch (error) {
            logger.error(`[${sessionId}] Migration error for ${fileName}: ${error.message}`)
            failed++
          }
        }
        
        const successRate = migrated / fileNames.length
        
        logger.info(`[${sessionId}] 📊 Migration: ${migrated} migrated, ${failed} failed (${(successRate * 100).toFixed(1)}%)`)
        
        if (successRate >= 0.95) {
          logger.info(`[${sessionId}] ✅ Migration successful → switched to MongoDB`)
          primaryStorage = 'mongodb'
        } else {
          logger.error(`[${sessionId}] ❌ Migration failed → staying on file storage`)
          primaryStorage = 'file'
        }
        
      } catch (error) {
        logger.error(`[${sessionId}] Migration crashed: ${error.message}`)
        primaryStorage = 'file'
      }
    }, CONFIG.MIGRATION_DELAY)
  }

  // ==================== RETURN AUTH STATE ====================

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
                await writeData(value, file)
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
      logger.info(`[${sessionId}] 🧹 Cleaning up auth state`)

      if (migrationTimer) {
        clearTimeout(migrationTimer)
        logger.debug(`[${sessionId}] Cancelled pending migration`)
      }

      const cleanupPromises = []

      if (mongoStore) {
        cleanupPromises.push(mongoStore.cleanup())
      }

      cleanupPromises.push(fileStorage.cleanup())

      await Promise.allSettled(cleanupPromises)
      
      globalCollectionRefs.delete(sessionId)
      
      logger.info(`[${sessionId}] ✅ Auth cleanup complete`)
    },
  }
}

// ==================== HELPER FUNCTIONS ====================

export const cleanupSessionAuthData = async (mongoStorage, sessionId) => {
  try {
    logger.info(`[${sessionId}] Cleaning up all auth data`)

    const cleanupPromises = []

    // Cleanup MongoDB
    if (isMongoDBMode() && mongoStorage?.isConnected) {
      cleanupPromises.push(
        mongoStorage.deleteAuthState(sessionId).catch((error) => {
          logger.error(`[${sessionId}] MongoDB cleanup error:`, error.message)
          return false
        })
      )
    }

    // Cleanup files
    const fileStorage = new FileStorageManager(sessionId)
    await fileStorage.init()
    cleanupPromises.push(fileStorage.cleanup())

    const results = await Promise.allSettled(cleanupPromises)
    const success = results.some((r) => r.status === "fulfilled" && r.value)
    
    globalCollectionRefs.delete(sessionId)
    
    return success
  } catch (error) {
    logger.error(`[${sessionId}] Cleanup failed:`, error.message)
    return false
  }
}

export const hasValidAuthData = async (mongoStorage, sessionId) => {
  try {
    const fileStorage = new FileStorageManager(sessionId)
    await fileStorage.init()

    const fileCreds = await fileStorage.readFile('creds.json')
    if (fileCreds?.noiseKey && fileCreds?.signedIdentityKey) {
      return true
    }

    if (isMongoDBMode() && mongoStorage?.isConnected) {
      try {
        const hasAuth = await mongoStorage.hasValidAuthData(sessionId)
        if (hasAuth) {
          return true
        }
      } catch (error) {
        logger.debug(`[${sessionId}] MongoDB validation error:`, error.message)
      }
    }

    return false
  } catch (error) {
    logger.error(`[${sessionId}] Auth validation error:`, error.message)
    return false
  }
}

export const checkAuthAvailability = async (mongoStorage, sessionId) => {
  const fileStorage = new FileStorageManager(sessionId)
  await fileStorage.init()

  const hasFile = await fileStorage.readFile('creds.json') !== null
  let hasMongo = false

  if (isMongoDBMode() && mongoStorage?.isConnected) {
    hasMongo = await mongoStorage.hasValidAuthData(sessionId)
  }

  return {
    hasFile,
    hasMongo,
    hasAuth: hasFile || hasMongo,
    preferred: isFileMode() 
      ? (hasFile ? 'file' : 'none')
      : (hasMongo ? 'mongodb' : (hasFile ? 'file' : 'none')),
  }
}

export const getAuthStorageStats = () => {
  return {
    storageMode: getStorageMode(),
    isMongoDBMode: isMongoDBMode(),
    isFileMode: isFileMode(),
    migrationDelay: `${CONFIG.MIGRATION_DELAY/1000}s`,
    activeCollectionRefs: globalCollectionRefs.size,
  }
}