import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("SESSION_LOOKUP")

/**
 * Session lookup cache - Map of remoteJid → sessionId
 * TTL: 30 seconds to stay fresh without constant lookups
 */
class SessionLookupCache {
  constructor() {
    this.cache = new Map()
    this.timestamps = new Map()
    this.TTL = 30000 // 30 seconds

    // Cleanup stale entries every 10 seconds
    setInterval(() => this._cleanup(), 10000)
  }

  /**
   * Get sessionId from remoteJid (cached)
   */
  get(remoteJid) {
    if (!remoteJid) return null

    const cached = this.cache.get(remoteJid)
    const timestamp = this.timestamps.get(remoteJid)

    if (cached && timestamp && Date.now() - timestamp < this.TTL) {
      return cached
    }

    // Expired or not found
    this.cache.delete(remoteJid)
    this.timestamps.delete(remoteJid)
    return null
  }

  /**
   * Set remoteJid → sessionId mapping
   */
  set(remoteJid, sessionId) {
    if (!remoteJid || !sessionId) return
    this.cache.set(remoteJid, sessionId)
    this.timestamps.set(remoteJid, Date.now())
  }

  /**
   * Invalidate cache for session (on disconnect)
   */
  invalidateSession(sessionId) {
    for (const [jid, sid] of this.cache) {
      if (sid === sessionId) {
        this.cache.delete(jid)
        this.timestamps.delete(jid)
      }
    }
  }

  /**
   * Cleanup expired entries
   */
  _cleanup() {
    const now = Date.now()
    for (const [jid, timestamp] of this.timestamps) {
      if (now - timestamp > this.TTL) {
        this.cache.delete(jid)
        this.timestamps.delete(jid)
      }
    }
  }

  /**
   * Clear all cache
   */
  clear() {
    this.cache.clear()
    this.timestamps.clear()
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.entries()),
    }
  }
}

const lookupCache = new SessionLookupCache()

/**
 * Get session by WhatsApp JID with cache (avoids looping all sockets)
 * CRITICAL: This replaces the slow getSessionByWhatsAppJid loop
 */
export async function getSessionByRemoteJid(remoteJid, sessionManager) {
  if (!remoteJid || !sessionManager) return null

  try {
    // 1. Check cache first (instant, no loop)
    const cachedSessionId = lookupCache.get(remoteJid)
    if (cachedSessionId) {
      const sock = sessionManager.getSession(cachedSessionId)
      if (sock) {
        logger.debug(`[Cache Hit] Found session for ${remoteJid}`)
        return { sock, sessionId: cachedSessionId }
      } else {
        // Session no longer active, invalidate cache
        lookupCache.invalidateSession(cachedSessionId)
      }
    }

    // 2. If not in cache, search active sockets
    const phoneNumber = remoteJid.split("@")[0]

    for (const [sessionId, sock] of sessionManager.activeSockets) {
      if (sock?.user?.id) {
        const sessionPhone = sock.user.id.split("@")[0]
        if (sessionPhone === phoneNumber) {
          // Cache for next time
          lookupCache.set(remoteJid, sessionId)
          logger.debug(`[Cache Miss] Found session for ${remoteJid}, cached for future`)
          return { sock, sessionId }
        }
      }
    }

    logger.warn(`[Not Found] No session found for ${remoteJid}`)
    return null
  } catch (error) {
    logger.error(`Error in getSessionByRemoteJid:`, error)
    return null
  }
}

/**
 * Update cache when socket connects
 */
export function updateSessionLookupCache(remoteJid, sessionId) {
  if (remoteJid && sessionId) {
    lookupCache.set(remoteJid, sessionId)
  }
}

/**
 * Invalidate cache on session disconnect
 */
export function invalidateSessionLookupCache(sessionId) {
  lookupCache.invalidateSession(sessionId)
}

/**
 * Get lookup cache stats
 */
export function getSessionLookupStats() {
  return lookupCache.getStats()
}

/**
 * Clear all session lookups
 */
export function clearSessionLookupCache() {
  lookupCache.clear()
}
