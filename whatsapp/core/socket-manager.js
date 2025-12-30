import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('SOCKET_MANAGER')

/**
 * SocketManager - Workaround for baileys' single-socket limitation
 * 
 * The baileys library (makeWASocket) uses a global __ACTIVE_SOCKET__ variable
 * that gets overwritten with each new connection. This manager intercepts
 * socket creation to preserve all socket instances in your own Map.
 */
class SocketManager {
  constructor() {
    // Store all socket instances by sessionId
    this.sockets = new Map()
    
    // Track which sessions are being initialized
    this.initializingSessions = new Set()
    
    logger.info('SocketManager initialized - managing multi-socket sessions')
  }

  /**
   * Register a new socket instance
   * @param {string} sessionId - Unique identifier for this session
   * @param {object} socket - The baileys socket instance
   * @returns {object} The socket instance
   */
  registerSocket(sessionId, socket) {
    if (!sessionId || !socket) {
      throw new Error('SocketManager: sessionId and socket are required')
    }

    // Clean up old socket if exists
    if (this.sockets.has(sessionId)) {
      logger.warn(`SocketManager: Replacing existing socket for session ${sessionId}`)
      this._cleanupSocket(sessionId)
    }

    // Store the socket
    this.sockets.set(sessionId, socket)
    logger.debug(`SocketManager: Registered socket for session ${sessionId} (total: ${this.sockets.size})`)

    return socket
  }

  /**
   * Get a socket instance by sessionId
   * @param {string} sessionId - Session identifier
   * @returns {object|null} The socket or null if not found
   */
  getSocket(sessionId) {
    return this.sockets.get(sessionId) || null
  }

  /**
   * Check if a session has an active socket
   * @param {string} sessionId - Session identifier
   * @returns {boolean}
   */
  hasSocket(sessionId) {
    return this.sockets.has(sessionId)
  }

  /**
   * Get all active sockets
   * @returns {Map} Map of sessionId -> socket
   */
  getAllSockets() {
    return new Map(this.sockets)
  }

  /**
   * Get count of active sockets
   * @returns {number}
   */
  getSocketCount() {
    return this.sockets.size
  }

  /**
   * Remove and cleanup a socket
   * @param {string} sessionId - Session identifier
   */
  removeSocket(sessionId) {
    this._cleanupSocket(sessionId)
  }

  /**
   * Internal socket cleanup
   * @private
   */
  _cleanupSocket(sessionId) {
    const socket = this.sockets.get(sessionId)
    
    if (!socket) return

    try {
      // Safely close the socket
      socket.ev?.removeAllListeners?.()
      socket.ws?.removeAllListeners?.()
      socket.ws?.terminate?.()
      socket.ws?.close?.()
    } catch (error) {
      logger.warn(`SocketManager: Error cleaning up socket for ${sessionId}:`, error.message)
    }

    this.sockets.delete(sessionId)
    this.initializingSessions.delete(sessionId)
    
    logger.debug(`SocketManager: Removed socket for session ${sessionId} (remaining: ${this.sockets.size})`)
  }

  /**
   * Mark a session as initializing
   * @param {string} sessionId - Session identifier
   */
  markInitializing(sessionId) {
    this.initializingSessions.add(sessionId)
  }

  /**
   * Unmark a session as initializing
   * @param {string} sessionId - Session identifier
   */
  unmarkInitializing(sessionId) {
    this.initializingSessions.delete(sessionId)
  }

  /**
   * Check if a session is currently initializing
   * @param {string} sessionId - Session identifier
   * @returns {boolean}
   */
  isInitializing(sessionId) {
    return this.initializingSessions.has(sessionId)
  }

  /**
   * Get all active session IDs
   * @returns {string[]}
   */
  getActiveSessions() {
    return Array.from(this.sockets.keys())
  }

  /**
   * Get statistics about active sockets
   * @returns {object}
   */
  getStats() {
    return {
      activeSocketCount: this.sockets.size,
      initializingSessions: this.initializingSessions.size,
      activeSessions: this.getActiveSessions(),
      totalSessions: this.sockets.size + this.initializingSessions.size
    }
  }

  /**
   * Clear all sockets (use with caution)
   */
  clearAll() {
    for (const sessionId of Array.from(this.sockets.keys())) {
      this._cleanupSocket(sessionId)
    }
    this.initializingSessions.clear()
    logger.info('SocketManager: All sockets cleared')
  }
}

// Create singleton instance
const socketManager = new SocketManager()

/**
 * Get the global socket manager instance
 * @returns {SocketManager}
 */
export function getSocketManager() {
  return socketManager
}

export default socketManager
