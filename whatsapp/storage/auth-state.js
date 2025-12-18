import { WAProto as proto, initAuthCreds } from "@whiskeysockets/baileys"
import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("AUTH_STATE")

// ==================== BUFFER SERIALIZATION ====================
const BufferJSON = {
  replacer: (k, value) => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === "Buffer") {
      return {
        type: "Buffer",
        data: Buffer.from(value?.data || value).toString("base64"),
      }
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

// ==================== IN-MEMORY CACHE ====================
const sessionCaches = new Map() // sessionId -> { cache: Map, size: number, preKeysLoaded: boolean }
const writeQueue = new Map()

// Cache configuration
const MAX_CACHE_PER_SESSION = 500 * 1024 // 500KB per session
const MAX_TOTAL_CACHE = 50 * 1024 * 1024 // 50MB total
const MAX_CACHE_AGE_NON_CRITICAL = 600000 // 10 minutes
const CACHE_CLEANUP_INTERVAL = 300000 // 5 minutes

let totalCacheSize = 0

// ==================== HELPER FUNCTIONS ====================
const getDataSize = (data) => {
  try {
    return JSON.stringify(data).length
  } catch {
    return 0
  }
}

const getSessionCache = (sessionId) => {
  if (!sessionCaches.has(sessionId)) {
    sessionCaches.set(sessionId, {
      cache: new Map(),
      size: 0,
      lastAccess: Date.now(),
      preKeysLoaded: false
    })
  }
  
  const sessionCache = sessionCaches.get(sessionId)
  sessionCache.lastAccess = Date.now()
  
  return sessionCache
}

// ==================== MONGODB HEALTH CHECK ====================
const checkMongoHealth = async (collection) => {
  try {
    if (!collection) {
      return false
    }
    
    // FIXED: Use find().limit(1).toArray() instead of findOne().limit()
    await Promise.race([
      collection.find({}).limit(1).toArray(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Health check timeout')), 20000))
    ])
    
    return true
  } catch (error) {
    // Only log every 60 seconds to avoid spam
    if (!checkMongoHealth._lastError || Date.now() - checkMongoHealth._lastError > 60000) {
      logger.warn(`[MongoDB] Health check failed: ${error.message}`)
      checkMongoHealth._lastError = Date.now()
    }
    return false
  }
}

// ==================== CACHE CLEANUP ====================
const cleanupSessionCache = (sessionId) => {
  const sessionCache = sessionCaches.get(sessionId)
  if (!sessionCache) return

  const now = Date.now()
  let cleaned = 0

  for (const [key, data] of sessionCache.cache.entries()) {
    const isCritical = 
      key === 'creds.json' || 
      key.includes('session-') || 
      key.includes('pre-key-') ||
      key.includes('app-state-sync')
    
    if (!isCritical && data.timestamp && now - data.timestamp > MAX_CACHE_AGE_NON_CRITICAL) {
      const size = getDataSize(data.data)
      sessionCache.size -= size
      totalCacheSize -= size
      sessionCache.cache.delete(key)
      cleaned++
    }
  }

  if (sessionCache.size > MAX_CACHE_PER_SESSION) {
    const entries = Array.from(sessionCache.cache.entries())
      .filter(([key]) => {
        return key !== 'creds.json' && 
               !key.includes('session-') && 
               !key.includes('pre-key-') &&
               !key.includes('app-state-sync')
      })
      .sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0))

    const toRemove = Math.min(10, entries.length)
    
    for (let i = 0; i < toRemove; i++) {
      const [key, data] = entries[i]
      const size = getDataSize(data.data)
      sessionCache.size -= size
      totalCacheSize -= size
      sessionCache.cache.delete(key)
      cleaned++
    }
  }

  if (cleaned > 0) {
    logger.debug(`[Cache] Cleaned ${cleaned} non-critical entries for ${sessionId}`)
  }
}

const cleanupCache = (sessionId = null, force = false) => {
  if (sessionId) {
    const sessionCache = sessionCaches.get(sessionId)
    if (sessionCache) {
      if (force) {
        totalCacheSize -= sessionCache.size
        sessionCaches.delete(sessionId)
      } else {
        const criticalKeys = Array.from(sessionCache.cache.keys()).filter(key => {
          return key === 'creds.json' || 
                 key.includes('session-') || 
                 key.includes('pre-key-') ||
                 key.includes('app-state-sync')
        })
        
        sessionCache.cache.forEach((data, key) => {
          if (!criticalKeys.includes(key)) {
            const size = getDataSize(data.data)
            sessionCache.size -= size
            totalCacheSize -= size
            sessionCache.cache.delete(key)
          }
        })
      }
    }

    for (const [key, timeout] of writeQueue) {
      if (key.startsWith(`${sessionId}:`)) {
        clearTimeout(timeout)
        writeQueue.delete(key)
      }
    }
  } else {
    for (const [sessionId] of sessionCaches.entries()) {
      cleanupSessionCache(sessionId)
    }
  }
}

setInterval(() => cleanupCache(), CACHE_CLEANUP_INTERVAL)

// ==================== MONGODB OPERATIONS ====================
const executeMongoOperation = async (operation, operationName, sessionId) => {
  const startTime = Date.now()
  
  try {
    const result = await Promise.race([
      operation(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Operation timeout')), 2000) // 2 sec timeout
      )
    ])
    
    const duration = Date.now() - startTime
    
    if (duration > 1500) {
      logger.warn(`[MongoDB] ${operationName} took ${duration}ms for ${sessionId}`)
    }
    
    return result
  } catch (error) {
    if (!operationName.startsWith('read:') && error.message !== 'Operation timeout') {
      logger.error(`[MongoDB] ${operationName} failed for ${sessionId}: ${error.message}`)
    }
    return null
  }
}

// ==================== CRITICAL: PRE-KEY SYNC ====================
const preloadAllKeys = async (collection, sessionId, mongoHealthy) => {
  // FIXED: Always try to check MongoDB health again before preloading
  if (!mongoHealthy) {
    try {
      mongoHealthy = await checkMongoHealth(collection)
    } catch (error) {
      logger.debug(`[PreLoad] Health recheck failed for ${sessionId}`)
    }
  }

  if (!mongoHealthy) {
    logger.debug(`[PreLoad] MongoDB not healthy, skipping for ${sessionId}`)
    return
  }

  const sessionCache = getSessionCache(sessionId)
  
  if (sessionCache.preKeysLoaded) {
    logger.debug(`[PreLoad] Already loaded for ${sessionId}`)
    return
  }

  try {
    logger.info(`[PreLoad] Loading ALL keys for ${sessionId}...`)
    const startTime = Date.now()
    
    const allDocs = await executeMongoOperation(
      async () => {
        return await collection.find(
          { sessionId: sessionId },
          { projection: { filename: 1, datajson: 1 } }
        ).toArray()
      },
      'preload',
      sessionId
    )
    
    if (!allDocs || allDocs.length === 0) {
      logger.warn(`[PreLoad] No keys found for ${sessionId} - fresh session`)
      sessionCache.preKeysLoaded = true
      return
    }
    
    let loadedCount = 0
    let totalSize = 0
    
    for (const doc of allDocs) {
      try {
        const fileName = doc.filename
        const data = JSON.parse(doc.datajson, BufferJSON.reviver)
        
        if (data) {
          const size = getDataSize(data)
          
          sessionCache.cache.set(fileName, { 
            data, 
            timestamp: null,
            needsSync: false
          })
          
          sessionCache.size += size
          totalCacheSize += size
          totalSize += size
          loadedCount++
        }
      } catch (error) {
        logger.error(`[PreLoad] Failed to parse ${doc.filename}: ${error.message}`)
      }
    }
    
    sessionCache.preKeysLoaded = true
    const duration = Date.now() - startTime
    
    logger.info(`[PreLoad] ✅ Loaded ${loadedCount} keys in ${duration}ms (${(totalSize/1024).toFixed(1)}KB) for ${sessionId}`)
    
  } catch (error) {
    logger.error(`[PreLoad] Failed for ${sessionId}: ${error.message}`)
  }
}

// ==================== PERIODIC WRITE RETRY ====================
let writeRetryInterval = null

/**
 * ✅ NEW: Background worker to retry failed writes
 */
const startWriteRetryWorker = (collection, sessionId) => {
  // Only one worker per session
  const workerKey = `retry_worker_${sessionId}`
  
  if (writeRetryInterval && writeRetryInterval[workerKey]) {
    return
  }

  if (!writeRetryInterval) {
    writeRetryInterval = {}
  }

  writeRetryInterval[workerKey] = setInterval(async () => {
    const sessionCache = sessionCaches.get(sessionId)
    if (!sessionCache) {
      // Session cache gone, stop worker
      clearInterval(writeRetryInterval[workerKey])
      delete writeRetryInterval[workerKey]
      return
    }

    // Find entries that need sync
    const needsSync = []
    for (const [fileName, data] of sessionCache.cache.entries()) {
      if (data.needsSync) {
        needsSync.push({ fileName, data: data.data })
      }
    }

    if (needsSync.length === 0) {
      return
    }

    // Check MongoDB health
    const isHealthy = await checkMongoHealth(collection)
    if (!isHealthy) {
      const criticalCount = needsSync.filter(item => 
        item.fileName === 'creds.json' || 
        item.fileName.includes('session-') || 
        item.fileName.includes('pre-key-')
      ).length
      
      if (criticalCount > 0) {
        logger.warn(`[Retry Worker] ${sessionId}: ${criticalCount} critical files pending sync (MongoDB unhealthy)`)
      }
      return
    }

    logger.info(`[Retry Worker] ${sessionId}: Syncing ${needsSync.length} pending files to MongoDB`)

    // Attempt to sync
    let syncedCount = 0
    let failedCount = 0

    for (const { fileName, data } of needsSync) {
      try {
        await Promise.race([
          (async () => {
            const query = { filename: fixFileName(fileName), sessionId: sessionId }
            const update = {
              $set: {
                filename: fixFileName(fileName),
                sessionId: sessionId,
                datajson: JSON.stringify(data, BufferJSON.replacer),
                updatedAt: new Date(),
              },
            }
            await collection.updateOne(query, update, { upsert: true })
            
            // Mark as synced
            const cached = sessionCache.cache.get(fileName)
            if (cached) {
              cached.needsSync = false
            }
            
            syncedCount++
          })(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Sync timeout')), 10000)
          )
        ])
      } catch (error) {
        failedCount++
        
        // Log only critical file failures
        const isCritical = fileName === 'creds.json' || 
                          fileName.includes('session-') || 
                          fileName.includes('pre-key-')
        
        if (isCritical) {
          logger.error(`[Retry Worker] Failed to sync ${fileName}: ${error.message}`)
        }
      }
    }

    if (syncedCount > 0) {
      logger.info(`[Retry Worker] ${sessionId}: ✅ Synced ${syncedCount}/${needsSync.length} files${failedCount > 0 ? ` (${failedCount} failed)` : ''}`)
    }

  }, 30000) // Run every 30 seconds
}

/**
 * ✅ NEW: Stop retry worker for a session
 */
const stopWriteRetryWorker = (sessionId) => {
  const workerKey = `retry_worker_${sessionId}`
  
  if (writeRetryInterval && writeRetryInterval[workerKey]) {
    clearInterval(writeRetryInterval[workerKey])
    delete writeRetryInterval[workerKey]
    logger.debug(`[Retry Worker] Stopped for ${sessionId}`)
  }
}

// ==================== Fix fixFileName to be accessible ====================
const fixFileName = (file) => file?.replace(/\//g, "__")?.replace(/:/g, "-") || ""

// ==================== AUTH STATE IMPLEMENTATION ====================
export const useMongoDBAuthState = async (collection, sessionId, isPairing = false) => {
  if (!sessionId || !sessionId.startsWith("session_")) {
    throw new Error(`Invalid sessionId: ${sessionId}`)
  }

  const fixFileName = (file) => file?.replace(/\//g, "__")?.replace(/:/g, "-") || ""

  // FIXED: Properly check MongoDB health with timeout
  let mongoHealthy = false
  try {
    mongoHealthy = await Promise.race([
      checkMongoHealth(collection),
      new Promise(resolve => setTimeout(() => resolve(false), 3000))
    ])
  } catch (error) {
    logger.debug(`[${sessionId}] Health check failed: ${error.message}`)
    mongoHealthy = false
  }
  
  if (!mongoHealthy) {
    logger.warn(`[${sessionId}] MongoDB not available - using cache-only mode`)
  } else {
    logger.info(`[${sessionId}] MongoDB is healthy and available`)
  }

  startWriteRetryWorker(collection, sessionId)

  /**
   * ✅ ENHANCED: Read with connection validation
   */
  const readData = async (fileName) => {
    const isCriticalFile = 
      fileName === "creds.json" ||
      fileName.includes('session-') || 
      fileName.includes('pre-key-') ||
      fileName.includes('app-state-sync')
    
    const sessionCache = getSessionCache(sessionId)
    
    // Check cache first
    if (sessionCache.cache.has(fileName)) {
      const cached = sessionCache.cache.get(fileName)
      
      if (isCriticalFile) {
        return cached.data
      }
      
      if (cached.timestamp && Date.now() - cached.timestamp < MAX_CACHE_AGE_NON_CRITICAL) {
        return cached.data
      }
    }

    // Check MongoDB health before attempting read
    const isHealthy = await checkMongoHealth(collection)
    if (!isHealthy) {
      // Return stale cache if available
      if (sessionCache.cache.has(fileName)) {
        const staleData = sessionCache.cache.get(fileName).data
        logger.debug(`[Read] Using stale cache for ${fileName} (MongoDB unavailable)`)
        return staleData
      }
      return null
    }

    // Try MongoDB
    const result = await executeMongoOperation(
      async () => {
        return await collection.findOne(
          { filename: fixFileName(fileName), sessionId: sessionId },
          { projection: { datajson: 1 } }
        )
      },
      `read:${fileName}`,
      sessionId
    )

    if (result) {
      try {
        const data = JSON.parse(result.datajson, BufferJSON.reviver)

        if (data) {
          const size = getDataSize(data)

          const oldSize = sessionCache.cache.has(fileName) 
            ? getDataSize(sessionCache.cache.get(fileName).data) 
            : 0
          
          sessionCache.size = sessionCache.size - oldSize + size
          totalCacheSize = totalCacheSize - oldSize + size
          
          sessionCache.cache.set(fileName, { 
            data, 
            timestamp: isCriticalFile ? null : Date.now(),
            needsSync: false
          })
        }

        return data
      } catch (parseError) {
        logger.error(`[Parse Error] ${sessionId}:${fileName}: ${parseError.message}`)
      }
    }
    
    // Return stale cache if available
    if (sessionCache.cache.has(fileName)) {
      return sessionCache.cache.get(fileName).data
    }
    
    return null
  }

  /**
 * ✅ ENHANCED: Write with retry logic and connection validation
 */
const writeData = async (datajson, fileName) => {
  const isCriticalFile = 
    fileName === "creds.json" ||
    fileName.includes('session-') || 
    fileName.includes('pre-key-') ||
    fileName.includes('app-state-sync')
  
  const sessionCache = getSessionCache(sessionId)

  // IMMEDIATE cache update
  try {
    const oldSize = sessionCache.cache.has(fileName) 
      ? getDataSize(sessionCache.cache.get(fileName).data) 
      : 0
    
    const newSize = getDataSize(datajson)
    
    sessionCache.size = sessionCache.size - oldSize + newSize
    totalCacheSize = totalCacheSize - oldSize + newSize
    
    sessionCache.cache.set(fileName, { 
      data: datajson, 
      timestamp: isCriticalFile ? null : Date.now(),
      needsSync: true
    })
  } catch (cacheError) {
    logger.error(`[Cache Write Error] ${sessionId}:${fileName}: ${cacheError.message}`)
  }

  // Background MongoDB write with retry
  const queueKey = `${sessionId}:${fileName}`
  
  if (writeQueue.has(queueKey)) {
    clearTimeout(writeQueue.get(queueKey))
  }

  const attemptWrite = async (retryCount = 0) => {
    // Check MongoDB health before write
    const isHealthy = await checkMongoHealth(collection)
    
    if (!isHealthy) {
      if (isCriticalFile && retryCount === 0) {
        logger.warn(`[Write Deferred] ${fileName}: MongoDB not healthy, will retry`)
      }
      
      // Retry for critical files
      if (isCriticalFile && retryCount < 10) { // ✅ Increased from 5 to 10
        const delay = 3000 * (retryCount + 1) // ✅ Increased from 2000 to 3000
        setTimeout(() => attemptWrite(retryCount + 1), delay)
      }
      return
    }

    try {
      await Promise.race([
        (async () => {
          const query = { filename: fixFileName(fileName), sessionId: sessionId }
          const update = {
            $set: {
              filename: fixFileName(fileName),
              sessionId: sessionId,
              datajson: JSON.stringify(datajson, BufferJSON.replacer),
              updatedAt: new Date(),
            },
          }
          await collection.updateOne(query, update, { upsert: true })
          
          // Mark as synced
          const cached = sessionCache.cache.get(fileName)
          if (cached) {
            cached.needsSync = false
          }
        })(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Write timeout')), 15000) // ✅ Increased from 5000 to 15000
        )
      ])
    } catch (error) {
      const isConnError = 
        error.message?.toLowerCase().includes('connect') || 
        error.message?.toLowerCase().includes('topology') ||
        error.message?.toLowerCase().includes('must be connected') ||
        error.message?.toLowerCase().includes('timeout') // ✅ Added timeout as connection error
      
      if (isConnError && isCriticalFile && retryCount < 10) { // ✅ Increased from 5 to 10
        logger.warn(`[Write Retry ${retryCount + 1}/10] ${fileName}: ${error.message}`)
        const delay = 3000 * (retryCount + 1) // ✅ Increased from 2000 to 3000
        setTimeout(() => attemptWrite(retryCount + 1), delay)
      } else if (isCriticalFile) {
        logger.error(`[Write Failed] ${fileName}: ${error.message} (retry ${retryCount}/10)`)
      }
    }

    writeQueue.delete(queueKey)
  }

  // ✅ Critical files write immediately, non-critical files are batched
  const initialDelay = isCriticalFile ? 10 : 50
  const timeoutId = setTimeout(() => attemptWrite(0), initialDelay)
  writeQueue.set(queueKey, timeoutId)
}

  /**
   * Remove data
   */
  const removeData = async (fileName) => {
    const sessionCache = sessionCaches.get(sessionId)
    if (sessionCache && sessionCache.cache.has(fileName)) {
      const size = getDataSize(sessionCache.cache.get(fileName).data)
      sessionCache.size -= size
      totalCacheSize -= size
      sessionCache.cache.delete(fileName)
    }

    const isHealthy = await checkMongoHealth(collection)
    if (isHealthy) {
      await executeMongoOperation(
        async () => {
          await collection.deleteOne({ filename: fixFileName(fileName), sessionId: sessionId })
        },
        `remove:${fileName}`,
        sessionId
      )
    }
  }

  // Load credentials FIRST
  const existingCreds = await readData("creds.json")
  const creds =
    existingCreds && existingCreds.noiseKey && existingCreds.signedIdentityKey 
      ? existingCreds 
      : initAuthCreds()

  const isNewSession = !existingCreds

  if (isNewSession) {
    logger.info(`[${sessionId}] Creating new credentials`)
    await writeData(creds, "creds.json")
  }

  // Preload for existing sessions (not pairing)
  if (!isNewSession && !isPairing && mongoHealthy) {
    logger.info(`[${sessionId}] Scheduling background key preload...`)
    
    setImmediate(() => {
      preloadAllKeys(collection, sessionId, mongoHealthy).catch(err => {
        logger.error(`[PreLoad] Background preload failed for ${sessionId}: ${err.message}`)
      })
    })
  } else if (isPairing) {
    logger.info(`[${sessionId}] Skipping preload - pairing mode`)
  } else if (isNewSession) {
    logger.info(`[${sessionId}] Skipping preload - new session`)
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {}
          const sessionCache = getSessionCache(sessionId)
          
          // Check cache first
          for (const id of ids) {
            const fileName = `${type}-${id}.json`
            
            if (sessionCache.cache.has(fileName)) {
              let value = sessionCache.cache.get(fileName).data
              
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
              }
              
              if (value) {
                data[id] = value
              }
            }
          }
          
          // Fetch missing keys from MongoDB
          const missingIds = ids.filter(id => !data[id])
          
          if (missingIds.length > 0) {
            const isHealthy = await checkMongoHealth(collection)
            
            if (isHealthy) {
              await Promise.all(missingIds.map(async (id) => {
                try {
                  let value = await readData(`${type}-${id}.json`)
                  if (type === "app-state-sync-key" && value) {
                    value = proto.Message.AppStateSyncKeyData.fromObject(value)
                  }
                  if (value) data[id] = value
                } catch (error) {
                  // Silent
                }
              }))
            }
          }
          
          const totalFound = Object.keys(data).length
          const totalRequested = ids.length
          
          if (type === 'session' && totalFound > 0 && totalFound < totalRequested) {
            logger.warn(`[Keys] Retrieved ${totalFound}/${totalRequested} ${type} keys for ${sessionId}`)
          }
          
          return data
        },
        set: async (data) => {
          const tasks = []
          
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const file = `${category}-${id}.json`
              tasks.push(value ? writeData(value, file) : removeData(file))
            }
          }
          
          await Promise.allSettled(tasks)
        },
      },
    },
    saveCreds: () => writeData(creds, "creds.json"),
        cleanup: (force = false) => {
      stopWriteRetryWorker(sessionId) // ✅ Stop worker on cleanup
      cleanupCache(sessionId, force)
        },
  }
}

// ==================== CLEANUP & VALIDATION ====================
export const cleanupSessionAuthData = async (collection, sessionId) => {
  try {
    const result = await executeMongoOperation(
      async () => await collection.deleteMany({ sessionId }),
      'cleanup',
      sessionId
    )
    
    if (result) {
      logger.info(`[Cleanup] Removed ${result.deletedCount} documents for ${sessionId}`)
    }
    
    cleanupCache(sessionId, true)
    return true
  } catch (error) {
    logger.error(`[Cleanup] Failed for ${sessionId}:`, error)
    cleanupCache(sessionId, true)
    return false
  }
}

export const hasValidAuthData = async (collection, sessionId) => {
  const sessionCache = sessionCaches.get(sessionId)
  
  if (sessionCache?.cache.has('creds.json')) {
    const creds = sessionCache.cache.get('creds.json').data
    if (creds?.noiseKey && creds?.signedIdentityKey) {
      return true
    }
  }

  const mongoHealthy = await checkMongoHealth(collection)
  if (!mongoHealthy) {
    return false
  }

  const result = await executeMongoOperation(
    async () => {
      const creds = await collection.findOne(
        { filename: "creds.json", sessionId: sessionId },
        { projection: { datajson: 1 } }
      )
      
      if (!creds) return false
      
      const credsData = JSON.parse(creds.datajson, BufferJSON.reviver)
      return !!(credsData && credsData.noiseKey && credsData.signedIdentityKey)
    },
    'validate',
    sessionId
  )

  return result || false
}

export const getAuthCacheStats = () => {
  let totalCriticalFiles = 0
  let totalNeedSync = 0
  
  for (const [sessionId, cache] of sessionCaches) {
    for (const [key, value] of cache.cache.entries()) {
      if (key === 'creds.json' || 
          key.includes('session-') || 
          key.includes('pre-key-') ||
          key.includes('app-state-sync')) {
        totalCriticalFiles++
      }
      if (value.needsSync) {
        totalNeedSync++
      }
    }
  }

  return {
    sessions: sessionCaches.size,
    totalSizeMB: (totalCacheSize / 1024 / 1024).toFixed(2),
    maxTotalMB: (MAX_TOTAL_CACHE / 1024 / 1024).toFixed(2),
    maxPerSessionKB: (MAX_CACHE_PER_SESSION / 1024).toFixed(2),
    writeQueueSize: writeQueue.size,
    avgSessionSizeKB: sessionCaches.size > 0 ? ((totalCacheSize / sessionCaches.size) / 1024).toFixed(2) : 0,
    criticalFilesCached: totalCriticalFiles,
    pendingSync: totalNeedSync
  }
}