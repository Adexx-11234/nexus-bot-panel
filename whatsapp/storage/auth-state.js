// ============================================================================
// auth-state.js - COMPLETE FIXED FILE
// ============================================================================

import { WAProto as proto, initAuthCreds } from "@whiskeysockets/baileys"
import { createComponentLogger } from "../../utils/logger.js"
import fs from "fs/promises"
import path from "path"

const logger = createComponentLogger("AUTH_STATE")

// ✅ CRITICAL: Store collection references globally to prevent garbage collection
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

// ==================== STORAGE MODE DETECTION ====================
const getStorageMode = () => {
  return (process.env.STORAGE_MODE || 'mongodb').toLowerCase()
}

const isMongoDBMode = () => {
  return getStorageMode() === 'mongodb'
}

const isFileMode = () => {
  return getStorageMode() === 'file'
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
      const filePath = path.join(this.sessionDir, fileName)
      
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
      
      const filePath = path.join(this.sessionDir, fileName)
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
      const filePath = path.join(this.sessionDir, fileName)
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
      logger.error(`[${this.sessionId}] Failed to list files:`, error.message)
      return []
    }
  }
}

// ==================== MONGODB STORAGE MANAGER ====================
class MongoDBStorageManager {
  constructor(collection, sessionId) {
    this.collection = collection
    this.sessionId = sessionId
    this.isHealthy = true
    this.consecutiveFailures = 0
    this.maxFailures = 3
    
    this._loggedNoCollection = false
    this._loggedNoTopology = false
    this._loggedDestroyedTopology = false
    this._loggedHealthError = false
    
    if (!collection) {
      logger.error(`[${sessionId}] MongoDBStorageManager created with NULL collection!`)
      this.isHealthy = false
    } else {
      try {
        const collectionName = collection.collectionName || collection.s?.namespace?.collection
        logger.debug(`[${sessionId}] MongoDBStorageManager created for collection: ${collectionName}`)
      } catch (e) {
        logger.error(`[${sessionId}] Error getting collection name: ${e.message}`)
      }
    }
  }

  _checkHealth() {
    // Simple check: if collection exists, it's healthy
    return !!this.collection
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
      return result
    } catch (error) {
      if (error.message === 'timeout') {
        logger.debug(`[${this.sessionId}] MongoDB ${operationName}: timeout`)
      } else {
        logger.error(`[${this.sessionId}] MongoDB ${operationName}: ${error.message}`)
      }
      return fallbackValue
    }
  }

  fixFileName(file) {
    return file?.replace(/\//g, "__")?.replace(/:/g, "-") || ""
  }

  async readData(fileName) {
    return await this._safeOperation(
      `read(${fileName})`,
      async () => {
        const result = await this.collection.findOne(
          { filename: this.fixFileName(fileName), sessionId: this.sessionId },
          { projection: { datajson: 1 } }
        )

        if (result?.datajson) {
          return JSON.parse(result.datajson, BufferJSON.reviver)
        }
        return null
      },
      null
    )
  }

  async writeData(fileName, data) {
    const result = await this._safeOperation(
      `write(${fileName})`,
      async () => {
        if (!this.collection) {
          logger.error(`[${this.sessionId}] MongoDB collection not available`)
          return false
        }
        
        try {
          const result = await this.collection.updateOne(
            { filename: this.fixFileName(fileName), sessionId: this.sessionId },
            {
              $set: {
                filename: this.fixFileName(fileName),
                sessionId: this.sessionId,
                datajson: JSON.stringify(data, BufferJSON.replacer),
                updatedAt: new Date(),
              },
            },
            { upsert: true }
          )
          
          return result.acknowledged
        } catch (error) {
          logger.error(`[${this.sessionId}] MongoDB write error for ${fileName}: ${error.message}`)
          return false
        }
      },
      false
    )

    this._recordResult(result)
    return result
  }

  async deleteData(fileName) {
    return await this._safeOperation(
      `delete(${fileName})`,
      async () => {
        const result = await this.collection.deleteOne({
          filename: this.fixFileName(fileName),
          sessionId: this.sessionId,
        })
        return result.deletedCount > 0
      },
      false
    )
  }

  async cleanup() {
    return await this._safeOperation(
      'cleanup',
      async () => {
        const result = await this.collection.deleteMany({ sessionId: this.sessionId })
        if (result.deletedCount > 0) {
          logger.info(`[${this.sessionId}] Deleted ${result.deletedCount} auth docs from MongoDB`)
        }
        return result.deletedCount > 0
      },
      false
    )
  }
}

// ==================== MAIN AUTH STATE FUNCTION ====================
export const useMongoDBAuthState = async (collection, sessionId, isPairing = false, source = 'telegram') => {
  if (!sessionId?.startsWith("session_")) {
    throw new Error(`Invalid sessionId: ${sessionId}`)
  }

  const storageMode = getStorageMode()
  const isWebSession = source === 'web'
  
  logger.info(`[${sessionId}] 🔐 Auth mode: ${storageMode.toUpperCase()} | Source: ${source}`)

  const fileStorage = new FileStorageManager(sessionId)
  await fileStorage.init()

  let mongoStorage = null
  
  if ((storageMode === 'mongodb' || isWebSession) && collection) {
    mongoStorage = new MongoDBStorageManager(collection, sessionId)
    globalCollectionRefs.set(sessionId, collection)
    logger.info(`[${sessionId}] ✅ MongoDB storage manager created`)
  }

  let primaryStorage = 'file'
  let shouldMigrateToMongo = false

  if (storageMode === 'file') {
    primaryStorage = 'file'
    logger.info(`[${sessionId}] 📁 FILE MODE: Using file storage only`)
    
  } else if (storageMode === 'mongodb') {
    const mongoHasAuth = mongoStorage ? await mongoStorage.readData('creds.json') : null
    const fileHasAuth = await fileStorage.readFile('creds.json')
    
    if (mongoHasAuth?.noiseKey && mongoHasAuth?.signedIdentityKey) {
      primaryStorage = 'mongodb'
      logger.info(`[${sessionId}] 📦 MONGODB MODE: Using MongoDB (already exists)`)
      
    } else if (fileHasAuth?.noiseKey && fileHasAuth?.signedIdentityKey) {
      primaryStorage = 'file'
      shouldMigrateToMongo = mongoStorage !== null
      if (shouldMigrateToMongo) {
        logger.info(`[${sessionId}] 📁→📦 MONGODB MODE: Using file, will migrate to MongoDB in 15s`)
      }
      
    } else if (isPairing) {
      primaryStorage = 'file'
      logger.info(`[${sessionId}] 📁 MONGODB MODE: New pairing, starting with file`)
      
    } else {
      primaryStorage = 'mongodb'
      logger.info(`[${sessionId}] 📦 MONGODB MODE: New session, using MongoDB`)
    }
  }

  const readData = async (fileName) => {
    if (primaryStorage === 'mongodb' && mongoStorage) {
      const mongoData = await mongoStorage.readData(fileName)
      if (mongoData) {
        return mongoData
      }
    }
    
    return await fileStorage.readFile(fileName)
  }

  const writeData = async (data, fileName) => {
    let success = false

    if (primaryStorage === 'mongodb' && mongoStorage) {
      success = await mongoStorage.writeData(fileName, data)
      fileStorage.writeFile(fileName, data).catch(() => {})
      
    } else {
      success = await fileStorage.writeFile(fileName, data)
    }

    return success
  }

  const removeData = async (fileName) => {
    const promises = []
    
    if (mongoStorage) {
      promises.push(mongoStorage.deleteData(fileName))
    }
    
    promises.push(fileStorage.deleteFile(fileName))
    
    await Promise.all(promises)
  }

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

  let migrationTimer = null
  
  if (shouldMigrateToMongo && mongoStorage && !isNewSession) {
    logger.info(`[${sessionId}] ⏰ Scheduling file→MongoDB migration in ${CONFIG.MIGRATION_DELAY/1000}s`)
    
    migrationTimer = setTimeout(async () => {
      try {
        logger.info(`[${sessionId}] 🔄 Starting file→MongoDB migration`)
        
        try {
          await fs.access(fileStorage.sessionDir)
          logger.info(`[${sessionId}] ✅ Directory exists: ${fileStorage.sessionDir}`)
        } catch (error) {
          logger.error(`[${sessionId}] ❌ Directory doesn't exist: ${fileStorage.sessionDir}`)
          primaryStorage = 'file'
          return
        }
        
        const fileNames = await fileStorage.getAllFiles()
        
        if (fileNames.length === 0) {
          logger.warn(`[${sessionId}] No auth files found to migrate`)
          return
        }
        
        logger.info(`[${sessionId}] Found ${fileNames.length} files to migrate: ${fileNames.slice(0, 5).join(', ')}...`)
        
        let migrated = 0
        let failed = 0
        let readErrors = 0
        let writeErrors = 0
        
        for (const fileName of fileNames) {
          try {
            const filePath = path.join(fileStorage.sessionDir, fileName)
            try {
              await fs.access(filePath)
            } catch (error) {
              failed++
              continue
            }
            
            const data = await fileStorage.readFile(fileName)
            
            if (!data) {
              readErrors++
              failed++
              continue
            }
            
            const success = await mongoStorage.writeData(fileName, data)
            
            if (success) {
              migrated++
              if (fileName === 'creds.json' || fileName.includes('app-state-sync-key')) {
                logger.info(`[${sessionId}] ✅ Migrated ${fileName}`)
              }
              // Log progress every 50 files
              if (migrated % 50 === 0) {
                logger.info(`[${sessionId}] Migration progress: ${migrated}/${fileNames.length} files`)
              }
            } else {
              writeErrors++
              failed++
              // Log first 5 failures
              if (failed <= 5) {
                logger.warn(`[${sessionId}] ❌ Failed to migrate ${fileName}`)
              }
            }
            
            await new Promise(resolve => setTimeout(resolve, 50))
            
          } catch (error) {
            logger.error(`[${sessionId}] Migration error for ${fileName}: ${error.message}`)
            failed++
          }
        }
        
        logger.info(`[${sessionId}] 📊 Migration stats: ${migrated} migrated, ${failed} failed (${readErrors} read errors, ${writeErrors} write errors)`)
        
        const totalFiles = fileNames.length
        const successRate = migrated / totalFiles
        
        logger.info(`[${sessionId}] 📈 Success rate: ${(successRate * 100).toFixed(1)}% (${migrated}/${totalFiles})`)
        
        if (successRate >= 0.95) {
          logger.info(`[${sessionId}] ✅ Migration successful: ${migrated}/${totalFiles} files → MongoDB`)
          primaryStorage = 'mongodb'
          logger.info(`[${sessionId}] 📦 Switched to MongoDB as primary storage`)
          logger.info(`[${sessionId}] 📁 Keeping file auth as backup`)
          
        } else {
          logger.error(`[${sessionId}] ❌ Migration FAILED: Only ${migrated}/${totalFiles} files migrated`)
          logger.error(`[${sessionId}] 📁 Staying on file storage`)
          primaryStorage = 'file'
        }
        
      } catch (error) {
        logger.error(`[${sessionId}] Migration crashed: ${error.message}`)
        primaryStorage = 'file'
      }
    }, CONFIG.MIGRATION_DELAY)
  }

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

      if (mongoStorage) {
        cleanupPromises.push(mongoStorage.cleanup())
      }

      cleanupPromises.push(fileStorage.cleanup())

      await Promise.allSettled(cleanupPromises)
      
      globalCollectionRefs.delete(sessionId)
      
      logger.info(`[${sessionId}] ✅ Auth cleanup complete`)
    },
  }
}

// ==================== HELPER FUNCTIONS ====================

export const cleanupSessionAuthData = async (collection, sessionId) => {
  try {
    logger.info(`[${sessionId}] Cleaning up all auth data`)

    const cleanupPromises = []

    if (isMongoDBMode() && collection) {
      cleanupPromises.push(
        collection.deleteMany({ sessionId }).catch((error) => {
          logger.error(`[${sessionId}] MongoDB cleanup error:`, error.message)
          return { deletedCount: 0 }
        })
      )
    }

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

export const hasValidAuthData = async (collection, sessionId) => {
  try {
    const fileStorage = new FileStorageManager(sessionId)
    await fileStorage.init()

    const fileCreds = await fileStorage.readFile('creds.json')
    if (fileCreds?.noiseKey && fileCreds?.signedIdentityKey) {
      return true
    }

    if (isMongoDBMode() && collection) {
      try {
        const mongoStorage = new MongoDBStorageManager(collection, sessionId)
        const mongoCreds = await mongoStorage.readData('creds.json')
        if (mongoCreds?.noiseKey && mongoCreds?.signedIdentityKey) {
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

export const getAuthStorageStats = () => {
  return {
    storageMode: getStorageMode(),
    isMongoDBMode: isMongoDBMode(),
    isFileMode: isFileMode(),
    migrationDelay: `${CONFIG.MIGRATION_DELAY/1000}s`,
    activeCollectionRefs: globalCollectionRefs.size,
  }
}

export const checkAuthAvailability = async (collection, sessionId) => {
  const fileStorage = new FileStorageManager(sessionId)
  await fileStorage.init()

  const hasFile = await fileStorage.readFile('creds.json') !== null
  let hasMongo = false

  if (isMongoDBMode() && collection) {
    const mongoStorage = new MongoDBStorageManager(collection, sessionId)
    hasMongo = await mongoStorage.readData('creds.json') !== null
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