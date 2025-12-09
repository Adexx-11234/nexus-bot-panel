import NodeCache from "node-cache"
import { makeWASocket, Browsers } from "@whiskeysockets/baileys"
import { createFileStore, deleteFileStore, getFileStore, recordSessionActivity } from "../whatsapp/index.js"
import { logger } from "../utils/logger.js"
import pino from "pino"

const baileysLogger = pino({
  level: process.env.BAILEYS_LOG_LEVEL || "silent",
})

const groupCache = new NodeCache({
  stdTTL: 90,
  checkperiod: 9,
  useClones: false,
  maxKeys: 900,
})

const msgRetryCounterCache = new NodeCache()

const sessionLastActivity = new Map()
const sessionLastMessage = new Map()
const SESSION_CLEANUP_INTERVAL = 60 * 1000
const SESSION_INACTIVITY_TIMEOUT = 10 * 60 * 1000
const KEEPALIVE_INTERVAL = 5000
const HEALTH_CHECK_TIMEOUT = 30 * 60 * 1000

const defaultGetMessage = async (key) => {
  return undefined
}

export const baileysConfig = {
  logger: baileysLogger,
  printQRInTerminal: false,
  browser: Browsers.windows("safari"),
  retryRequestDelayMs: 10,
  markOnlineOnConnect: true,
  getMessage: defaultGetMessage,
  msgRetryCounterCache,
  version: [2, 3000, 1025190524],
  syncFullHistory: true,
  fireInitQueries: true,
  connectTimeoutMs: 800,
  defaultQueryTimeoutMs: 1000,
  maxMsgRetryCount: 10,
  keepAliveIntervalMs: KEEPALIVE_INTERVAL,
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
  appStateSyncInitialTimeoutMs: 500,
  generateHighQualityLinkPreview: true,
}

export function getBaileysConfig() {
  return { ...baileysConfig }
}

export const eventTypes = [
  "messages.upsert",
  "groups.update",
  "group-participants.update",
  "messages.update",
  "contacts.update",
  "call",
]

export async function createSessionStore(sessionId) {
  const store = createFileStore(sessionId)
  sessionLastActivity.set(sessionId, Date.now())
  sessionLastMessage.set(sessionId, Date.now())
  logger.debug(`[Store] Created file-based store for ${sessionId}`)
  return store
}

export function getSessionStore(sessionId) {
  sessionLastActivity.set(sessionId, Date.now())
      // Check if store already exists
  const existingStore = getFileStore(sessionId)
  if (existingStore) {
    logger.debug(`[Store] Retrieved existing store for ${sessionId}`)
    return existingStore
  }
  return createSessionStore(sessionId)
}

export async function deleteSessionStore(sessionId) {
  sessionLastActivity.delete(sessionId)
  sessionLastMessage.delete(sessionId)
  await deleteFileStore(sessionId)
  logger.debug(`[Store] Cleaned up file store for ${sessionId}`)
  return true
}

export function updateSessionLastMessage(sessionId) {
  sessionLastMessage.set(sessionId, Date.now())
  // Also notify health monitor
  recordSessionActivity(sessionId)
}

export function needsHealthCheck(sessionId) {
  const lastMsg = sessionLastMessage.get(sessionId)
  if (!lastMsg) return false
  return Date.now() - lastMsg > HEALTH_CHECK_TIMEOUT
}

export function getSessionsNeedingHealthCheck() {
  const sessions = []
  const now = Date.now()

  for (const [sessionId, lastMsg] of sessionLastMessage.entries()) {
    if (now - lastMsg > HEALTH_CHECK_TIMEOUT) {
      sessions.push(sessionId)
    }
  }

  return sessions
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
    groupCacheKeys: groupCache.getStats().keys,
    sessionsTracked: sessionLastMessage.size,
  }
}

// ==================== SOCKET CREATION ====================
export function createBaileysSocket(authState, sessionId, getMessage = null) {
  try {
    const sock = makeWASocket({
      ...baileysConfig,
      auth: authState,
      getMessage: getMessage || defaultGetMessage,
      msgRetryCounterCache,
    })

    setupSocketDefaults(sock)

    const originalGroupMetadata = sock.groupMetadata.bind(sock)
    sock._originalGroupMetadata = originalGroupMetadata
    sock.groupMetadata = async (jid) => {
      // Always return from cache, never direct call
      return await getGroupMetadata(sock, jid, false)
    }

    sock.groupMetadataRefresh = async (jid) => {
      return await getGroupMetadata(sock, jid, true)
    }

    const originalSendMessage = sock.sendMessage.bind(sock)
    sock.sendMessage = async (jid, content, options = {}) => {
      try {
        if(!options.ephemeralExpiration) {
          options.ephemeralExpiration = 0 // Disable ephemeral by default
        }
        const sendPromise = originalSendMessage(jid, content, options)
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('sendMessage timeout after 40s')), 40000)
        )
        return await Promise.race([sendPromise, timeoutPromise])
         updateSessionLastMessage(sessionId)
      } catch (error) {
        logger.error(`[Baileys] Error sending message to ${jid}:`, error.message)
        throw error
      }
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
      sock.ev.setMaxListeners(9000)
    }

    sock.sessionId = null
    sock.eventHandlersSetup = false
    sock.connectionCallbacks = null

    logger.debug("Socket defaults configured (maxListeners: 1500)")
  } catch (error) {
    logger.error("Failed to setup socket defaults:", error)
  }
}

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

    const fetchMethod = sock._originalGroupMetadata || sock.groupMetadata
    metadata = await fetchMethod(jid)

    groupCache.set(cacheKey, metadata, 60)

    return metadata
  } catch (error) {
    // ✅ If rate-limited, return cached data instead of throwing
    if (error.message?.includes('rate-overlimit')) {
      const cacheKey = `group_${jid}`
      const cachedMetadata = groupCache.get(cacheKey)
      
      if (cachedMetadata) {
        logger.warn(`[Baileys] Rate limited for ${jid}, returning cached data`)
        return cachedMetadata
      }
      
      logger.error(`[Baileys] Rate limited for ${jid} and no cache available`)
    } else {
      logger.error(`[Baileys] Error fetching group metadata for ${jid}:`, error.message)
    }
    
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
      groupCache.set(cacheKey, updated, 60)
      return true
    }

    return false
  } catch (error) {
    return false
  }
}

export const updateParticipantsInCache = async (sock, groupJid, participantUpdate) => {
  try {
    const { action } = participantUpdate

    // ✅ For add, remove, promote, demote - use existing refresh function
    if (["add", "remove", "promote", "demote"].includes(action)) {
      await sock.groupMetadataRefresh(groupJid)
      return
    }

    // For other actions, just invalidate
    invalidateGroupCache(groupJid, "update_error")
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

export const setupCacheInvalidation = (sock) => {
  try {
    sock.ev.on("group-participants.update", async (update) => {
      const { id, participants, action } = update
      logger.debug(`[Event] Group participants ${action}: ${id}`)

      if (["add", "remove", "promote", "demote"].includes(action)) {
        await updateParticipantsInCache(sock, id, update)
      }
    })

    sock.ev.on("groups.update", (updates) => {
      updates.forEach((update) => {
        if (update.id) {
          logger.debug(`[Event] Group update: ${update.id}`)
          if (update.announce !== undefined || update.restrict !== undefined) {
            invalidateGroupCache(update.id, "settings_change")
          } else if (Object.keys(update).length > 1) {
            updateCacheFromEvent(update.id, update)
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
    groupCache.set(cacheKey, metadata, 60)
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
    }
  } catch (error) {
    logger.error("[Cache] Error getting cache stats:", error.message)
    return null
  }
}

export async function bindStoreToSocket(sock, sessionId) {
  try {
    const store = await getSessionStore(sessionId)
    if (!store || typeof store.bind !== 'function') {
      logger.error(`[Store] Invalid store object for ${sessionId}`)
      return null
    }
    store.bind(sock.ev)

    sock.getMessage = async (key) => {
      try {
        const msg = await store.loadMessage(key.remoteJid, key.id)
        return msg?.message || undefined
      } catch {
        return undefined
      }
    }

    logger.debug(`[Store] Bound file-based store to socket for ${sessionId}`)
    return store
  } catch (error) {
    logger.error(`[Store] Error binding store for ${sessionId}:`, error.message)
    return null
  }
}