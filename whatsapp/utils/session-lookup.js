import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("SESSION_LOOKUP")

/**
 * Session lookup cache - Map of remoteJid → sessionId
 * Reduced TTL from 60s to 30s, faster cleanup
 */
class SessionLookupCache {
  constructor() {
    this.cache = new Map()
    this.timestamps = new Map()
    this.TTL = 30000 // 30 seconds
    this.maxSize = 200

    setInterval(() => this._cleanup(), 15000)
  }

  get(remoteJid) {
    if (!remoteJid) return null

    const cached = this.cache.get(remoteJid)
    const timestamp = this.timestamps.get(remoteJid)

    if (cached && timestamp && Date.now() - timestamp < this.TTL) {
      return cached
    }

    this.cache.delete(remoteJid)
    this.timestamps.delete(remoteJid)
    return null
  }

  set(remoteJid, sessionId) {
    if (!remoteJid || !sessionId) return

    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry
      const oldestJid = Array.from(this.timestamps.entries()).sort((a, b) => a[1] - b[1])[0]?.[0]
      if (oldestJid) {
        this.cache.delete(oldestJid)
        this.timestamps.delete(oldestJid)
      }
    }

    this.cache.set(remoteJid, sessionId)
    this.timestamps.set(remoteJid, Date.now())

    setTimeout(() => {
      this.cache.delete(remoteJid)
      this.timestamps.delete(remoteJid)
    }, this.TTL)
  }

  invalidateSession(sessionId) {
    for (const [jid, sid] of this.cache) {
      if (sid === sessionId) {
        this.cache.delete(jid)
        this.timestamps.delete(jid)
      }
    }
  }

  _cleanup() {
    const now = Date.now()
    let removed = 0

    for (const [jid, timestamp] of this.timestamps) {
      if (now - timestamp > this.TTL) {
        this.cache.delete(jid)
        this.timestamps.delete(jid)
        removed++
      }
    }

    if (this.cache.size > this.maxSize) {
      const entries = Array.from(this.timestamps.entries()).sort((a, b) => a[1] - b[1])
      const toRemove = entries.slice(0, this.cache.size - 100)
      toRemove.forEach(([jid]) => {
        this.cache.delete(jid)
        this.timestamps.delete(jid)
        removed++
      })
    }

    if (removed > 0) {
      logger.debug(`[SessionLookup] Cleaned ${removed} entries (remaining: ${this.cache.size})`)
    }
  }

  clear() {
    this.cache.clear()
    this.timestamps.clear()
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.TTL,
    }
  }
}

const lookupCache = new SessionLookupCache()

export async function getSessionByRemoteJid(remoteJid, sessionManager) {
  if (!remoteJid || !sessionManager) return null

  try {
    const cachedSessionId = lookupCache.get(remoteJid)
    if (cachedSessionId) {
      const sock = sessionManager.getSession(cachedSessionId)
      if (sock) {
        return { sock, sessionId: cachedSessionId }
      } else {
        lookupCache.invalidateSession(cachedSessionId)
      }
    }

    const phoneNumber = remoteJid.split("@")[0]

    for (const [sessionId, sock] of sessionManager.activeSockets) {
      if (sock?.user?.id) {
        const sessionPhone = sock.user.id.split("@")[0]
        if (sessionPhone === phoneNumber) {
          lookupCache.set(remoteJid, sessionId)
          return { sock, sessionId }
        }
      }
    }

    return null
  } catch (error) {
    logger.error(`Error in getSessionByRemoteJid:`, error)
    return null
  }
}

export function updateSessionLookupCache(remoteJid, sessionId) {
  if (remoteJid && sessionId) {
    lookupCache.set(remoteJid, sessionId)
  }
}

export function invalidateSessionLookupCache(sessionId) {
  lookupCache.invalidateSession(sessionId)
}

export function getSessionLookupStats() {
  return lookupCache.getStats()
}

export function clearSessionLookupCache() {
  lookupCache.clear()
}
