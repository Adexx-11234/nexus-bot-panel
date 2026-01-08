/**
 * Socket Wrapper - Version-Agnostic Multi-Socket Management
 * 
 * Works with ANY baileys version (old, new, with/without sessionId support)
 * Captures sockets immediately after creation and stores in our own Map
 * Complete independence from baileys' internal implementation
 */

import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('SOCKET_WRAPPER')

// Our own socket registry - completely independent
const socketRegistry = new Map()

/**
 * Wrap baileys makeWASocket to capture ALL sockets automatically
 * Works with any baileys version
 */
export function wrapBaileysSocket(originalMakeWASocket) {
  return function wrappedMakeWASocket(config) {
    // Extract sessionId from various possible locations
    const sessionId = 
      config?.sessionId || 
      config?.auth?.sessionId || 
      config?.phone ||
      config?.auth?.phone ||
      `socket_${Date.now()}`

    logger.info(`Creating socket for session: ${sessionId}`)

    // ✅ FIX: Call with BOTH config AND sessionId parameter
    // Works with old version (ignores 2nd param) AND new version (uses it)
    const socket = originalMakeWASocket(config, sessionId)

    // Store in our registry
    socketRegistry.set(sessionId, {
      socket,
      sessionId,
      createdAt: Date.now(),
      isConnected: false
    })

    logger.debug(
      `Socket captured for ${sessionId} (Total sockets: ${socketRegistry.size})`
    )

    return socket
  }
}

/**
 * Get a socket by sessionId
 */
export function getSocket(sessionId) {
  const entry = socketRegistry.get(sessionId)
  return entry?.socket || null
}

/**
 * Get all sockets
 */
export function getAllSockets() {
  const sockets = new Map()
  for (const [sessionId, entry] of socketRegistry.entries()) {
    sockets.set(sessionId, entry.socket)
  }
  return sockets
}

/**
 * Get socket count
 */
export function getSocketCount() {
  return socketRegistry.size
}

/**
 * Get all sessions with metadata
 */
export function getAllSessions() {
  return new Map(socketRegistry)
}

/**
 * Get session info
 */
export function getSessionInfo(sessionId) {
  return socketRegistry.get(sessionId) || null
}

/**
 * Update connection status
 */
export function updateConnectionStatus(sessionId, isConnected) {
  const entry = socketRegistry.get(sessionId)
  if (entry) {
    entry.isConnected = isConnected
    entry.lastUpdate = Date.now()
  }
}

/**
 * Remove a socket
 */
export function removeSocket(sessionId) {
  const entry = socketRegistry.get(sessionId)
  if (entry) {
    try {
      entry.socket.ev?.removeAllListeners?.()
      entry.socket.ws?.removeAllListeners?.()
      entry.socket.ws?.terminate?.()
      entry.socket.ws?.close?.()
    } catch (e) {
      logger.warn(`Error cleaning up socket ${sessionId}: ${e.message}`)
    }
    socketRegistry.delete(sessionId)
    logger.debug(`Socket removed for ${sessionId} (Remaining: ${socketRegistry.size})`)
  }
}

/**
 * Get statistics
 */
export function getStats() {
  const connected = Array.from(socketRegistry.values()).filter(e => e.isConnected)
  const disconnected = Array.from(socketRegistry.values()).filter(e => !e.isConnected)

  return {
    totalSockets: socketRegistry.size,
    connectedCount: connected.length,
    disconnectedCount: disconnected.length,
    sessions: Array.from(socketRegistry.entries()).map(([sessionId, entry]) => ({
      sessionId,
      isConnected: entry.isConnected,
      createdAt: new Date(entry.createdAt).toISOString(),
      lastUpdate: entry.lastUpdate ? new Date(entry.lastUpdate).toISOString() : null
    }))
  }
}

logger.info('Socket wrapper initialized - compatible with any baileys version')
