/**
 * Socket Factory - Multi-Socket Management Without Modifying node_modules
 * 
 * This module wraps baileys' makeWASocket to prevent socket overwriting.
 * Instead of relying on baileys' internal __ACTIVE_SOCKET__ variable,
 * we manage all sockets in our own Map and return the correct socket
 * when needed, completely bypassing baileys' global tracking.
 */

import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('SOCKET_FACTORY')

// Our own socket registry - completely independent from baileys
const socketRegistry = new Map()
const sessionStates = new Map()

/**
 * Register a socket in our registry
 * @param {string} sessionId - Unique session identifier
 * @param {object} socket - The baileys socket instance
 */
export function registerSocket(sessionId, socket) {
  if (!sessionId || !socket) {
    throw new Error('SocketFactory: sessionId and socket are required')
  }

  // Clean up old socket if exists
  if (socketRegistry.has(sessionId)) {
    logger.warn(`SocketFactory: Replacing existing socket for ${sessionId}`)
    unregisterSocket(sessionId)
  }

  socketRegistry.set(sessionId, socket)
  sessionStates.set(sessionId, {
    createdAt: Date.now(),
    lastActivity: Date.now(),
    isConnected: false,
    error: null
  })

  logger.debug(
    `SocketFactory: Registered socket for ${sessionId} ` +
    `(Total: ${socketRegistry.size})`
  )

  return socket
}

/**
 * Get a socket from our registry
 * @param {string} sessionId - Session identifier
 * @returns {object|null} The socket or null if not found
 */
export function getSocket(sessionId) {
  return socketRegistry.get(sessionId) || null
}

/**
 * Get all registered sockets
 * @returns {Map} Map of sessionId -> socket
 */
export function getAllSockets() {
  return new Map(socketRegistry)
}

/**
 * Get socket count
 * @returns {number}
 */
export function getSocketCount() {
  return socketRegistry.size
}

/**
 * Check if a session has a registered socket
 * @param {string} sessionId
 * @returns {boolean}
 */
export function hasSocket(sessionId) {
  return socketRegistry.has(sessionId)
}

/**
 * Unregister and cleanup a socket
 * @param {string} sessionId
 */
export function unregisterSocket(sessionId) {
  const socket = socketRegistry.get(sessionId)

  if (!socket) return

  try {
    // Safely close all listeners
    socket.ev?.removeAllListeners?.()
    socket.ws?.removeAllListeners?.()
    socket.ws?.terminate?.()
    socket.ws?.close?.()
  } catch (error) {
    logger.warn(`SocketFactory: Cleanup error for ${sessionId}: ${error.message}`)
  }

  socketRegistry.delete(sessionId)
  sessionStates.delete(sessionId)

  logger.debug(
    `SocketFactory: Unregistered socket for ${sessionId} ` +
    `(Remaining: ${socketRegistry.size})`
  )
}

/**
 * Update session state (connection status, activity, etc)
 * @param {string} sessionId
 * @param {object} updates
 */
export function updateSessionState(sessionId, updates) {
  const state = sessionStates.get(sessionId)
  if (state) {
    Object.assign(state, updates, { lastActivity: Date.now() })
  }
}

/**
 * Get session state
 * @param {string} sessionId
 * @returns {object|null}
 */
export function getSessionState(sessionId) {
  return sessionStates.get(sessionId) || null
}

/**
 * Get all active sessions with their states
 * @returns {object} { sessionId: state }
 */
export function getAllSessions() {
  const sessions = {}
  for (const [sessionId, state] of sessionStates.entries()) {
    sessions[sessionId] = state
  }
  return sessions
}

/**
 * Create a socket wrapper that uses our factory instead of baileys' global
 * This prevents the global __ACTIVE_SOCKET__ from interfering
 */
export function createSocketWrapper(baileysMakeWASocket) {
  return function wrappedMakeWASocket(config) {
    const sessionId = config?.sessionId || config?.auth?.sessionId

    if (!sessionId) {
      throw new Error(
        'SocketFactory: sessionId is required in config or auth. ' +
        'Pass it as: { sessionId: "user_123" }'
      )
    }

    logger.info(`SocketFactory: Creating socket for ${sessionId}`)

    // Create the socket using baileys (which will use its global var)
    // But we capture it immediately in our Map
    const socket = baileysMakeWASocket(config)

    // ✅ CRITICAL: Register in OUR registry immediately
    // This ensures we have our own reference independent of baileys' global
    registerSocket(sessionId, socket)

    // Store sessionId on the socket itself for easy reference
    socket._sessionId = sessionId

    // Setup automatic state tracking
    socket.ev.on('connection.update', (update) => {
      if (update.connection === 'open') {
        updateSessionState(sessionId, { isConnected: true, error: null })
      } else if (update.connection === 'close') {
        updateSessionState(sessionId, { isConnected: false })
      }

      if (update.lastDisconnect) {
        updateSessionState(sessionId, {
          error: update.lastDisconnect.error?.message
        })
      }
    })

    logger.info(`SocketFactory: Socket ready for ${sessionId}`)
    return socket
  }
}

/**
 * Get statistics about all managed sockets
 * @returns {object}
 */
export function getStats() {
  const stats = {
    totalSessions: socketRegistry.size,
    activeSessions: [],
    inactiveSessions: [],
    errorSessions: [],
    connectedSessions: [],
    disconnectedSessions: []
  }

  for (const [sessionId, state] of sessionStates.entries()) {
    stats.activeSessions.push({
      sessionId,
      createdAt: new Date(state.createdAt).toISOString(),
      lastActivity: new Date(state.lastActivity).toISOString(),
      isConnected: state.isConnected,
      error: state.error
    })

    if (state.isConnected) {
      stats.connectedSessions.push(sessionId)
    } else {
      stats.disconnectedSessions.push(sessionId)
    }

    if (state.error) {
      stats.errorSessions.push({ sessionId, error: state.error })
    }
  }

  return stats
}

/**
 * Force cleanup of all sockets (use with caution)
 */
export function clearAll() {
  const sessionIds = Array.from(socketRegistry.keys())
  for (const sessionId of sessionIds) {
    unregisterSocket(sessionId)
  }
  logger.warn('SocketFactory: All sockets cleared')
}

logger.info('SocketFactory initialized - managing sockets independently from baileys')
