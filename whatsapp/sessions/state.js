import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('SESSION_STATE')

/**
 * SessionState - In-memory session state management
 * Fast access to session information without database calls
 */
export class SessionState {
  constructor() {
    this.sessions = new Map()
  }

  /**
   * Set session data
   */
  set(sessionId, data) {
    this.sessions.set(sessionId, {
      ...data,
      lastActivity: Date.now()
    })
    logger.debug(`Session state set for ${sessionId}`)
  }

  /**
   * Get session data
   */
  get(sessionId) {
    const session = this.sessions.get(sessionId)
    if (session) {
      // Update last activity on access
      session.lastActivity = Date.now()
    }
    return session
  }

  /**
   * Update session data
   */
  update(sessionId, updates) {
    if (!this.sessions.has(sessionId)) {
      logger.warn(`Attempted to update non-existent session: ${sessionId}`)
      return false
    }

    const current = this.sessions.get(sessionId)
    this.sessions.set(sessionId, {
      ...current,
      ...updates,
      lastActivity: Date.now()
    })

    logger.debug(`Session state updated for ${sessionId}`)
    return true
  }

  /**
   * Delete session data
   */
  delete(sessionId) {
    const deleted = this.sessions.delete(sessionId)
    if (deleted) {
      logger.debug(`Session state deleted for ${sessionId}`)
    }
    return deleted
  }

  /**
   * Check if session exists
   */
  has(sessionId) {
    return this.sessions.has(sessionId)
  }

  /**
   * Get all sessions
   */
  getAll() {
    return Array.from(this.sessions.entries()).map(([id, data]) => ({
      sessionId: id,
      ...data
    }))
  }

  /**
   * Get sessions by filter
   */
  getByFilter(filterFn) {
    return this.getAll().filter(filterFn)
  }

  /**
   * Get sessions by status
   */
  getByStatus(status) {
    return this.getAll().filter(session => session.connectionStatus === status)
  }

  /**
   * Get sessions by source
   */
  getBySource(source) {
    return this.getAll().filter(session => session.source === source)
  }

  /**
   * Get connected sessions
   */
  getConnected() {
    return this.getAll().filter(session => session.isConnected === true)
  }

  /**
   * Clear all session data
   */
  clear() {
    const count = this.sessions.size
    this.sessions.clear()
    logger.info(`Cleared ${count} session states`)
  }

  /**
   * Get session count
   */
  size() {
    return this.sessions.size
  }

  /**
   * Get all session IDs
   */
  keys() {
    return Array.from(this.sessions.keys())
  }

  /**
   * Get all session values
   */
  values() {
    return Array.from(this.sessions.values())
  }

  /**
   * Cleanup stale sessions (not accessed in specified time)
   */
  cleanupStale(maxAge = 3600000) { // 1 hour default
    const now = Date.now()
    let cleaned = 0

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.lastActivity && (now - session.lastActivity) > maxAge) {
        this.sessions.delete(sessionId)
        cleaned++
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} stale session states`)
    }

    return cleaned
  }

  /**
   * Get statistics
   */
  getStats() {
    const sessions = this.getAll()
    
    return {
      total: sessions.length,
      connected: sessions.filter(s => s.isConnected).length,
      disconnected: sessions.filter(s => !s.isConnected).length,
      telegram: sessions.filter(s => s.source === 'telegram' || !s.source).length,
      web: sessions.filter(s => s.source === 'web').length,
      connecting: sessions.filter(s => s.connectionStatus === 'connecting').length,
      reconnecting: sessions.filter(s => s.connectionStatus === 'reconnecting').length,
      lastActivity: sessions.length > 0 ? Math.max(...sessions.map(s => s.lastActivity || 0)) : 0
    }
  }

  /**
   * Export session data (for debugging)
   */
  export() {
    return {
      sessions: this.getAll(),
      stats: this.getStats(),
      timestamp: Date.now()
    }
  }
}