import { proto, initAuthCreds } from '@whiskeysockets/baileys'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('AUTH_STATE')

/**
 * Buffer JSON serialization helpers
 */
const BufferJSON = {
  replacer: (k, value) => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === 'Buffer') {
      return {
        type: 'Buffer',
        data: Buffer.from(value?.data || value).toString('base64')
      }
    }
    return value
  },
  reviver: (_, value) => {
    if (typeof value === 'object' && !!value && (value.buffer === true || value.type === 'Buffer')) {
      const val = value.data || value.value
      return typeof val === 'string' ? Buffer.from(val, 'base64') : Buffer.from(val || [])
    }
    return value
  }
}

// CRITICAL: Only cache creds.json (not all keys) - Aggressive RAM management
const credsCache = new Map()
const MAX_CACHE_SIZE = 500 // Support 500 users (up from 50)
const CACHE_TTL = 120000 // 2 minutes TTL
const writeQueue = new Map()

/**
 * Cleanup cache - aggressive strategy
 * @private
 */
const cleanupCache = (sessionId = null) => {
  if (sessionId) {
    // Remove specific session
    credsCache.delete(sessionId)
    const queueKey = `${sessionId}:creds.json`
    if (writeQueue.has(queueKey)) {
      clearTimeout(writeQueue.get(queueKey))
      writeQueue.delete(queueKey)
    }
  } else {
    // Remove stale entries
    const now = Date.now()
    for (const [key, data] of credsCache) {
      if (data.timestamp && (now - data.timestamp) > CACHE_TTL) {
        credsCache.delete(key)
      }
    }
    
    // Enforce max size - remove oldest entries
    if (credsCache.size > MAX_CACHE_SIZE) {
      const entries = Array.from(credsCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
      
      const toRemove = entries.slice(0, credsCache.size - MAX_CACHE_SIZE)
      for (const [key] of toRemove) {
        credsCache.delete(key)
      }
      
      logger.warn(`Cache exceeded max size (${MAX_CACHE_SIZE}), removed ${toRemove.length} oldest entries`)
    }
  }
}

// Aggressive cache cleanup every 30 seconds
setInterval(() => cleanupCache(), 30000)

/**
 * Use MongoDB as authentication state storage
 * Compatible with Baileys auth state interface
 * 
 * CRITICAL: Stores ALL auth data (creds + keys), only caches creds.json
 */
export const useMongoDBAuthState = async (collection, sessionId) => {
  if (!sessionId || !sessionId.startsWith('session_')) {
    throw new Error(`Invalid sessionId: ${sessionId}`)
  }

  const fixFileName = (file) => file?.replace(/\//g, '__')?.replace(/:/g, '-') || ''

  /**
   * Read data from MongoDB
   * CRITICAL: Only caches creds.json, all other keys read directly
   */
  const readData = async (fileName) => {
    // Only cache creds.json
    if (fileName === 'creds.json') {
      const cached = credsCache.get(sessionId)
      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached.data
      }
    }

    // Read from MongoDB (with retry for creds.json only)
    const isCriticalFile = fileName === 'creds.json'
    const maxRetries = isCriticalFile ? 3 : 1
    let lastError = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await collection.findOne(
          { filename: fixFileName(fileName), sessionId: sessionId },
          { projection: { datajson: 1 } }
        )

        if (!result) {
          if (isCriticalFile && attempt === maxRetries) {
            logger.error(`Auth read failed for ${sessionId}:${fileName} after ${maxRetries} attempts`)
          }
          return null
        }

        const data = JSON.parse(result.datajson, BufferJSON.reviver)

        // Only cache creds.json
        if (data && fileName === 'creds.json') {
          credsCache.set(sessionId, { data, timestamp: Date.now() })
          
          // Enforce max cache size
          if (credsCache.size > MAX_CACHE_SIZE) {
            cleanupCache()
          }
        }

        return data

      } catch (error) {
        lastError = error
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
        } else if (isCriticalFile) {
          logger.error(`Auth read error for ${sessionId}:${fileName} after ${maxRetries} attempts:`, error.message)
        }
      }
    }

    return null
  }

  /**
   * Write data to MongoDB
   * CRITICAL: Debounced writes (500ms) - faster flush for RAM
   */
  const writeData = async (datajson, fileName) => {
    // Only cache creds.json updates
    if (fileName === 'creds.json') {
      credsCache.set(sessionId, { data: datajson, timestamp: Date.now() })
      
      // Enforce max cache size
      if (credsCache.size > MAX_CACHE_SIZE) {
        cleanupCache()
      }
    }

    const queueKey = `${sessionId}:${fileName}`
    if (writeQueue.has(queueKey)) {
      clearTimeout(writeQueue.get(queueKey))
    }

    // FASTER flush: 500ms (down from 1000ms)
    const timeoutId = setTimeout(async () => {
      try {
        const query = { filename: fixFileName(fileName), sessionId: sessionId }
        const update = {
          $set: {
            filename: fixFileName(fileName),
            sessionId: sessionId,
            datajson: JSON.stringify(datajson, BufferJSON.replacer),
            updatedAt: new Date()
          }
        }
        await collection.updateOne(query, update, { upsert: true })
      } catch (error) {
        logger.error(`Auth write error for ${sessionId}:${fileName}:`, error.message)
      } finally {
        writeQueue.delete(queueKey)
      }
    }, 500)

    writeQueue.set(queueKey, timeoutId)
  }

  /**
   * Remove data from MongoDB
   */
  const removeData = async (fileName) => {
    if (fileName === 'creds.json') {
      credsCache.delete(sessionId)
    }

    try {
      await collection.deleteOne({ filename: fixFileName(fileName), sessionId: sessionId })
    } catch (error) {
      logger.error(`Auth remove error for ${sessionId}:${fileName}:`, error.message)
    }
  }

  // Load existing credentials or create new
  const existingCreds = await readData('creds.json')
  let creds = (existingCreds && existingCreds.noiseKey && existingCreds.signedIdentityKey)
    ? existingCreds
    : initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        /**
         * CRITICAL: Get keys in batches
         * Stores ALL keys in MongoDB (pre-keys, app-state, etc.)
         */
        get: async (type, ids) => {
          const data = {}
          const batchSize = 100

          for (let i = 0; i < ids.length; i += batchSize) {
            const batch = ids.slice(i, i + batchSize)
            const promises = batch.map(async (id) => {
              try {
                let value = await readData(`${type}-${id}.json`)
                if (type === 'app-state-sync-key' && value) {
                  value = proto.Message.AppStateSyncKeyData.fromObject(value)
                }
                if (value) data[id] = value
              } catch (error) {
                // Silent error for non-critical keys
              }
            })
            await Promise.allSettled(promises)
          }
          return data
        },
        /**
         * CRITICAL: Set keys in batches
         * Stores ALL keys (not just creds)
         */
        set: async (data) => {
          const tasks = []
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const file = `${category}-${id}.json`

              // Batch writes (max 20 concurrent)
              if (tasks.length >= 20) {
                await Promise.allSettled(tasks)
                tasks.length = 0
              }

              tasks.push(value ? writeData(value, file) : removeData(file))
            }
          }
          if (tasks.length > 0) {
            await Promise.allSettled(tasks)
          }
        }
      }
    },
    saveCreds: () => writeData(creds, 'creds.json'),
    cleanup: () => cleanupCache(sessionId)
  }
}

/**
 * Cleanup session auth data from MongoDB
 * CRITICAL: Deletes ALL auth files (creds + keys)
 */
export const cleanupSessionAuthData = async (collection, sessionId) => {
  try {
    const result = await collection.deleteMany({ sessionId })
    cleanupCache(sessionId)
    logger.info(`Cleaned up auth data for ${sessionId}: ${result.deletedCount} documents`)
    return true
  } catch (error) {
    logger.error(`Failed to cleanup auth data for ${sessionId}:`, error)
    return false
  }
}

/**
 * Check if session has valid auth data in MongoDB
 */
export const hasValidAuthData = async (collection, sessionId) => {
  const maxRetries = 3

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const creds = await collection.findOne({
        filename: 'creds.json',
        sessionId: sessionId
      }, { projection: { datajson: 1 } })

      if (!creds) {
        if (attempt === maxRetries) {
          logger.warn(`No auth credentials found for ${sessionId} after ${maxRetries} attempts`)
          return false
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
        continue
      }

      const credsData = JSON.parse(creds.datajson, BufferJSON.reviver)
      const isValid = !!(credsData && credsData.noiseKey && credsData.signedIdentityKey)

      if (!isValid && attempt === maxRetries) {
        logger.error(`Invalid auth credentials structure for ${sessionId}`)
      }

      return isValid

    } catch (error) {
      if (attempt === maxRetries) {
        logger.error(`Auth validation error for ${sessionId}:`, error.message)
        return false
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
    }
  }

  return false
}

/**
 * Get cache statistics for monitoring
 */
export const getAuthCacheStats = () => {
  return {
    credsCache: {
      size: credsCache.size,
      maxSize: MAX_CACHE_SIZE,
      ttl: CACHE_TTL
    },
    writeQueue: {
      size: writeQueue.size
    }
  }
}