import NodeCache from "node-cache"
import {
  makeWASocket as originalMakeWASocket,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DEFAULT_CONNECTION_CONFIG,
} from "@nexustechpro/baileys"
import { createFileStore, deleteFileStore, getFileStore } from "../whatsapp/index.js"
import { logger } from "../utils/logger.js"
import pino from "pino"
import { wrapBaileysSocket } from "../whatsapp/core/socket-wrapper.js"

// ✅ Wrap baileys' makeWASocket to capture ALL sockets regardless of baileys version
const makeWASocket = wrapBaileysSocket(originalMakeWASocket)

// ==================== LOGGER CONFIGURATION ====================
const baileysLogger = pino({
  level: process.env.BAILEYS_LOG_LEVEL || "silent",
})
const { version, isLatest } = await fetchLatestBaileysVersion()

// ==================== CACHE CONFIGURATION ====================
// Cache for group metadata to reduce API calls
const groupCache = new NodeCache({
  stdTTL: 60, // Cache for 60 seconds
  checkperiod: 5, // Check for expired keys every 5 seconds
  useClones: false, // Better performance, no deep cloning
  maxKeys: 500, // Maximum 500 groups cached
})

// Cache for message retry counters
const msgRetryCounterCache = new NodeCache()

// ==================== SESSION TRACKING ====================
const sessionLastActivity = new Map()
const sessionLastMessage = new Map()

// Session cleanup intervals
const SESSION_CLEANUP_INTERVAL = 60 * 1000 // Clean every 1 minute
const SESSION_INACTIVITY_TIMEOUT = 10 * 60 * 1000 // 10 minutes inactivity
const HEALTH_CHECK_TIMEOUT = 30 * 60 * 1000 // 30 minutes

// ==================== BAILEYS DEFAULT CONFIGURATION ====================

export const baileysConfig = {
  ...DEFAULT_CONNECTION_CONFIG,
  generateHighQualityLinkPreview: true,
}

export function getBaileysConfig() {
  return { ...baileysConfig }
}

// ==================== EVENT TYPES ====================
export const eventTypes = [
  "messages.upsert",
  "groups.update",
  "group-participants.update",
  "messages.update",
  "contacts.update",
  "call",
  "lid-mapping.update", // v7: LID/PN mappings
]

// ==================== SESSION STORE MANAGEMENT ====================
/**
 * Create a new session store for a given session ID
 */
export async function createSessionStore(sessionId) {
  const store = createFileStore(sessionId)
  sessionLastActivity.set(sessionId, Date.now())
  sessionLastMessage.set(sessionId, Date.now())
  logger.debug(`[Store] Created file-based store for ${sessionId}`)
  return store
}

/**
 * Get existing session store or create new one
 */
export function getSessionStore(sessionId) {
  sessionLastActivity.set(sessionId, Date.now())
  const existingStore = getFileStore(sessionId)
  if (existingStore) {
    logger.debug(`[Store] Retrieved existing store for ${sessionId}`)
    return existingStore
  }
  return createSessionStore(sessionId)
}

/**
 * Delete session store and cleanup tracking
 */
export async function deleteSessionStore(sessionId) {
  sessionLastActivity.delete(sessionId)
  sessionLastMessage.delete(sessionId)
  await deleteFileStore(sessionId)
  logger.debug(`[Store] Cleaned up file store for ${sessionId}`)
  return true
}

/**
 * Update last message timestamp for session
 */
export function updateSessionLastMessage(sessionId) {
  sessionLastMessage.set(sessionId, Date.now())
}

/**
 * ✅ CRITICAL: Always ensure keys are wrapped properly
 */
export function ensureCacheableKeys(authState) {
  if (!authState || !authState.keys) {
    return authState
  }

  // Check if already wrapped (has required methods)
  const hasRequiredMethods = typeof authState.keys.get === "function" && typeof authState.keys.set === "function"

  if (!hasRequiredMethods) {
    logger.warn("Auth keys not properly wrapped, fixing...")
    authState.keys = makeCacheableSignalKeyStore(authState.keys, pino({ level: "silent" }))
  }

  return authState
}

// ==================== ENCRYPTION/DECRYPTION ERROR PATTERNS ====================
const DECRYPTION_ERROR_PATTERNS = [
  // Standard decryption errors
  "decrypt",
  "Could not find",
  "message key",

  // libsignal specific errors
  "SessionEntry",
  "Bad MAC",
  "session_cipher",
  "libsignal",

  // Session structure errors
  "_chains",
  "registrationId",
  "currentRatchet",
  "ephemeralKeyPair",
  "indexInfo",
  "pendingPreKey",
  "baseKey",
  "remoteIdentityKey",

  // Key errors
  "pubKey",
  "privKey",
  "lastRemoteEphemeralKey",
  "previousCounter",
  "rootKey",
  "baseKeyType",
  "signedKeyId",
  "preKeyId",
  "chainKey",
  "chainType",
  "messageKeys",

  // Session state errors
  "used:",
  "created:",
  "closed:",
  "Closing",

  // Buffer errors related to encryption
  "<Buffer",
]

/**
 * Check if error is related to encryption/decryption
 */
function isEncryptionError(error) {
  if (!error) return false

  const errorMessage = error.message || error.toString() || ""
  const errorStack = error.stack || ""
  const combinedError = `${errorMessage} ${errorStack}`.toLowerCase()

  return DECRYPTION_ERROR_PATTERNS.some((pattern) => combinedError.includes(pattern.toLowerCase()))
}

/**
 * ✅ CRITICAL: Wrap socket to catch decryption errors
 */
export function wrapSocketForDecryptionErrors(sock, sessionId) {
  const originalEmit = sock.ev.emit.bind(sock.ev)

  sock.ev.emit = (event, ...args) => {
    try {
      return originalEmit(event, ...args)
    } catch (error) {
      // ✅ Catch ALL encryption/decryption related errors
      if (isEncryptionError(error)) {
        logger.warn(`Encryption error for ${sessionId} on ${event}:`, error.message)

        // ✅ CRITICAL: Request message retry from WhatsApp
        if (event === "messages.upsert" && args[0]?.messages) {
          const msg = args[0].messages[0]
          if (msg?.key && sock.sendRetryRequest) {
            logger.info(`Requesting retry for message ${msg.key.id}`)
            sock.sendRetryRequest(msg.key).catch((err) => logger.debug(`Retry request failed: ${err.message}`))
          }
        }

        return // Don't propagate error
      }

      throw error // Re-throw non-encryption errors
    }
  }

  return sock
}

/**
 * Check if session needs health check
 */
export function needsHealthCheck(sessionId) {
  const lastMsg = sessionLastMessage.get(sessionId)
  if (!lastMsg) return false
  return Date.now() - lastMsg > HEALTH_CHECK_TIMEOUT
}

/**
 * Get all sessions that need health check
 */
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

/**
 * Start automatic cleanup of inactive sessions
 */
export function startSessionCleanup() {
  setInterval(() => {
    const now = Date.now()
    let cleanedCount = 0

    // Clean up inactive session trackers
    for (const [sessionId, lastActivity] of sessionLastActivity.entries()) {
      if (now - lastActivity > SESSION_INACTIVITY_TIMEOUT) {
        sessionLastActivity.delete(sessionId)
        cleanedCount++
      }
    }

    // Flush group cache if too large
    const cacheStats = groupCache.getStats()
    if (cacheStats.keys > 300) {
      groupCache.flushAll()
      logger.info(`[Cache] Flushed group cache (was ${cacheStats.keys} keys)`)
    }

    if (cleanedCount > 0) {
      logger.info(`[Store] Cleaned up ${cleanedCount} inactive sessions`)
    }
  }, SESSION_CLEANUP_INTERVAL)

  logger.info("[Store] Session cleanup interval started")
}

/**
 * Get session store statistics
 */
export function getSessionStoreStats() {
  return {
    activeTrackers: sessionLastActivity.size,
    groupCacheKeys: groupCache.getStats().keys,
    sessionsTracked: sessionLastMessage.size,
  }
}

// ==================== JID NORMALIZATION ====================
/**
 * Normalize JID - v7 compatible
 * Handles both LIDs (Linked Identifiers) and phone numbers
 */
const normalizeJid = (jid) => {
  if (!jid) return null

  // If it's already a LID, return as-is
  if (jid.endsWith("@lid")) return jid

  // If already has @, return as-is
  if (jid.includes("@")) return jid

  // Add default domain for phone numbers
  return jid.split("@")[0] + "@s.whatsapp.net"
}

/**
 * Get effective JID from participant
 * Priority order: jid -> phoneNumber -> id (non-LID) -> id (LID)
 */
const getParticipantJid = (participant) => {
  if (!participant) return null

  // Priority 1: existing jid field
  if (participant.jid) return normalizeJid(participant.jid)

  // Priority 2: phoneNumber field (v7)
  if (participant.phoneNumber) return normalizeJid(participant.phoneNumber)

  // Priority 3: id field if it's not a LID
  if (participant.id && !participant.id.endsWith("@lid")) {
    return normalizeJid(participant.id)
  }

  // Priority 4: id field even if it's a LID
  if (participant.id) return participant.id

  return null
}

/**
 * Extract phone number from participant (v7 compatible)
 */
const getParticipantPhoneNumber = (participant) => {
  if (!participant) return null

  // Priority 1: phoneNumber field (v7)
  if (participant.phoneNumber) return normalizeJid(participant.phoneNumber)

  // Priority 2: jid if it's a phone number
  if (participant.jid && participant.jid.endsWith("@s.whatsapp.net")) {
    return normalizeJid(participant.jid)
  }

  // Priority 3: id if it's a phone number (not LID)
  if (participant.id && !participant.id.endsWith("@lid")) {
    return normalizeJid(participant.id)
  }

  return null
}

/**
 * Normalize participant data - ensures jid AND phoneNumber fields exist
 * This is important for v7 compatibility
 */
const normalizeParticipantData = (participant) => {
  if (!participant) return null

  const effectiveJid = getParticipantJid(participant)
  const effectivePhoneNumber = getParticipantPhoneNumber(participant)

  // Ensure jid field exists (backward compatibility)
  if (!participant.jid || participant.jid === "") {
    participant.jid = effectiveJid
  }

  // Ensure phoneNumber field exists (v7 compatibility)
  if (!participant.phoneNumber || participant.phoneNumber === "") {
    participant.phoneNumber = effectivePhoneNumber
  }

  // Keep original id field
  if (!participant.id) {
    participant.id = effectiveJid
  }

  return participant
}

/**
 * Normalize metadata - ensures all participants have required fields
 */
const normalizeMetadata = (metadata) => {
  if (!metadata) return null

  if (metadata.participants && Array.isArray(metadata.participants)) {
    metadata.participants = metadata.participants.map((p) => normalizeParticipantData(p)).filter(Boolean)
  }

  return metadata
}

// ==================== SOCKET CREATION ====================
/**
 * Create Baileys socket - extensions are applied via extendSocket in connection manager
 *
 * Socket capturing is handled by the wrapper, works with ANY baileys version
 */
export function createBaileysSocket(authState, sessionId, getMessage = null) {
  try {
    // Call makeWASocket (which is now wrapped to capture sockets automatically)
    // Works with any baileys version - old or new
    const sock = makeWASocket({
      ...baileysConfig,
      auth: authState,
      sessionId, // Pass sessionId if the baileys version supports it
      getMessage: getMessage || null,
      msgRetryCounterCache,
    })

    setupSocketDefaults(sock)

    // Socket extensions (sendMessage override, groupMetadata, LID helpers, media helpers)
    // are applied in connection manager via extendSocket()

    return sock
  } catch (error) {
    logger.error("Failed to create Baileys socket:", error)
    throw error
  }
}

/**
 * Setup default socket properties
 */
export function setupSocketDefaults(sock) {
  try {
    // Increase max listeners to prevent warnings
    if (sock.ev && typeof sock.ev.setMaxListeners === "function") {
      sock.ev.setMaxListeners(1500)
    }

    // Initialize custom properties
    sock.sessionId = null
    sock.eventHandlersSetup = false
    sock.connectionCallbacks = null

    logger.debug("Socket defaults configured (maxListeners: 1500)")
  } catch (error) {
    logger.error("Failed to setup socket defaults:", error)
  }
}

// ==================== GROUP METADATA MANAGEMENT ====================
/**
 * Get group metadata with intelligent caching
 * CACHE-FIRST: Always checks cache before fetching
 *
 * @param {Object} sock - Baileys socket instance
 * @param {string} jid - Group JID
 * @param {boolean} forceRefresh - Force fetch from WhatsApp (bypasses cache)
 * @returns {Object|null} - Group metadata or null if bot not in group
 * @throws {Error} - Only throws on unexpected errors, not on 403
 */
export const getGroupMetadata = async (sock, jid, forceRefresh = false) => {
  const cacheKey = `group_${jid}`

  try {
    // ========== CACHE CHECK ==========
    // Always check cache first (unless force refresh requested)
    if (!forceRefresh) {
      const cachedMetadata = groupCache.get(cacheKey)
      if (cachedMetadata) {
        logger.debug(`[Cache] Returning cached metadata for ${jid}`)
        return normalizeMetadata(cachedMetadata)
      }
    }

    // ========== FORCE REFRESH ==========
    // Clear cache if force refresh requested
    if (forceRefresh) {
      groupCache.del(cacheKey)
      logger.debug(`[Cache] Force refresh - cleared cache for ${jid}`)
    }

    // ========== FETCH FROM WHATSAPP ==========
    logger.debug(`[Baileys] Fetching fresh metadata for ${jid}`)
    const fetchMethod = sock._originalGroupMetadata || sock.groupMetadata
    let metadata = await fetchMethod(jid)

    // Normalize participant data for v7 compatibility
    metadata = normalizeMetadata(metadata)

    // Cache the fresh metadata
    groupCache.set(cacheKey, metadata, 60)
    logger.debug(`[Cache] Cached fresh metadata for ${jid}`)

    return metadata
  } catch (error) {
    // ========== ERROR HANDLING ==========

    // 403 FORBIDDEN: Bot not in group or removed
    if (error.output?.statusCode === 403 || error.data === 403 || error.message?.includes("forbidden")) {
      logger.warn(`[Baileys] 403 Forbidden for ${jid} - Bot not in group or was removed`)

      // Clear any cached data for this group
      groupCache.del(cacheKey)

      // Return null to indicate bot is not in group
      return null
    }

    // RATE LIMIT: Try to use cached data
    if (error.message?.includes("rate-overlimit") || error.output?.statusCode === 503) {
      const cachedMetadata = groupCache.get(cacheKey)

      if (cachedMetadata) {
        logger.warn(`[Baileys] Rate limited for ${jid}, returning cached data`)
        return normalizeMetadata(cachedMetadata)
      }

      logger.error(`[Baileys] Rate limited for ${jid} and no cache available`)

      // Return minimal fallback structure
      return {
        id: jid,
        subject: "Unknown Group (Rate Limited)",
        participants: [],
        creation: Date.now(),
        owner: null,
        desc: null,
        announce: false,
        restrict: false,
      }
    }

    // UNEXPECTED ERRORS: Log and throw
    logger.error(`[Baileys] Error fetching group metadata for ${jid}:`, error.message)
    throw error
  }
}

/**
 * Refresh group metadata - ONLY use for specific scenarios
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
 * Update participants in cache
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
 * Invalidate cache for a specific group
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

// ==================== ADMIN CHECKING ====================
/**
 * Check if a user is a group admin (v7 compatible)
 */
export const isUserGroupAdmin = async (sock, groupJid, userJid) => {
  try {
    const metadata = await getGroupMetadata(sock, groupJid)

    if (!metadata || !metadata.participants) {
      logger.warn(`[Baileys] Cannot check admin - bot not in group ${groupJid}`)
      return false
    }

    const normalizedUserJid = normalizeJid(userJid)

    if (!normalizedUserJid) {
      return false
    }

    // Try to resolve LID to phone number
    let userPhoneNumber = userJid
    if (userJid.endsWith("@lid") && sock.getPnForLid) {
      try {
        userPhoneNumber = await sock.getPnForLid(userJid)
      } catch (err) {
        logger.debug(`[Baileys] Could not resolve LID ${userJid}`)
      }
    }

    // Check all participants
    return metadata.participants.some((participant) => {
      const participantJid = getParticipantJid(participant)
      const participantPhone = getParticipantPhoneNumber(participant)
      const participantId = participant.id || participantJid

      if (!participantJid) {
        return false
      }

      const normalizedParticipantJid = normalizeJid(participantJid)
      const normalizedParticipantId = normalizeJid(participantId)
      const normalizedParticipantPhone = participantPhone ? normalizeJid(participantPhone) : null

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

    // The Baileys event buffer doesn't implement standard EventEmitter methods
    try {
      sock.ev.on("lid-mapping.update", (mapping) => {
        logger.debug(`[Event] LID mapping update received:`, mapping)
      })
    } catch (err) {
      logger.debug(`[Cache] LID mapping listener already exists or failed to add: ${err.message}`)
    }

    logger.info("[Cache] Setup group cache invalidation listeners")
  } catch (error) {
    logger.error("[Cache] Error setting up cache invalidation:", error.message)
  }
}

// ==================== CACHE UTILITIES ====================
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

// ==================== STORE BINDING ====================
/**
 * Bind store to socket and setup message retrieval
 */
export async function bindStoreToSocket(sock, sessionId) {
  try {
    const store = await getSessionStore(sessionId)
    if (!store || typeof store.bind !== "function") {
      logger.error(`[Store] Invalid store object for ${sessionId}`)
      return null
    }

    store.bind(sock.ev)

    // Setup message retrieval from store
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

// ==================== NEWSLETTER HELPERS (Baileys v7) ====================
/**
 * Follow a WhatsApp newsletter/channel (Baileys v7+)
 */
export async function followNewsletter(sock, newsletterJid) {
  try {
    if (!sock.newsletterFollow) {
      logger.warn(`[Newsletter] Socket doesn't have newsletterFollow method (old Baileys version?)`)
      return false
    }

    const result = await sock.newsletterFollow(newsletterJid)
    logger.info(`[Newsletter] Successfully followed: ${newsletterJid}`)
    return result
  } catch (error) {
    logger.error(`[Newsletter] Error following ${newsletterJid}:`, error.message)
    return null
  }
}

/**
 * Check if already following a newsletter
 */
export async function isFollowingNewsletter(sock, newsletterJid) {
  try {
    if (!sock.newsletterMetadata) {
      logger.warn(`[Newsletter] Socket doesn't have newsletterMetadata method`)
      return false
    }

    const metadata = await sock.newsletterMetadata("jid", newsletterJid)
    return metadata !== null
  } catch (error) {
    logger.error(`[Newsletter] Error checking follow status for ${newsletterJid}:`, error.message)
    return false
  }
}

/**
 * Get newsletter metadata
 */
export async function getNewsletterMetadata(sock, newsletterJid) {
  try {
    if (!sock.newsletterMetadata) {
      logger.warn(`[Newsletter] Socket doesn't have newsletterMetadata method`)
      return null
    }

    const metadata = await sock.newsletterMetadata("jid", newsletterJid)
    return metadata
  } catch (error) {
    logger.error(`[Newsletter] Error getting metadata for ${newsletterJid}:`, error.message)
    return null
  }
}

/**
 * List all newsletters user is following
 */
export async function getFollowedNewsletters(sock) {
  try {
    if (!sock.ev) {
      logger.warn(`[Newsletter] Socket doesn't have event emitter`)
      return []
    }

    // Note: Baileys v7 doesn't have a direct method to list all newsletters
    // You need to track them manually or use the newsletter-related events
    logger.info(`[Newsletter] Use newsletter events to track followed newsletters`)
    return []
  } catch (error) {
    logger.error(`[Newsletter] Error getting newsletters:`, error.message)
    return []
  }
}

// ==================== LID MAPPING SUPPORT (Baileys v7) ====================
/**
 * Get LID for a phone number using Baileys v7 signal repository
 */
export async function getLIDForPN(sock, phoneNumber) {
  try {
    if (!phoneNumber || !phoneNumber.includes("@")) {
      logger.warn(`[LID] Invalid phone number format: ${phoneNumber}`)
      return null
    }

    // Baileys v7: Use signal repository
    if (sock.signalRepository?.lidMapping?.getLIDForPN) {
      const lid = await sock.signalRepository.lidMapping.getLIDForPN(phoneNumber)
      if (lid) {
        logger.debug(`[LID] Resolved PN to LID: ${phoneNumber} -> ${lid}`)
        return lid
      }
    }

    logger.debug(`[LID] Could not resolve LID for ${phoneNumber}`)
    return null
  } catch (error) {
    logger.debug(`[LID] Error getting LID for PN:`, error.message)
    return null
  }
}

/**
 * Get PN (phone number) for a LID using Baileys v7 signal repository
 */
export async function getPNForLID(sock, lid) {
  try {
    if (!lid || !lid.includes("@")) {
      logger.warn(`[LID] Invalid LID format: ${lid}`)
      return null
    }

    // Baileys v7: Use signal repository
    if (sock.signalRepository?.lidMapping?.getPNForLID) {
      const pn = await sock.signalRepository.lidMapping.getPNForLID(lid)
      if (pn && pn.includes("@s.whatsapp.net")) {
        logger.debug(`[LID] Resolved LID to PN: ${lid} -> ${pn}`)
        return pn
      }
    }

    logger.debug(`[LID] Could not resolve PN for ${lid}`)
    return null
  } catch (error) {
    logger.debug(`[LID] Error getting PN for LID:`, error.message)
    return null
  }
}

/**
 * Batch resolve multiple phone numbers to LIDs (Baileys v7)
 */
export async function getLIDsForPNs(sock, phoneNumbers) {
  try {
    if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
      return []
    }

    // Baileys v7: Use batch method if available
    if (sock.signalRepository?.lidMapping?.getLIDsForPNs) {
      const result = await sock.signalRepository.lidMapping.getLIDsForPNs(phoneNumbers)
      if (result && result.length > 0) {
        logger.debug(`[LID] Batch resolved ${result.length} PNs to LIDs`)
        return result
      }
    }

    // Fallback: resolve one by one
    const results = []
    for (const pn of phoneNumbers) {
      const lid = await getLIDForPN(sock, pn)
      if (lid) results.push(lid)
    }
    return results
  } catch (error) {
    logger.debug(`[LID] Error batch resolving PNs:`, error.message)
    return []
  }
}

/**
 * Check if a JID is in LID format (@lid)
 */
export function isLIDFormat(jid) {
  return jid && typeof jid === "string" && jid.endsWith("@lid")
}

/**
 * Check if a JID is in PN format (@s.whatsapp.net)
 */
export function isPNFormat(jid) {
  return jid && typeof jid === "string" && jid.endsWith("@s.whatsapp.net")
}

/**
 * Extract phone number from JID (works for both PN and LID via metadata)
 * Note: LIDs cannot be directly converted - need signal repository or metadata
 */
export function extractPhoneFromJID(jid) {
  try {
    if (!jid || typeof jid !== "string") return null

    const parts = jid.split("@")
    if (parts.length !== 2) return null

    const number = parts[0]

    // If it's a PN, extract and format
    if (jid.endsWith("@s.whatsapp.net")) {
      return `+${number}` // Return with + prefix
    }

    // If it's a LID, we can't extract phone number directly
    if (jid.endsWith("@lid")) {
      logger.debug(`[LID] Cannot extract phone from LID ${jid} - use signal repository`)
      return null
    }

    return null
  } catch (error) {
    logger.debug(`[LID] Error extracting phone from JID:`, error.message)
    return null
  }
}

/**
 * Clean JID format - remove device ID suffix (:0, :1, etc)
 * WhatsApp v7 adds device identifiers like "123@s.whatsapp.net:0"
 * This removes them for consistent formatting
 */
export function cleanJID(jid) {
  try {
    if (!jid || typeof jid !== "string") return jid

    // Remove device identifier suffix (e.g., :0, :1 from PN format)
    if (jid.includes(":") && jid.includes("@")) {
      const [baseJid] = jid.split(":") // Split by : and take first part
      return baseJid
    }

    return jid
  } catch (error) {
    logger.debug(`[JID] Error cleaning JID:`, error.message)
    return jid
  }
}
