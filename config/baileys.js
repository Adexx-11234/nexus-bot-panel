import NodeCache from "node-cache"
import { makeInMemoryStore, makeWASocket, Browsers } from "@whiskeysockets/baileys"
import { logger } from "../utils/logger.js"
import pino from "pino"

// ==================== BAILEYS SILENT LOGGER ====================
const baileysLogger = pino({
  level: process.env.BAILEYS_LOG_LEVEL || "silent",
})
// ==================== END BAILEYS SILENT LOGGER ====================

const groupCache = new NodeCache({
  stdTTL: 30,
  checkperiod: 10,
  useClones: true,
})

const requestQueue = []
let isProcessingQueue = false
const RATE_LIMIT_DELAY = 500 // ms between requests to same endpoint

const sessionStores = new Map()
const sessionLastActivity = new Map()

const SESSION_CLEANUP_INTERVAL = 5 * 60 * 1000
const SESSION_INACTIVITY_TIMEOUT = 30 * 60 * 1000 // 30 minutes

// ✅ Default getMessage function
const defaultGetMessage = async (key) => {
  return undefined
}

export const baileysConfig = {
  logger: baileysLogger,
  printQRInTerminal: false,
  msgRetryCounterMap: {},
  browser: Browsers.windows("safari"),
  retryRequestDelayMs: 250,
  markOnlineOnConnect: false,
  getMessage: defaultGetMessage,
  version: [2, 3000, 1025190524],
  emitOwnEvents: true,
  syncFullHistory: true,
  fireInitQueries: true,
  maxMsgRetryCount: 40,
  patchMessageBeforeSending: (message) => {
    const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage)
    if (requiresPatch) {
      message = {
        viewOnceMessage: {
          message: {
            messageContextInfo: {
              deviceListMetadataVersion: 2,
              deviceListMetadata: {},
            },
            ...message,
          },
        },
      }
    }
    return message
  },
  appStateSyncInitialTimeoutMs: 10000,
  generateHighQualityLinkPreview: true,
}

export const eventTypes = [
  "messages.upsert",
  "groups.update",
  "group-participants.update",
  "messages.update",
  "contacts.update",
  "call",
]

// ==================== RATE LIMITING ====================

async function processRequestQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return

  isProcessingQueue = true

  while (requestQueue.length > 0) {
    const { fn, resolve, reject } = requestQueue.shift()
    try {
      const result = await fn()
      resolve(result)
    } catch (error) {
      reject(error)
    }

    if (requestQueue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY))
    }
  }

  isProcessingQueue = false
}

export function queueRequest(fn) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ fn, resolve, reject })
    processRequestQueue()
  })
}

// ==================== SESSION STORE MANAGEMENT ====================

/**
 * Create in-memory store for a session
 */
export function createSessionStore(sessionId) {
  if (sessionStores.has(sessionId)) {
    sessionLastActivity.set(sessionId, Date.now())
    return sessionStores.get(sessionId)
  }

  const store = makeInMemoryStore({
    logger: baileysLogger,
  })

  sessionStores.set(sessionId, store)
  sessionLastActivity.set(sessionId, Date.now())

  logger.debug(`[Store] Created in-memory store for ${sessionId}`)

  return store
}

/**
 * Get existing store for a session
 */
export function getSessionStore(sessionId) {
  if (sessionStores.has(sessionId)) {
    sessionLastActivity.set(sessionId, Date.now())
  }
  return sessionStores.get(sessionId)
}

/**
 * Delete store on cleanup
 */
export function deleteSessionStore(sessionId) {
  if (sessionStores.has(sessionId)) {
    sessionStores.delete(sessionId)
    sessionLastActivity.delete(sessionId)
    logger.debug(`[Store] Deleted store for ${sessionId}`)
    return true
  }
  return false
}

export function startSessionCleanup() {
  setInterval(() => {
    const now = Date.now()
    let cleanedCount = 0

    for (const [sessionId, lastActivity] of sessionLastActivity.entries()) {
      if (now - lastActivity > SESSION_INACTIVITY_TIMEOUT) {
        deleteSessionStore(sessionId)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      logger.info(`[Store] Cleaned up ${cleanedCount} abandoned sessions`)
    }
  }, SESSION_CLEANUP_INTERVAL)

  logger.info("[Store] Session cleanup interval started")
}

export function getSessionStoreStats() {
  return {
    activeStores: sessionStores.size,
    queuedRequests: requestQueue.length,
    isProcessingQueue,
  }
}

/**
 * Bind store to socket and setup getMessage
 */
export function bindStoreToSocket(sock, sessionId) {
  try {
    const store = getSessionStore(sessionId)

    if (!store) {
      logger.warn(`[Store] No store found for ${sessionId}, creating new one`)
      const newStore = createSessionStore(sessionId)
      newStore.bind(sock.ev)

      sock.getMessage = async (key) => {
        if (newStore) {
          const msg = await newStore.loadMessage(key.remoteJid, key.id)
          return msg?.message || undefined
        }
        return undefined
      }

      return newStore
    }

    store.bind(sock.ev)

    sock.getMessage = async (key) => {
      if (store) {
        const msg = await store.loadMessage(key.remoteJid, key.id)
        return msg?.message || undefined
      }
      return undefined
    }

    logger.info(`[Store] Bound store to socket for ${sessionId}`)
    return store
  } catch (error) {
    logger.error(`[Store] Error binding store for ${sessionId}:`, error.message)
    return null
  }
}

// ==================== SOCKET CREATION ====================

/**
 * Create Baileys socket with custom config and getMessage function
 */
export function createBaileysSocket(authState, sessionId, getMessage = null) {
  try {
    const sock = makeWASocket({
      ...baileysConfig,
      auth: authState,
      getMessage: getMessage || defaultGetMessage,
    })

    setupSocketDefaults(sock)

    const originalSendMessage = sock.sendMessage.bind(sock)
    sock.sendMessage = async (jid, content, options = {}) => {
      return await queueRequest(async () => {
        if (!options.ephemeralExpiration) {
          options.ephemeralExpiration = 0
        }
        return await originalSendMessage(jid, content, options)
      })
    }

    return sock
  } catch (error) {
    logger.error("Failed to create Baileys socket:", error)
    throw error
  }
}

/**
 * Setup default properties and utilities on socket
 */
export function setupSocketDefaults(sock) {
  try {
    if (sock.ev && typeof sock.ev.setMaxListeners === "function") {
      sock.ev.setMaxListeners(900)
    }

    sock.sessionId = null
    sock.eventHandlersSetup = false
    sock.connectionCallbacks = null

    logger.debug("Socket defaults configured")
  } catch (error) {
    logger.error("Failed to setup socket defaults:", error)
  }
}

/**
 * Get Baileys socket configuration
 */
export function getBaileysConfig() {
  return { ...baileysConfig }
}

// ==================== CACHE FUNCTIONS ====================

/**
 * Get group metadata with smart caching and rate-limiting
 */
export const getGroupMetadata = async (sock, jid, forceRefresh = false) => {
  try {
    const cacheKey = `group_${jid}`

    if (forceRefresh) {
      groupCache.del(cacheKey)
    }

    let metadata = groupCache.get(cacheKey)

    if (!metadata) {
      metadata = await queueRequest(() => sock.groupMetadata(jid))
      groupCache.set(cacheKey, metadata, 30)
      logger.debug(`[Cache] Fetched and cached group metadata: ${jid}`)
    } else {
      logger.debug(`[Cache] Retrieved group metadata from cache: ${jid}`)
    }

    return metadata
  } catch (error) {
    logger.error(`[Baileys] Error fetching group metadata for ${jid}:`, error.message)
    throw error
  }
}

/**
 * Proactively update cache from group events
 */
export const updateCacheFromEvent = (groupJid, updateData) => {
  try {
    const cacheKey = `group_${groupJid}`
    const existing = groupCache.get(cacheKey)

    if (existing) {
      const updated = { ...existing, ...updateData }
      groupCache.set(cacheKey, updated, 30)
      logger.debug(`[Cache] Proactively updated cache for ${groupJid}`)
      return true
    }

    return false
  } catch (error) {
    logger.error(`[Cache] Error updating cache from event:`, error.message)
    return false
  }
}

/**
 * Update participants in cache from participant events
 */
export const updateParticipantsInCache = async (sock, groupJid, participantUpdate) => {
  try {
    const cacheKey = `group_${groupJid}`
    let metadata = groupCache.get(cacheKey)

    const { participants: affectedUsers, action } = participantUpdate

    if (!metadata) {
      if (action === "add" || action === "remove") {
        metadata = await queueRequest(() => sock.groupMetadata(groupJid))
        groupCache.set(cacheKey, metadata, 30)
        logger.debug(`[Cache] Fetched metadata for participants update: ${groupJid}`)
        return
      }
      return
    }

    switch (action) {
      case "add": {
        const fresh = await queueRequest(() => sock.groupMetadata(groupJid))
        metadata.participants = fresh.participants
        break
      }

      case "remove": {
        metadata.participants = metadata.participants.filter(
          (p) => !affectedUsers.includes(p.id) && !affectedUsers.includes(p.jid),
        )
        break
      }

      case "promote":
      case "demote": {
        const newRole = action === "promote" ? "admin" : null
        metadata.participants = metadata.participants.map((p) => {
          if (affectedUsers.includes(p.id) || affectedUsers.includes(p.jid)) {
            return { ...p, admin: newRole }
          }
          return p
        })
        break
      }

      default:
        logger.warn(`[Cache] Unknown participant action: ${action}`)
    }

    groupCache.set(cacheKey, metadata, 30)
    logger.debug(`[Cache] Updated participants cache for ${groupJid} (${action})`)
  } catch (error) {
    logger.error(`[Cache] Error updating participants in cache:`, error.message)
    invalidateGroupCache(groupJid, "update_error")
  }
}

/**
 * Invalidate group cache entry
 */
export const invalidateGroupCache = (groupJid, reason = "update") => {
  const cacheKey = `group_${groupJid}`
  if (groupCache.has(cacheKey)) {
    groupCache.del(cacheKey)
    logger.debug(`[Cache] Invalidated group cache: ${groupJid} (${reason})`)
    return true
  }
  return false
}

/**
 * Force refresh group data and update cache
 */
export const refreshGroupMetadata = async (sock, jid) => {
  try {
    invalidateGroupCache(jid, "forced_refresh")
    return await getGroupMetadata(sock, jid)
  } catch (error) {
    logger.error(`[Baileys] Error refreshing group metadata: ${error.message}`)
    throw error
  }
}

// ==================== ADMIN FUNCTIONS ====================

const normalizeJid = (jid) => {
  if (!jid) return null
  return jid.split("@")[0] + "@s.whatsapp.net"
}

/**
 * Check if user is a group admin
 */
export const isUserGroupAdmin = async (sock, groupJid, userJid) => {
  try {
    const metadata = await getGroupMetadata(sock, groupJid)
    const normalizedUserJid = normalizeJid(userJid)

    if (!normalizedUserJid || !metadata.participants) {
      return false
    }

    return metadata.participants.some((participant) => {
      const normalizedParticipantJid = normalizeJid(participant.jid)
      return normalizedParticipantJid === normalizedUserJid && ["admin", "superadmin"].includes(participant.admin)
    })
  } catch (error) {
    logger.error(`[Baileys] Error checking admin status:`, error.message)
    return false
  }
}

/**
 * Check if bot is a group admin
 */
export const isBotGroupAdmin = async (sock, groupJid) => {
  try {
    if (!sock.user?.id) {
      logger.warn("[Baileys] Bot user ID not available")
      return false
    }

    const botJid = normalizeJid(sock.user.id)
    return await isUserGroupAdmin(sock, groupJid, botJid)
  } catch (error) {
    logger.error(`[Baileys] Error checking bot admin status:`, error.message)
    return false
  }
}

// ==================== EVENT LISTENERS ====================

/**
 * Setup cache invalidation listeners
 */
export const setupCacheInvalidation = (sock) => {
  try {
    sock.ev.on("group-participants.update", async (update) => {
      const { id, participants, action } = update
      logger.debug(`[Event] Group participants ${action}: ${id}`)
      await updateParticipantsInCache(sock, id, update)
    })

    sock.ev.on("groups.update", (updates) => {
      updates.forEach((update) => {
        if (update.id) {
          logger.debug(`[Event] Group update: ${update.id}`)
          if (Object.keys(update).length > 1) {
            updateCacheFromEvent(update.id, update)
          } else {
            invalidateGroupCache(update.id, "group_update")
          }
        }
      })
    })

    logger.info("[Cache] Setup group cache invalidation listeners")
  } catch (error) {
    logger.error("[Cache] Error setting up cache invalidation:", error.message)
  }
}

// ==================== CACHE MANAGEMENT ====================

export const updateGroupCache = (jid, metadata) => {
  try {
    const cacheKey = `group_${jid}`
    groupCache.set(cacheKey, metadata, 30)
    logger.debug(`[Cache] Manually updated group cache for ${jid}`)
    return true
  } catch (error) {
    logger.error("[Cache] Error updating group cache:", error.message)
    return false
  }
}

export const getGroupCache = (jid) => {
  const cacheKey = `group_${jid}`
  return groupCache.get(cacheKey)
}

export const clearGroupCache = (jid) => {
  return invalidateGroupCache(jid, "manual_clear")
}

export const clearAllGroupCache = () => {
  try {
    const keys = groupCache.keys().filter((key) => key.startsWith("group_"))
    keys.forEach((key) => groupCache.del(key))
    logger.info(`[Cache] Cleared ${keys.length} group cache entries`)
    return keys.length
  } catch (error) {
    logger.error("[Cache] Error clearing all cache:", error.message)
    return 0
  }
}

export const getCacheStats = () => {
  try {
    const stats = groupCache.getStats()
    const groupKeys = groupCache.keys().filter((key) => key.startsWith("group_"))

    return {
      keys: stats.keys,
      hits: stats.hits,
      misses: stats.misses,
      hitRate: stats.hits > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) + "%" : "0%",
      groups: groupKeys.length,
      groupKeys: groupKeys,
      activeStores: sessionStores.size,
      queuedRequests: requestQueue.length,
    }
  } catch (error) {
    logger.error("[Cache] Error getting cache stats:", error.message)
    return null
  }
}
