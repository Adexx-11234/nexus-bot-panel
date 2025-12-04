import NodeCache from "node-cache"
import { makeInMemoryStore, makeWASocket, Browsers } from "@whiskeysockets/baileys"
import { logger } from "../utils/logger.js"
import pino from "pino"

const baileysLogger = pino({
  level: process.env.BAILEYS_LOG_LEVEL || "silent",
})

// ==================== GROUP CACHE ====================
const groupCache = new NodeCache({
  stdTTL: 15,
  checkperiod: 5,
  useClones: false,
  maxKeys: 500,
})

// ==================== REQUEST QUEUE ====================
const MAX_QUEUE_SIZE = 500
const requestQueue = []
let isProcessingQueue = false
const RATE_LIMIT_DELAY = 50

const pendingRequests = new Map()

// ==================== SESSION STORE MANAGEMENT ====================
const sessionLastActivity = new Map()

const SESSION_CLEANUP_INTERVAL = 2 * 60 * 1000
const SESSION_INACTIVITY_TIMEOUT = 10 * 60 * 1000

const defaultGetMessage = async (key) => {
  return undefined
}

export const baileysConfig = {
  logger: baileysLogger,
  printQRInTerminal: false,
  browser: Browsers.windows("safari"),
  retryRequestDelayMs: 1500,
  markOnlineOnConnect: true,
  getMessage: defaultGetMessage,
  version: [2, 3000, 1025190524],
  syncFullHistory: false,
  fireInitQueries: true,
  maxMsgRetryCount: 20,
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
  appStateSyncInitialTimeoutMs: 5000,
  generateHighQualityLinkPreview: false,
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
  if (isProcessingQueue) return

  isProcessingQueue = true

  while (requestQueue.length > 0) {
    const { fn, resolve, reject, key } = requestQueue.shift()
    try {
      const result = await fn()
      resolve(result)
      if (key) pendingRequests.delete(key)
    } catch (error) {
      reject(error)
      if (key) pendingRequests.delete(key)
    }

    if (requestQueue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  isProcessingQueue = false
}

export function queueRequest(fn, key = null) {
  if (key && pendingRequests.has(key)) {
    return pendingRequests.get(key)
  }

  const promise = new Promise((resolve, reject) => {
    if (requestQueue.length >= MAX_QUEUE_SIZE) {
      logger.warn(`Request queue at max capacity (${MAX_QUEUE_SIZE}), waiting...`)
    }

    requestQueue.push({ fn, resolve, reject, key })
    processRequestQueue()
  })

  if (key) {
    pendingRequests.set(key, promise)
  }

  return promise
}

// ==================== SESSION STORE MANAGEMENT ====================
export function createSessionStore(sessionId) {
  const store = makeInMemoryStore({
    logger: baileysLogger,
  })

  sessionLastActivity.set(sessionId, Date.now())
  logger.debug(`[Store] Created fresh store for ${sessionId}`)

  return store
}

export function getSessionStore(sessionId) {
  sessionLastActivity.set(sessionId, Date.now())
  return createSessionStore(sessionId)
}

export function deleteSessionStore(sessionId) {
  sessionLastActivity.delete(sessionId)
  logger.debug(`[Store] Cleaned up activity tracker for ${sessionId}`)
  return true
}

export function startSessionCleanup() {
  setInterval(() => {
    const now = Date.now()
    let cleanedCount = 0

    for (const [sessionId, lastActivity] of sessionLastActivity.entries()) {
      if (now - lastActivity > SESSION_INACTIVITY_TIMEOUT) {
        sessionLastActivity.delete(sessionId)
        cleanedCount++
      }
    }

    const cacheStats = groupCache.getStats()
    if (cacheStats.keys > 300) {
      groupCache.flushAll()
      logger.info(`[Cache] Flushed group cache (was ${cacheStats.keys} keys)`)
    }

    if (cleanedCount > 0) {
      logger.info(`[Store] Cleaned up ${cleanedCount} inactive sessions`)
    }
  }, SESSION_CLEANUP_INTERVAL)

  logger.info("[Store] Session cleanup interval started (2min)")
}

export function getSessionStoreStats() {
  return {
    activeTrackers: sessionLastActivity.size,
    queuedRequests: requestQueue.length,
    isProcessingQueue,
    groupCacheKeys: groupCache.getStats().keys,
  }
}

// ==================== SOCKET CREATION ====================
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

export function setupSocketDefaults(sock) {
  try {
    if (sock.ev && typeof sock.ev.setMaxListeners === "function") {
      sock.ev.setMaxListeners(1500)
    }

    sock.sessionId = null
    sock.eventHandlersSetup = false
    sock.connectionCallbacks = null

    logger.debug("Socket defaults configured (maxListeners: 1500)")
  } catch (error) {
    logger.error("Failed to setup socket defaults:", error)
  }
}

export function getBaileysConfig() {
  return { ...baileysConfig }
}

// ==================== CACHE FUNCTIONS ====================
export const getGroupMetadata = async (sock, jid, forceRefresh = false) => {
  try {
    const cacheKey = `group_${jid}`

    if (forceRefresh) {
      groupCache.del(cacheKey)
    }

    let metadata = groupCache.get(cacheKey)
    if (metadata) {
      return metadata
    }

    metadata = await queueRequest(() => sock.groupMetadata(jid), cacheKey)
    groupCache.set(cacheKey, metadata, 15)

    return metadata
  } catch (error) {
    logger.error(`[Baileys] Error fetching group metadata for ${jid}:`, error.message)
    throw error
  }
}

export const refreshGroupMetadata = async (sock, jid) => {
  return await getGroupMetadata(sock, jid, true)
}

export const updateCacheFromEvent = (groupJid, updateData) => {
  try {
    const cacheKey = `group_${groupJid}`
    const existing = groupCache.get(cacheKey)

    if (existing) {
      const updated = { ...existing, ...updateData }
      groupCache.set(cacheKey, updated, 15)
      return true
    }

    return false
  } catch (error) {
    return false
  }
}

export const updateParticipantsInCache = async (sock, groupJid, participantUpdate) => {
  try {
    const cacheKey = `group_${groupJid}`
    let metadata = groupCache.get(cacheKey)

    const { participants: affectedUsers, action } = participantUpdate

    if (!metadata) {
      if (action === "add" || action === "remove") {
        metadata = await queueRequest(() => sock.groupMetadata(groupJid), cacheKey)
        groupCache.set(cacheKey, metadata, 15)
        return
      }
      return
    }

    switch (action) {
      case "add": {
        const fresh = await queueRequest(() => sock.groupMetadata(groupJid), cacheKey)
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
    }

    groupCache.set(cacheKey, metadata, 15)
  } catch (error) {
    invalidateGroupCache(groupJid, "update_error")
  }
}

export const invalidateGroupCache = (groupJid, reason = "update") => {
  const cacheKey = `group_${groupJid}`
  if (groupCache.has(cacheKey)) {
    groupCache.del(cacheKey)
    return true
  }
  return false
}

// ==================== ADMIN FUNCTIONS ====================
const normalizeJid = (jid) => {
  if (!jid) return null
  return jid.split("@")[0] + "@s.whatsapp.net"
}

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
    groupCache.set(cacheKey, metadata, 15)
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
      activeTrackers: sessionLastActivity.size,
      queuedRequests: requestQueue.length,
    }
  } catch (error) {
    logger.error("[Cache] Error getting cache stats:", error.message)
    return null
  }
}

// ==================== SOCKET BINDING ====================
export function bindStoreToSocket(sock, sessionId) {
  try {
    const store = getSessionStore(sessionId)
    store.bind(sock.ev)

    sock.getMessage = async (key) => {
      try {
        const msg = await store.loadMessage(key.remoteJid, key.id)
        return msg?.message || undefined
      } catch {
        return undefined
      }
    }

    logger.debug(`[Store] Bound fresh store to socket for ${sessionId}`)
    return store
  } catch (error) {
    logger.error(`[Store] Error binding store for ${sessionId}:`, error.message)
    return null
  }
}
