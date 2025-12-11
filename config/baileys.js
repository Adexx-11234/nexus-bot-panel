import NodeCache from "node-cache"
import { makeWASocket, Browsers } from "@whiskeysockets/baileys"
import { createFileStore, deleteFileStore, getFileStore, recordSessionActivity } from "../whatsapp/index.js"
import { logger } from "../utils/logger.js"
import pino from "pino"

const baileysLogger = pino({
  level: process.env.BAILEYS_LOG_LEVEL || "silent",
})

const groupCache = new NodeCache({
  stdTTL: 60,
  checkperiod: 5,
  useClones: false,
  maxKeys: 500,
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
  logger: pino({ level: "silent" }),
  printQRInTerminal: false,
  msgRetryCounterMap: {},
  // version: [2, 3000, 1025190524],
  retryRequestDelayMs: 250,
  markOnlineOnConnect: false,
  getMessage: defaultGetMessage,  // Default fallback
  emitOwnEvents: true,
  patchMessageBeforeSending: (msg) => {
    if (msg.contextInfo) delete msg.contextInfo.mentionedJid;
    return msg;
  },
  appStateSyncInitialTimeoutMs: 10000,
  generateHighQualityLinkPreview: true,
  // v7: Don't send ACKs to avoid bans
  sendAcks: false,
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
  "lid-mapping.update", // v7: New event for LID/PN mappings
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

    // Store original groupMetadata method
    const originalGroupMetadata = sock.groupMetadata.bind(sock)
    sock._originalGroupMetadata = originalGroupMetadata
    
    // Override groupMetadata to ALWAYS use cache-first approach
    sock.groupMetadata = async (jid) => {
      return await getGroupMetadata(sock, jid, false)
    }

    // Add refresh method - ONLY for specific scenarios
    sock.groupMetadataRefresh = async (jid) => {
      return await getGroupMetadata(sock, jid, true)
    }

    // v7: Add LID helper methods to socket
    sock.getLidForPn = async (phoneNumber) => {
      if (sock.signalRepository?.lidMapping?.getLIDForPN) {
        return await sock.signalRepository.lidMapping.getLIDForPN(phoneNumber)
      }
      return phoneNumber
    }

    sock.getPnForLid = async (lid) => {
      if (sock.signalRepository?.lidMapping?.getPNForLID) {
        return await sock.signalRepository.lidMapping.getPNForLID(lid)
      }
      return lid
    }

    // Override sendMessage with timeout and ephemeral disable
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
        const result = await Promise.race([sendPromise, timeoutPromise])
        updateSessionLastMessage(sessionId)
        return result
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

/**
 * Normalize JID - v7 compatible
 * Handles both LIDs and phone numbers
 */
const normalizeJid = (jid) => {
  if (!jid) return null
  
  // If it's already a LID, return as-is
  if (jid.endsWith('@lid')) return jid
  
  // If already has @, return as-is
  if (jid.includes('@')) return jid
  
  // Add default domain for phone numbers
  return jid.split("@")[0] + "@s.whatsapp.net"
}

/**
 * Get effective JID from participant
 * Priority: jid -> phoneNumber -> id (non-LID) -> id (LID)
 */
const getParticipantJid = (participant) => {
  if (!participant) return null
  
  // Priority 1: existing jid field
  if (participant.jid) return normalizeJid(participant.jid)
  
  // Priority 2: phoneNumber field (v7)
  if (participant.phoneNumber) return normalizeJid(participant.phoneNumber)
  
  // Priority 3: id field if it's not a LID
  if (participant.id && !participant.id.endsWith('@lid')) {
    return normalizeJid(participant.id)
  }
  
  // Priority 4: id field even if it's a LID
  if (participant.id) return participant.id
  
  return null
}

/**
 * Extract phone number from participant
 * v7: phoneNumber field, fallback to jid/id
 */
const getParticipantPhoneNumber = (participant) => {
  if (!participant) return null
  
  // Priority 1: phoneNumber field (v7)
  if (participant.phoneNumber) return normalizeJid(participant.phoneNumber)
  
  // Priority 2: jid if it's a phone number
  if (participant.jid && participant.jid.endsWith('@s.whatsapp.net')) {
    return normalizeJid(participant.jid)
  }
  
  // Priority 3: id if it's a phone number (not LID)
  if (participant.id && !participant.id.endsWith('@lid')) {
    return normalizeJid(participant.id)
  }
  
  return null
}

/**
 * Normalize participant data - ensures jid AND phoneNumber fields exist
 * v7: phoneNumber is preferred, jid is for backward compatibility
 */
const normalizeParticipantData = (participant) => {
  if (!participant) return null
  
  // Get effective JID
  const effectiveJid = getParticipantJid(participant)
  const effectivePhoneNumber = getParticipantPhoneNumber(participant)
  
  // Ensure jid field exists (backward compatibility)
  if (!participant.jid || participant.jid === '') {
    participant.jid = effectiveJid
  }
  
  // Ensure phoneNumber field exists (v7 compatibility)
  if (!participant.phoneNumber || participant.phoneNumber === '') {
    participant.phoneNumber = effectivePhoneNumber
  }
  
  // Keep original id field
  if (!participant.id) {
    participant.id = effectiveJid
  }
  
  return participant
}

/**
 * Normalize metadata - ensures all participants have jid AND phoneNumber fields
 */
const normalizeMetadata = (metadata) => {
  if (!metadata) return null
  
  if (metadata.participants && Array.isArray(metadata.participants)) {
    metadata.participants = metadata.participants
      .map(p => normalizeParticipantData(p))
      .filter(Boolean)
  }
  
  return metadata
}

/**
 * Get group metadata with caching
 * v7 compatible: Returns metadata with normalized fields
 * CACHE-FIRST: Always checks cache before fetching
 */
export const getGroupMetadata = async (sock, jid, forceRefresh = false) => {
  const cacheKey = `group_${jid}`

  try {
    // ALWAYS check cache first (unless force refresh)
    if (!forceRefresh) {
      const cachedMetadata = groupCache.get(cacheKey)
      if (cachedMetadata) {
        logger.debug(`[Cache] Returning cached metadata for ${jid}`)
        return normalizeMetadata(cachedMetadata)
      }
    }

    // If force refresh, clear cache first
    if (forceRefresh) {
      groupCache.del(cacheKey)
      logger.debug(`[Cache] Force refresh - cleared cache for ${jid}`)
    }

    // Fetch from WhatsApp
    logger.debug(`[Baileys] Fetching fresh metadata for ${jid}`)
    const fetchMethod = sock._originalGroupMetadata || sock.groupMetadata
    let metadata = await fetchMethod(jid)

    // Normalize participant data
    metadata = normalizeMetadata(metadata)

    // CRITICAL: Cache immediately after successful fetch
    groupCache.set(cacheKey, metadata, 60)
    logger.debug(`[Cache] Cached fresh metadata for ${jid}`)

    return metadata

  } catch (error) {
    // Handle rate limit errors
    if (error.message?.includes('rate-overlimit') || error.output?.statusCode === 503) {
      const cachedMetadata = groupCache.get(cacheKey)
      
      if (cachedMetadata) {
        logger.warn(`[Baileys] Rate limited for ${jid}, returning cached data`)
        return normalizeMetadata(cachedMetadata)
      }
      
      logger.error(`[Baileys] Rate limited for ${jid} and no cache available`)
      
      // Return minimal fallback structure instead of throwing
      return {
        id: jid,
        subject: 'Unknown Group (Rate Limited)',
        participants: [],
        creation: Date.now(),
        owner: null,
        desc: null,
        announce: false,
        restrict: false
      }
    }
    
    // Other errors - log and throw
    logger.error(`[Baileys] Error fetching group metadata for ${jid}:`, error.message)
    throw error
  }
}

/**
 * Refresh group metadata - ONLY use for specific scenarios
 * (participant updates: add, remove, promote, demote)
 */
export const refreshGroupMetadata = async (sock, jid) => {
  logger.debug(`[Baileys] Explicit refresh requested for ${jid}`)
  return await getGroupMetadata(sock, jid, true)
}

/**
 * Update cache from event data
 */
export const updateCacheFromEvent = (groupJid, updateData) => {
  try {
    const cacheKey = `group_${groupJid}`
    const existing = groupCache.get(cacheKey)

    if (existing) {
      const updated = { ...existing, ...updateData }
      const normalized = normalizeMetadata(updated)
      groupCache.set(cacheKey, normalized, 60)
      logger.debug(`[Cache] Updated cache from event for ${groupJid}`)
      return true
    }

    return false
  } catch (error) {
    logger.error(`[Cache] Error updating from event:`, error.message)
    return false
  }
}

/**
 * Update participants in cache - ONLY refreshes for specific actions
 */
export const updateParticipantsInCache = async (sock, groupJid, participantUpdate) => {
  try {
    const { action } = participantUpdate

    // ONLY refresh for these specific actions
    if (["add", "remove", "promote", "demote"].includes(action)) {
      logger.debug(`[Cache] Participant ${action} - refreshing ${groupJid}`)
      await sock.groupMetadataRefresh(groupJid)
      return
    }

    // For other actions, just invalidate
    logger.debug(`[Cache] Participant ${action} - invalidating ${groupJid}`)
    invalidateGroupCache(groupJid, `participant_${action}`)
  } catch (error) {
    logger.error(`[Cache] Error updating participants:`, error.message)
    invalidateGroupCache(groupJid, "update_error")
  }
}

/**
 * Invalidate cache for a group
 */
export const invalidateGroupCache = (groupJid, reason = "update") => {
  const cacheKey = `group_${groupJid}`
  if (groupCache.has(cacheKey)) {
    groupCache.del(cacheKey)
    logger.debug(`[Cache] Invalidated cache for ${groupJid} (reason: ${reason})`)
    return true
  }
  return false
}

/**
 * Check if user is group admin - v7 compatible
 * Handles missing jid field by using phoneNumber/id
 */
export const isUserGroupAdmin = async (sock, groupJid, userJid) => {
  try {
    const metadata = await getGroupMetadata(sock, groupJid)
    const normalizedUserJid = normalizeJid(userJid)

    if (!normalizedUserJid || !metadata.participants) {
      return false
    }

    // Try to get phone number if userJid is a LID
    let userPhoneNumber = userJid
    if (userJid.endsWith('@lid') && sock.getPnForLid) {
      try {
        userPhoneNumber = await sock.getPnForLid(userJid)
      } catch (err) {
        logger.debug(`[Baileys] Could not resolve LID ${userJid}`)
      }
    }

    return metadata.participants.some((participant) => {
      // Get all possible identifiers
      const participantJid = getParticipantJid(participant)
      const participantPhone = getParticipantPhoneNumber(participant)
      const participantId = participant.id || participantJid
      
      if (!participantJid) {
        logger.debug(`[Baileys] Participant has no valid JID:`, participant)
        return false
      }
      
      // Normalize all identifiers
      const normalizedParticipantJid = normalizeJid(participantJid)
      const normalizedParticipantId = normalizeJid(participantId)
      const normalizedParticipantPhone = participantPhone ? normalizeJid(participantPhone) : null
      
      // Check all possible matches
      const matches = 
        normalizedParticipantJid === normalizedUserJid ||
        normalizedParticipantJid === normalizeJid(userPhoneNumber) ||
        normalizedParticipantId === normalizedUserJid ||
        normalizedParticipantId === normalizeJid(userPhoneNumber) ||
        (normalizedParticipantPhone && normalizedParticipantPhone === normalizedUserJid) ||
        (normalizedParticipantPhone && normalizedParticipantPhone === normalizeJid(userPhoneNumber))
      
      return matches && ["admin", "superadmin"].includes(participant.admin)
    })
  } catch (error) {
    logger.error(`[Baileys] Error checking admin status:`, error.message)
    return false
  }
}

/**
 * Check if bot is group admin - v7 compatible
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

/**
 * Setup cache invalidation listeners - v7 compatible
 */
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

    // v7: Listen for LID mapping updates
    if (sock.ev.listenerCount("lid-mapping.update") === 0) {
      sock.ev.on("lid-mapping.update", (mapping) => {
        logger.debug(`[Event] LID mapping update received:`, mapping)
        
        // Ensure mapping is stored in signalRepository
        try {
          if (sock.signalRepository?.lidMapping && mapping) {
            // Store the mapping if it's not already stored
            if (mapping.lid && mapping.phoneNumber) {
              // Ensure the mapping exists in both directions
              sock.signalRepository.lidMapping.store = sock.signalRepository.lidMapping.store || new Map()
              
              logger.debug(`[LID] Storing mapping: ${mapping.lid} <-> ${mapping.phoneNumber}`)
              
              // The signalRepository should handle this automatically,
              // but we log to ensure it's working
              const storedLid = sock.signalRepository.lidMapping.getLIDForPN?.(mapping.phoneNumber)
              const storedPn = sock.signalRepository.lidMapping.getPNForLID?.(mapping.lid)
              
              if (!storedLid || !storedPn) {
                logger.warn(`[LID] Mapping not stored automatically, may need manual intervention`)
              } else {
                logger.debug(`[LID] Verified mapping stored: ${mapping.lid} <-> ${mapping.phoneNumber}`)
              }
            }
          }
        } catch (error) {
          logger.error(`[LID] Error processing LID mapping:`, error.message)
        }
      })
    }

    logger.info("[Cache] Setup group cache invalidation listeners")
  } catch (error) {
    logger.error("[Cache] Error setting up cache invalidation:", error.message)
  }
}

// ==================== CACHE MANAGEMENT ====================
export const updateGroupCache = (jid, metadata) => {
  try {
    const cacheKey = `group_${jid}`
    const normalized = normalizeMetadata(metadata)
    groupCache.set(cacheKey, normalized, 60)
    logger.debug(`[Cache] Manually updated group cache for ${jid}`)
    return true
  } catch (error) {
    logger.error("[Cache] Error updating group cache:", error.message)
    return false
  }
}

export const getGroupCache = (jid) => {
  const cacheKey = `group_${jid}`
  const cached = groupCache.get(cacheKey)
  return cached ? normalizeMetadata(cached) : null
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