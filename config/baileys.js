import NodeCache from "node-cache"
import { Browsers } from "@whiskeysockets/baileys"
import { logger } from "../utils/logger.js"
import pino from "pino"

// Baileys silent logger
const baileysLogger = pino({ 
  level: process.env.BAILEYS_LOG_LEVEL || 'silent'
})

// Group cache
const groupCache = new NodeCache({ 
  stdTTL: 1800,
  checkperiod: 300,
  useClones: false
})

export const baileysConfig = {
  logger: baileysLogger,
  printQRInTerminal: false,
  
  // 🔥 CRITICAL: Message retry counter to prevent duplicates
  msgRetryCounterCache: new NodeCache(),
  
  browser: Browsers.windows('safari'),
  retryRequestDelayMs: 250,
  
  // 🔥 Keep connection alive
  markOnlineOnConnect: false,
  emitOwnEvents: true,
  
  // 🔥 IMPORTANT: Sync settings
  syncFullHistory: false, // Don't sync full history (reduces load)
  
  // 🔥 getMessage handler to load messages from store (prevents decryption errors)
  getMessage: async (key) => {
    // Return undefined if not found - Baileys will handle it
    return undefined
  },
  
  patchMessageBeforeSending: (msg) => {
    if (msg.contextInfo) delete msg.contextInfo.mentionedJid;
    return msg;
  },
  
  generateHighQualityLinkPreview: true,
  
  // 🔥 Connection keepalive settings
  keepAliveIntervalMs: 30000, // Ping every 30 seconds
  connectTimeoutMs: 60000, // 60 second connection timeout
  
  // 🔥 Default query timeout
  defaultQueryTimeoutMs: 60000
}
export const eventTypes = [
  "messages.upsert",
  "groups.update", 
  "group-participants.update",
  "messages.update",
  "contacts.update",
  "call",
]

// Smart group cache with real-time invalidation
export const getGroupMetadata = async (sock, jid) => {
  try {
    const cacheKey = `group_${jid}`
    let metadata = groupCache.get(cacheKey)
    
    if (!metadata) {
      metadata = await sock.groupMetadata(jid)
      // Cache with shorter TTL for groups with recent activity
      groupCache.set(cacheKey, metadata, 900) // 15 minutes
      logger.debug(`[Cache] Fetched and cached group metadata: ${jid}`)
    }
    
    return metadata
  } catch (error) {
    logger.error(`[Baileys] Error fetching group metadata for ${jid}:`, error.message)
    throw error
  }
}

// Add this function to config/baileys.js

/**
 * Proactively update cache from group events (doesn't hit rate limits)
 * This is called from event handlers to keep cache fresh
 */
export const updateCacheFromEvent = (groupJid, updateData) => {
  try {
    const cacheKey = `group_${groupJid}`
    const existing = groupCache.get(cacheKey)
    
    if (existing) {
      // Merge update data with existing cache
      const updated = { ...existing, ...updateData }
      groupCache.set(cacheKey, updated, 900) // 15 minutes
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
 * This prevents rate limit issues by using event data
 */
export const updateParticipantsInCache = async (sock, groupJid, participantUpdate) => {
  try {
    const cacheKey = `group_${groupJid}`
    let metadata = groupCache.get(cacheKey)
    
    if (!metadata) {
      // Cache miss - fetch and store
      metadata = await sock.groupMetadata(groupJid)
      groupCache.set(cacheKey, metadata, 900)
      logger.debug(`[Cache] Fetched metadata for participants update: ${groupJid}`)
      return
    }
    
    const { participants: affectedUsers, action } = participantUpdate
    
    // Update participants based on action
    if (action === 'add') {
      // Fetch fresh data for new participants
      const fresh = await sock.groupMetadata(groupJid)
      metadata.participants = fresh.participants
    } else if (action === 'remove') {
      // Remove participants from cache
      metadata.participants = metadata.participants.filter(
        p => !affectedUsers.includes(p.id) && !affectedUsers.includes(p.jid)
      )
    } else if (action === 'promote' || action === 'demote') {
      // Update admin status
      const newRole = action === 'promote' ? 'admin' : null
      metadata.participants = metadata.participants.map(p => {
        if (affectedUsers.includes(p.id) || affectedUsers.includes(p.jid)) {
          return { ...p, admin: newRole }
        }
        return p
      })
    }
    
    // Update cache
    groupCache.set(cacheKey, metadata, 900)
    logger.debug(`[Cache] Updated participants cache for ${groupJid} (${action})`)
    
  } catch (error) {
    logger.error(`[Cache] Error updating participants in cache:`, error.message)
    // On error, just invalidate to fetch fresh next time
    invalidateGroupCache(groupJid, 'update_error')
  }
}

// Invalidate group cache on participant updates
export const invalidateGroupCache = (groupJid, reason = 'update') => {
  const cacheKey = `group_${groupJid}`
  if (groupCache.has(cacheKey)) {
    groupCache.del(cacheKey)
    logger.debug(`[Cache] Invalidated group cache: ${groupJid} (${reason})`)
  }
}

// Force refresh group data and update cache
export const refreshGroupMetadata = async (sock, jid) => {
  try {
    invalidateGroupCache(jid, 'forced_refresh')
    return await getGroupMetadata(sock, jid)
  } catch (error) {
    logger.error(`[Baileys] Error refreshing group metadata: ${error.message}`)
    throw error
  }
}

export const isUserGroupAdmin = async (sock, groupJid, userJid) => {
  try {
    const metadata = await getGroupMetadata(sock, groupJid)
    const normalizedUserJid = userJid.split('@')[0] + '@s.whatsapp.net'
    
    return metadata.participants?.some(participant => {
      const normalizedParticipantJid = participant.jid.split('@')[0] + '@s.whatsapp.net'
      return normalizedParticipantJid === normalizedUserJid && 
             ['admin', 'superadmin'].includes(participant.admin)
    }) || false
  } catch (error) {
    logger.error(`[Baileys] Error checking admin status:`, error.message)
    return false
  }
}

export const isBotGroupAdmin = async (sock, groupJid) => {
  try {
    if (!sock.user?.id) return false
    const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net'
    return await isUserGroupAdmin(sock, groupJid, botJid)
  } catch (error) {
    logger.error(`[Baileys] Error checking bot admin status:`, error.message)
    return false
  }
}

// Setup cache invalidation listeners
export const setupCacheInvalidation = (sock) => {
  // Invalidate cache when group participants change
  sock.ev.on('group-participants.update', ({ id, participants, action }) => {
    invalidateGroupCache(id, `participants_${action}`)
  })
  
  // Invalidate cache when group settings change
  sock.ev.on('groups.update', (updates) => {
    updates.forEach(update => {
      if (update.id) {
        invalidateGroupCache(update.id, 'group_update')
      }
    })
  })
  
  logger.debug('[Cache] Setup group cache invalidation listeners')
}



// Legacy function for backward compatibility
export const clearGroupCache = (jid) => {
  invalidateGroupCache(jid, 'manual_clear')
}

export const updateGroupCache = (jid, metadata) => {
  const cacheKey = `group_${jid}`
  groupCache.set(cacheKey, metadata, 900) // 15 minutes
  logger.debug(`[Cache] Updated group cache for ${jid}`)
}

export const getGroupCache = (jid) => {
  const cacheKey = `group_${jid}`
  return groupCache.get(cacheKey)
}

// Cache management utilities
export const clearAllGroupCache = () => {
  const keys = groupCache.keys().filter(key => key.startsWith('group_'))
  keys.forEach(key => groupCache.del(key))
  logger.debug(`[Cache] Cleared ${keys.length} group cache entries`)
}

export const getCacheStats = () => {
  return {
    keys: groupCache.getStats().keys,
    hits: groupCache.getStats().hits,
    misses: groupCache.getStats().misses,
    groups: groupCache.keys().filter(key => key.startsWith('group_')).length
  }
}