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

// Cache for auth data (5 minute TTL)
const authCache = new Map()
const writeQueue = new Map()

/**
 * Cleanup auth cache
 * @private
 */
const cleanupCache = (sessionId = null) => {
  if (sessionId) {
    for (const [key] of authCache) {
      if (key.startsWith(`${sessionId}:`)) {
        authCache.delete(key)
      }
    }
    for (const [key, timeout] of writeQueue) {
      if (key.startsWith(`${sessionId}:`)) {
        clearTimeout(timeout)
        writeQueue.delete(key)
      }
    }
  } else {
    const now = Date.now()
    const maxAge = 300000 // 5 minutes
    for (const [key, data] of authCache) {
      if (data.timestamp && (now - data.timestamp) > maxAge) {
        authCache.delete(key)
      }
    }
  }
}

// Periodic cache cleanup
setInterval(() => cleanupCache(), 120000)

/**
 * Use MongoDB as authentication state storage
 * Compatible with Baileys auth state interface
 */
export const useMongoDBAuthState = async (collection, sessionId) => {
  if (!sessionId || !sessionId.startsWith('session_')) {
    throw new Error(`Invalid sessionId: ${sessionId}`)
  }

  const fixFileName = (file) => file?.replace(/\//g, '__')?.replace(/:/g, '-') || ''

  /**
   * Read data from MongoDB with caching and retry logic
   */
  const readData = async (fileName) => {
    const cacheKey = `${sessionId}:${fileName}`

    // Check cache (5 minute TTL)
    if (authCache.has(cacheKey)) {
      const cached = authCache.get(cacheKey)
      if (cached.timestamp && (Date.now() - cached.timestamp) < 300000) {
        return cached.data
      } else {
        authCache.delete(cacheKey)
      }
    }

    // Retry logic for critical auth files
    const isCriticalFile = fileName === 'creds.json' || fileName.includes('creds')
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

        if (data) {
          authCache.set(cacheKey, { data, timestamp: Date.now() })
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
   * Write data to MongoDB with debouncing
   */
  const writeData = async (datajson, fileName) => {
    const cacheKey = `${sessionId}:${fileName}`
    authCache.set(cacheKey, { data: datajson, timestamp: Date.now() })

    const queueKey = `${sessionId}:${fileName}`
    if (writeQueue.has(queueKey)) {
      clearTimeout(writeQueue.get(queueKey))
    }

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
    }, 50)

    writeQueue.set(queueKey, timeoutId)
  }

  /**
   * Remove data from MongoDB
   */
  const removeData = async (fileName) => {
    const cacheKey = `${sessionId}:${fileName}`
    authCache.delete(cacheKey)

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
                // Silent error
              }
            })
            await Promise.allSettled(promises)
          }
          return data
        },
        set: async (data) => {
          const tasks = []
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const file = `${category}-${id}.json`

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