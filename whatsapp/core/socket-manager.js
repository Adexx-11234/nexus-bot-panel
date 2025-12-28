/**
 * Socket Manager - Patches baileys to support multiple concurrent sockets
 * 
 * PROBLEM: baileys/lib/Socket/index.js has a global __ACTIVE_SOCKET__ that:
 * - Stores only ONE socket at a time
 * - Terminates previous socket when new one is created
 * - Removes all listeners from old socket
 * - Causes old sessions to stop receiving messages
 * 
 * SOLUTION: Replace the makeWASocket function with a patched version that:
 * - Maintains a Map of sockets keyed by sessionId
 * - Never terminates previous sockets
 * - Allows all sessions to remain active simultaneously
 */

import { createComponentLogger } from '../../utils/logger.js'
import { makeBusinessSocket } from '@whiskeysockets/baileys/lib/Socket/business.js'
import { DEFAULT_CONNECTION_CONFIG } from '@whiskeysockets/baileys/lib/Defaults/index.js'
import { baileysConfig } from '../../config/baileys.js'

const logger = createComponentLogger('SOCKET_MANAGER')

// 🔑 Store sockets by sessionId instead of global variable
const ACTIVE_SOCKETS = new Map()

/**
 * Get all active sockets
 */
export function getActiveSockets() {
  return ACTIVE_SOCKETS
}

/**
 * Get a specific socket by sessionId
 */
export function getSocket(sessionId) {
  return ACTIVE_SOCKETS.get(sessionId)
}

/**
 * Get socket count
 */
export function getSocketCount() {
  return ACTIVE_SOCKETS.size
}

/**
 * List all active session IDs
 */
export function listActiveSessions() {
  return Array.from(ACTIVE_SOCKETS.keys())
}

/**
 * Remove a socket from tracking (cleanup)
 */
export function removeSocket(sessionId) {
  if (ACTIVE_SOCKETS.has(sessionId)) {
    ACTIVE_SOCKETS.delete(sessionId)
    logger.info(`Socket removed from tracking for ${sessionId}, remaining: ${ACTIVE_SOCKETS.size}`)
    return true
  }
  return false
}

/**
 * PATCHED makeWASocket - Replaces baileys' version to support multiple sockets
 * 
 * This is the core fix that prevents socket termination
 */
export function createPatchedMakeWASocket() {
  return function makeWASocket(config) {
    try {
      // Extract sessionId from config - important for tracking
      const sessionId = config.sessionId || `socket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      
      logger.debug(`Creating socket for session: ${sessionId}`)
      
      // ✅ KEY FIX: Do NOT terminate previous sockets
      // The original code does this - we skip it entirely:
      // if (__ACTIVE_SOCKET__) {
      //   __ACTIVE_SOCKET__.ev?.removeAllListeners?.()
      //   __ACTIVE_SOCKET__.ws?.removeAllListeners?.()
      //   __ACTIVE_SOCKET__.ws?.terminate?.()
      //   __ACTIVE_SOCKET__.ws?.close?.()
      //   __ACTIVE_SOCKET__ = null
      // }
      
      // Create the socket normally
      // ✅ Merge DEFAULT_CONNECTION_CONFIG (connection params) + baileysConfig (custom settings)
      const sock = makeBusinessSocket({
        ...DEFAULT_CONNECTION_CONFIG,
        ...baileysConfig,
        ...config,
        sessionId // Pass sessionId through config
      })
      
      // ✅ Store in Map keyed by sessionId instead of global
      ACTIVE_SOCKETS.set(sessionId, sock)
      
      // Store sessionId on socket for reference
      sock._managedSessionId = sessionId
      
      logger.info(`Socket created and tracked for ${sessionId} (${ACTIVE_SOCKETS.size} total active)`)
      
      // Track socket cleanup
      sock.ev?.on('connection.update', (update) => {
        if (update.connection === 'close') {
          logger.warn(`Socket closed for ${sessionId}`)
          removeSocket(sessionId)
        }
      })
      
      return sock
      
    } catch (error) {
      logger.error(`Error creating socket:`, error)
      throw error
    }
  }
}

/**
 * Apply the patch to the baileys library at runtime
 * 
 * This is called during app initialization to replace baileys' makeWASocket
 * with our patched version that supports multiple sockets
 */
export function applySocketManagerPatch() {
  try {
    // Import baileys' main export
    const baileys = require('@whiskeysockets/baileys')
    
    // Replace the default makeWASocket export with our patched version
    const patchedMakeWASocket = createPatchedMakeWASocket()
    
    baileys.makeWASocket = patchedMakeWASocket
    baileys.default = patchedMakeWASocket
    
    logger.info('✅ Socket manager patch applied to baileys library')
    logger.info('✅ Multiple concurrent sockets now supported')
    
    return patchedMakeWASocket
    
  } catch (error) {
    logger.error('Failed to apply socket manager patch:', error)
    throw error
  }
}

/**
 * Get comprehensive socket diagnostics
 */
export function getSocketDiagnostics() {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    totalActiveSockets: ACTIVE_SOCKETS.size,
    sessions: []
  }
  
  for (const [sessionId, sock] of ACTIVE_SOCKETS.entries()) {
    diagnostics.sessions.push({
      sessionId,
      hasSocket: !!sock,
      wsConnected: !!sock?.ws?.isOpen,
      wsReadyState: sock?.ws?.socket?._readyState,
      user: sock?.user ? {
        id: sock.user.id,
        name: sock.user.name
      } : null,
      authMethod: sock?.authMethod || 'unknown',
      hasEventEmitter: !!sock?.ev,
      eventListenerCount: sock?.ev?.listenerCount?.('connection.update') || 0
    })
  }
  
  return diagnostics
}

/**
 * Force cleanup of a socket if it's stuck
 */
export function forceCleanupSocket(sessionId) {
  const sock = ACTIVE_SOCKETS.get(sessionId)
  
  if (!sock) {
    logger.warn(`Socket not found for cleanup: ${sessionId}`)
    return false
  }
  
  try {
    logger.info(`Force cleaning up socket for ${sessionId}`)
    
    // Safe cleanup
    try {
      sock.ev?.removeAllListeners?.()
    } catch (e) {
      logger.debug(`Error removing event listeners: ${e.message}`)
    }
    
    try {
      sock.ws?.removeAllListeners?.()
    } catch (e) {
      logger.debug(`Error removing ws listeners: ${e.message}`)
    }
    
    try {
      sock.ws?.close?.()
    } catch (e) {
      logger.debug(`Error closing ws: ${e.message}`)
    }
    
    // Remove from tracking
    removeSocket(sessionId)
    
    logger.info(`Socket force cleaned for ${sessionId}`)
    return true
    
  } catch (error) {
    logger.error(`Error during socket cleanup for ${sessionId}:`, error)
    return false
  }
}

export default {
  createPatchedMakeWASocket,
  applySocketManagerPatch,
  getActiveSockets,
  getSocket,
  getSocketCount,
  listActiveSessions,
  removeSocket,
  getSocketDiagnostics,
  forceCleanupSocket
}
