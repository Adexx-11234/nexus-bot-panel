import NodeCache from "node-cache"
import { makeWASocket, Browsers } from "@whiskeysockets/baileys"
import { createFileStore, deleteFileStore, getFileStore, recordSessionActivity } from "../whatsapp/index.js"
import { logger } from "../utils/logger.js"
import pino from "pino"

// ==================== LOGGER CONFIGURATION ====================
const baileysLogger = pino({
  level: process.env.BAILEYS_LOG_LEVEL || "silent",
})

// ==================== CACHE CONFIGURATION ====================
// Cache for group metadata to reduce API calls
const groupCache = new NodeCache({
  stdTTL: 60,              // Cache for 60 seconds
  checkperiod: 5,          // Check for expired keys every 5 seconds
  useClones: false,        // Better performance, no deep cloning
  maxKeys: 500,            // Maximum 500 groups cached
})

// Cache for message retry counters
const msgRetryCounterCache = new NodeCache()

// ==================== FAKE QUOTED CONFIGURATION ====================
/**
 * Fake quoted message to use instead of real messages
 * This prevents issues with message context and maintains privacy
 */
const fakeQuoted = {
  key: {
    participant: '0@s.whatsapp.net',
    remoteJid: '0@s.whatsapp.net'
  },
  message: {
    conversation: '*𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙*'
  }
}

// ==================== SESSION TRACKING ====================
const sessionLastActivity = new Map()
const sessionLastMessage = new Map()

// Session cleanup intervals
const SESSION_CLEANUP_INTERVAL = 60 * 1000        // Clean every 1 minute
const SESSION_INACTIVITY_TIMEOUT = 10 * 60 * 1000 // 10 minutes inactivity
const KEEPALIVE_INTERVAL = 5000                   // 5 seconds
const HEALTH_CHECK_TIMEOUT = 30 * 60 * 1000      // 30 minutes

// ==================== BAILEYS DEFAULT CONFIGURATION ====================
const defaultGetMessage = async (key) => {
  return undefined
}

export const baileysConfig = {
  logger: pino({ level: "silent" }),
  printQRInTerminal: false,
  msgRetryCounterMap: {},
  retryRequestDelayMs: 250,
  markOnlineOnConnect: false,
  getMessage: defaultGetMessage,
// version: [2, 3000, 1025190524], remove comments if connection open but didn't connect on WhatsApp
  emitOwnEvents: true,
  // Remove mentionedJid to avoid issues
  patchMessageBeforeSending: (msg) => {
    if (msg.contextInfo) delete msg.contextInfo.mentionedJid;
    return msg;
  },
  appStateSyncInitialTimeoutMs: 10000,
  generateHighQualityLinkPreview: true,
  // Don't send ACKs to avoid potential bans
  sendAcks: false,
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
  recordSessionActivity(sessionId)
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
  if (jid.endsWith('@lid')) return jid
  
  // If already has @, return as-is
  if (jid.includes('@')) return jid
  
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
  if (participant.id && !participant.id.endsWith('@lid')) {
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
 * This is important for v7 compatibility
 */
const normalizeParticipantData = (participant) => {
  if (!participant) return null
  
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
 * Normalize metadata - ensures all participants have required fields
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

// ==================== SOCKET CREATION ====================
/**
 * Create Baileys socket with enhanced error handling and features
 */
export function createBaileysSocket(authState, sessionId, getMessage = null) {
  try {
    const sock = makeWASocket({
      ...baileysConfig,
      auth: authState,
      getMessage: getMessage || defaultGetMessage,
      msgRetryCounterCache,
    })

    setupSocketDefaults(sock)

    // ========== GROUP METADATA OVERRIDE ==========
    // Store original groupMetadata method
    const originalGroupMetadata = sock.groupMetadata.bind(sock)
    sock._originalGroupMetadata = originalGroupMetadata
    
    /**
     * Override groupMetadata to ALWAYS use cache-first approach
     * This reduces API calls and prevents rate limiting
     */
    sock.groupMetadata = async (jid) => {
      return await getGroupMetadata(sock, jid, false)
    }

    /**
     * Add refresh method - ONLY for specific scenarios
     * Use this when you know metadata has changed (participant add/remove/promote/demote)
     */
    sock.groupMetadataRefresh = async (jid) => {
      return await getGroupMetadata(sock, jid, true)
    }

    // ========== LID HELPER METHODS (v7) ==========
    /**
     * Get LID (Linked Identifier) for a phone number
     */
    sock.getLidForPn = async (phoneNumber) => {
      if (sock.signalRepository?.lidMapping?.getLIDForPN) {
        return await sock.signalRepository.lidMapping.getLIDForPN(phoneNumber)
      }
      return phoneNumber
    }

    /**
     * Get phone number for a LID
     */
    sock.getPnForLid = async (lid) => {
      if (sock.signalRepository?.lidMapping?.getPNForLID) {
        return await sock.signalRepository.lidMapping.getPNForLID(lid)
      }
      return lid
    }

    // ========== SEND MESSAGE OVERRIDE ==========
    const originalSendMessage = sock.sendMessage.bind(sock)
    
    /**
     * Enhanced sendMessage with:
     * - Automatic fakeQuoted replacement and addition
     * - Auto-mention for group replies
     * - Timeout protection (prevents hanging)
     * - Ephemeral message control
     * - Better error handling
     * - Automatic retry on specific errors
     * - Session activity tracking
     */
    sock.sendMessage = async (jid, content, options = {}) => {
      const maxRetries = 2
      let lastError = null
      
      // ========== FAKE QUOTED MANAGEMENT ==========
      const isGroup = jid.endsWith('@g.us')
      let originalQuoted = options.quoted
      
      // Always use fakeQuoted (replace or add)
      if (originalQuoted) {
        logger.debug(`[Baileys] Replacing quoted message with fakeQuoted for ${jid}`)
        
        // If it's a group and we have the original quoted message, enhance it
        if (isGroup && originalQuoted.key?.participant) {
          const senderJid = originalQuoted.key.participant
          const pushName = originalQuoted.pushName || originalQuoted.verifiedBizName || 'User'
          
          // Create enhanced fakeQuoted with reply info
          options.quoted = {
            ...fakeQuoted,
            message: {
              conversation: `*𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙\n\nReplied to ${pushName}*`
            }
          }
          
          // Add mention of the user being replied to
          const existingMentions = options.mentions || []
          if (!existingMentions.includes(senderJid)) {
            options.mentions = [...existingMentions, senderJid]
          }
          
          logger.debug(`[Baileys] Enhanced group reply with mention for ${pushName}`)
        } else {
          // Not a group or no participant info, use standard fakeQuoted
          options.quoted = fakeQuoted
        }
      } else {
        // No quoted provided, add fakeQuoted
        logger.debug(`[Baileys] Adding fakeQuoted to message for ${jid}`)
        options.quoted = fakeQuoted
      }
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          // Disable ephemeral messages by default
          if (!options.ephemeralExpiration) {
            options.ephemeralExpiration = 0
          }
          
          // Create send promise
          const sendPromise = originalSendMessage(jid, content, options)
          
          // Create timeout promise (40 seconds)
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('sendMessage timeout after 40s')), 40000)
          )
          
          // Race between send and timeout
          const result = await Promise.race([sendPromise, timeoutPromise])
          
          // Update session activity on success
          updateSessionLastMessage(sessionId)
          
          logger.debug(`[Baileys] Message sent successfully to ${jid}`)
          return result
          
        } catch (error) {
          lastError = error
          
          // Don't retry on specific errors
          const noRetryErrors = [
            'forbidden',
            'not-authorized',
            'invalid-jid',
            'recipient-not-found'
          ]
          
          const shouldNotRetry = noRetryErrors.some(err => 
            error.message?.toLowerCase().includes(err)
          )
          
          if (shouldNotRetry) {
            logger.error(`[Baileys] Non-retryable error sending to ${jid}: ${error.message}`)
            throw error
          }
          
          // Retry on timeout or temporary errors
          if (attempt < maxRetries) {
            const delay = (attempt + 1) * 1000 // 1s, 2s
            logger.warn(`[Baileys] Send failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms: ${error.message}`)
            await new Promise(resolve => setTimeout(resolve, delay))
            continue
          }
          
          // All retries exhausted
          logger.error(`[Baileys] Failed to send message to ${jid} after ${maxRetries + 1} attempts: ${error.message}`)
          throw error
        }
      }
      
      // Should never reach here, but just in case
      throw lastError || new Error('Unknown error in sendMessage')
    }

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
    if (error.output?.statusCode === 403 || error.data === 403 || error.message?.includes('forbidden')) {
      logger.warn(`[Baileys] 403 Forbidden for ${jid} - Bot not in group or was removed`)
      
      // Clear any cached data for this group
      groupCache.del(cacheKey)
      
      // Return null to indicate bot is not in group
      // Don't throw error, let caller handle gracefully
      return null
    }
    
    // RATE LIMIT: Try to use cached data
    if (error.message?.includes('rate-overlimit') || error.output?.statusCode === 503) {
      const cachedMetadata = groupCache.get(cacheKey)
      
      if (cachedMetadata) {
        logger.warn(`[Baileys] Rate limited for ${jid}, returning cached data`)
        return normalizeMetadata(cachedMetadata)
      }
      
      logger.error(`[Baileys] Rate limited for ${jid} and no cache available`)
      
      // Return minimal fallback structure
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
    
    // UNEXPECTED ERRORS: Log and throw
    logger.error(`[Baileys] Error fetching group metadata for ${jid}:`, error.message)
    throw error
  }
}

/**
 * Refresh group metadata - ONLY use for specific scenarios
 * Use cases: participant add/remove/promote/demote
 */
export const refreshGroupMetadata = async (sock, jid) => {
  logger.debug(`[Baileys] Explicit refresh requested for ${jid}`)
  return await getGroupMetadata(sock, jid, true)
}

/**
 * Update cache from event data (groups.update events)
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
 * Actions that require refresh: add, remove, promote, demote
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
 * Invalidate (delete) cache for a specific group
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
 * Handles LID resolution and multiple identifier formats
 * 
 * @returns {boolean} - true if user is admin/superadmin, false otherwise
 */
export const isUserGroupAdmin = async (sock, groupJid, userJid) => {
  try {
    const metadata = await getGroupMetadata(sock, groupJid)
    
    // If metadata is null, bot is not in group
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
    if (userJid.endsWith('@lid') && sock.getPnForLid) {
      try {
        userPhoneNumber = await sock.getPnForLid(userJid)
      } catch (err) {
        logger.debug(`[Baileys] Could not resolve LID ${userJid}`)
      }
    }

    // Check all participants
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
      
      // Must match AND be admin or superadmin
      return matches && ["admin", "superadmin"].includes(participant.admin)
    })
  } catch (error) {
    logger.error(`[Baileys] Error checking admin status:`, error.message)
    return false
  }
}

/**
 * Check if bot is a group admin (v7 compatible)
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
 * Setup cache invalidation listeners (v7 compatible)
 * Automatically updates cache when WhatsApp events occur
 */
export const setupCacheInvalidation = (sock) => {
  try {
    // ========== GROUP PARTICIPANT UPDATES ==========
    sock.ev.on("group-participants.update", async (update) => {
      const { id, participants, action } = update
      logger.debug(`[Event] Group participants ${action}: ${id}`)

      // Only refresh cache for actions that change metadata
      if (["add", "remove", "promote", "demote"].includes(action)) {
        await updateParticipantsInCache(sock, id, update)
      }
    })

    // ========== GROUP UPDATES ==========
    sock.ev.on("groups.update", (updates) => {
      updates.forEach((update) => {
        if (update.id) {
          logger.debug(`[Event] Group update: ${update.id}`)
          
          // Invalidate cache for setting changes
          if (update.announce !== undefined || update.restrict !== undefined) {
            invalidateGroupCache(update.id, "settings_change")
          } 
          // Update cache for other changes
          else if (Object.keys(update).length > 1) {
            updateCacheFromEvent(update.id, update)
          }
        }
      })
    })

    // ========== LID MAPPING UPDATES (v7) ==========
    if (sock.ev.listenerCount("lid-mapping.update") === 0) {
      sock.ev.on("lid-mapping.update", (mapping) => {
        logger.debug(`[Event] LID mapping update received:`, mapping)
        
        try {
          if (sock.signalRepository?.lidMapping && mapping) {
            if (mapping.lid && mapping.phoneNumber) {
              // Verify mapping is stored
              const storedLid = sock.signalRepository.lidMapping.getLIDForPN?.(mapping.phoneNumber)
              const storedPn = sock.signalRepository.lidMapping.getPNForLID?.(mapping.lid)
              
              if (!storedLid || !storedPn) {
                logger.warn(`[LID] Mapping not stored automatically`)
              } else {
                logger.debug(`[LID] Verified mapping: ${mapping.lid} <-> ${mapping.phoneNumber}`)
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

// ==================== CACHE MANAGEMENT UTILITIES ====================
/**
 * Manually update group cache
 */
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

/**
 * Get cached group metadata (doesn't fetch)
 */
export const getGroupCache = (jid) => {
  const cacheKey = `group_${jid}`
  const cached = groupCache.get(cacheKey)
  return cached ? normalizeMetadata(cached) : null
}

/**
 * Clear cache for specific group
 */
export const clearGroupCache = (jid) => {
  return invalidateGroupCache(jid, "manual_clear")
}

/**
 * Clear all group cache
 */
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

/**
 * Get cache statistics
 */
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
    if (!store || typeof store.bind !== 'function') {
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