// types.js - Complete WhatsApp Event Types and Disconnect Configurations

// ==========================================
// WHATSAPP EVENT TYPES
// ==========================================

export const EventTypes = {
  // Connection events
  CONNECTION_UPDATE: 'connection.update',
  CREDS_UPDATE: 'creds.update',
  
  // Message events
  MESSAGES_UPSERT: 'messages.upsert',
  MESSAGES_UPDATE: 'messages.update',
  MESSAGES_DELETE: 'messages.delete',
  MESSAGES_REACTION: 'messages.reaction',
  MESSAGE_RECEIPT_UPDATE: 'message-receipt.update',
  
  // Group events
  GROUPS_UPSERT: 'groups.upsert',
  GROUPS_UPDATE: 'groups.update',
  GROUP_PARTICIPANTS_UPDATE: 'group-participants.update',
  
  // Contact events
  CONTACTS_UPSERT: 'contacts.upsert',
  CONTACTS_UPDATE: 'contacts.update',
  
  // Chat events
  CHATS_UPSERT: 'chats.upsert',
  CHATS_UPDATE: 'chats.update',
  CHATS_DELETE: 'chats.delete',
  
  // Presence events
  PRESENCE_UPDATE: 'presence.update',
  
  // Utility events
  CALL: 'call',
  BLOCKLIST_SET: 'blocklist.set',
  BLOCKLIST_UPDATE: 'blocklist.update'
}

// ==========================================
// CONNECTION STATES
// ==========================================

export const ConnectionState = {
  CONNECTING: 'connecting',
  OPEN: 'open',
  CLOSE: 'close'
}

// ==========================================
// DISCONNECT REASONS (HTTP-style status codes)
// ==========================================

export const DisconnectReason = {
  // Connection issues
  CONNECTION_CLOSED: 428,      // Connection was closed unexpectedly
  CONNECTION_LOST: 408,        // Connection timeout/lost
  TIMED_OUT: 408,              // Request timeout (same as CONNECTION_LOST)
  
  // ✅ Early connection close (pre-pairing)
  METHOD_NOT_ALLOWED: 405,     // Connection closed before pairing could complete
  
  // Authentication & Session issues
  LOGGED_OUT: 401,             // User logged out from WhatsApp
  FORBIDDEN: 403,              // Account banned/restricted by WhatsApp
  CONNECTION_REPLACED: 440,    // Another device connected with same account
  BAD_SESSION: 500,            // Bad MAC - corrupted session storage
  
  // Special cases (Post-pairing)
  RESTART_REQUIRED: 515,       // Connection needs restart (happens after pairing code)
  STREAM_ERROR_UNKNOWN: 516,   // Unknown stream error (similar to 515)
  
  // Service availability
  UNAVAILABLE: 503,            // Service temporarily unavailable
  
  // Rate limiting
  TOO_MANY_REQUESTS: 429,      // Too many connection attempts
  
  // Other errors
  CONFLICT: 409,               // Session conflict
  INTERNAL_SERVER_ERROR: 500,  // WhatsApp internal error
  BAD_REQUEST: 400,            // Invalid request
  NOT_FOUND: 404               // Resource not found
}

// ==========================================
// DISCONNECT CONFIGURATION
// Each disconnect reason has specific handling rules
// ✅ maxAttempts set to 2 for most disconnects
// ✅ Auth clear added for connection issues
// ==========================================

export const DisconnectConfig = {
  // ============================================================
  // PERMANENT DISCONNECTS - NO RECONNECTION
  // ============================================================
  
  [DisconnectReason.LOGGED_OUT]: {
    statusCode: 401,
    shouldReconnect: false,
    isPermanent: true,
    requiresCleanup: true,
    requiresNotification: true,
    message: 'Account logged out from WhatsApp',
    userAction: 'Use /connect to reconnect',
    handler: 'handleLoggedOut'
  },
  
  [DisconnectReason.FORBIDDEN]: {
    statusCode: 403,
    shouldReconnect: false,
    isPermanent: true,
    requiresCleanup: true,
    requiresNotification: true,
    message: 'Account banned or restricted by WhatsApp',
    userAction: 'Contact WhatsApp support or wait for restriction to be lifted',
    handler: 'handleForbidden'
  },
  
  // ============================================================
  // ✅ 405 - Early Connection Close (Pre-Pairing)
  // ============================================================
  
  [DisconnectReason.METHOD_NOT_ALLOWED]: {
    statusCode: 405,
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    clearVoluntaryFlag: true,
    reconnectDelay: 3000,
    maxAttempts: 2,
    message: 'Connection closed before pairing completed',
    userAction: 'Reconnecting automatically...',
    handler: 'handleEarlyClose'
  },
  
  // ============================================================
  // IMMEDIATE RECONNECT (Post-Pairing Restart)
  // ============================================================
  
  [DisconnectReason.RESTART_REQUIRED]: {
    statusCode: 515,
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    clearVoluntaryFlag: true,
    reconnectDelay: 3000,
    maxAttempts: 10, // Keep at 10 for post-pairing restart
    message: 'Connection restart required after pairing',
    supports515Flow: true,
    handler: 'handleRestartRequired'
  },
  
  [DisconnectReason.STREAM_ERROR_UNKNOWN]: {
    statusCode: 516,
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    clearVoluntaryFlag: true,
    reconnectDelay: 3000,
    maxAttempts: 10, // Keep at 10 for post-pairing restart
    message: 'Stream error detected - restart required',
    supports515Flow: true,
    handler: 'handleRestartRequired'
  },
  
  // ============================================================
  // ✅ CONNECTION ISSUES - RECONNECTABLE WITH AUTH CLEAR
  // ============================================================
  
  [DisconnectReason.CONNECTION_CLOSED]: {
    statusCode: 428,
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    requiresAuthClear: true, // ✅ Auth clear needed
    keepCredentials: true,
    clearVoluntaryFlag: true,
    reconnectDelay: 6000,
    maxAttempts: 4,
    message: 'Connection closed unexpectedly',
    userAction: 'Reconnecting automatically...',
    handler: 'handleConnectionClosed'
  },
  
  [DisconnectReason.CONNECTION_REPLACED]: {
    statusCode: 440,
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    requiresAuthClear: true, // ✅ Auth clear needed
    keepCredentials: true,
    clearVoluntaryFlag: true,
    reconnectDelay: 6000,
    maxAttempts: 3,
    message: 'Connection replaced by another device',
    userAction: 'Reconnecting automatically...',
    handler: 'handleConnectionReplaced'
  },
  
  // In types.js - Change 408 configuration

[DisconnectReason.TIMED_OUT]: {
  statusCode: 408,
  shouldReconnect: true, // ✅ Changed from false to true
  isPermanent: false, // ✅ Changed from true to false
  requiresCleanup: false, // ✅ Changed from true to false
  requiresNotification: false, // ✅ Changed from true to false
  requiresAuthClear: false, // ✅ No auth clear for timeout
  reconnectDelay: 5000,
  maxAttempts: 3,
  message: 'Connection request timed out - reconnecting',
  userAction: 'Reconnecting automatically...', // ✅ Changed message
  handler: 'handleConnectionTimeout'
},
  
  [DisconnectReason.INTERNAL_SERVER_ERROR]: {
    statusCode: 500,
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    requiresAuthClear: true, // ✅ Auth clear needed
    keepCredentials: true,
    reconnectDelay: 10000,
    maxAttempts: 20,
    message: 'WhatsApp internal server error',
    userAction: 'Retrying connection...',
    handler: 'handleInternalError'
  },
  
  [DisconnectReason.NOT_FOUND]: {
    statusCode: 404,
    shouldReconnect: true, // ✅ Changed to reconnectable
    isPermanent: false,
    requiresCleanup: false,
    requiresAuthClear: true, // ✅ Auth clear needed
    keepCredentials: true,
    reconnectDelay: 5000,
    maxAttempts: 2,
    message: 'Session resource not found',
    userAction: 'Reconnecting automatically...',
    handler: 'handleNotFound'
  },
  
  // ============================================================
  // BAD SESSION - SPECIAL HANDLING (Clear auth then reconnect)
  // ============================================================
  
  [DisconnectReason.BAD_SESSION]: {
    statusCode: 500,
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    requiresAuthClear: true,
    keepCredentials: true,
    reconnectDelay: 2000,
    maxAttempts: 2,
    message: 'Session data corrupted - clearing and reconnecting',
    handler: 'handleBadSession'
  },
  
  // ============================================================
  // CONNECTION TIMEOUT - COMPLETE CLEANUP
  // ============================================================
  
  [DisconnectReason.TIMED_OUT]: {
    statusCode: 408,
    shouldReconnect: false,
    isPermanent: true,
    requiresCleanup: true,
    requiresNotification: true,
    message: 'Connection request timed out - pairing code not entered in time',
    userAction: 'Use /connect to try again',
    handler: 'handleConnectionTimeout'
  },
  
  // ============================================================
  // TEMPORARY ISSUES - DELAYED RECONNECT
  // ============================================================
  
  [DisconnectReason.UNAVAILABLE]: {
    statusCode: 503,
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    reconnectDelay: 10000,
    maxAttempts: 2,
    message: 'WhatsApp service temporarily unavailable',
    userAction: 'Waiting for service to become available...',
    handler: 'handleUnavailable'
  },
  
  [DisconnectReason.CONFLICT]: {
    statusCode: 409,
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    reconnectDelay: 5000,
    maxAttempts: 2,
    message: 'Session conflict detected',
    userAction: 'Resolving conflict...',
    handler: 'handleConflict'
  },
  
  // ============================================================
  // RATE LIMITING - EXPONENTIAL BACKOFF
  // ============================================================
  
  [DisconnectReason.TOO_MANY_REQUESTS]: {
    statusCode: 429,
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    useExponentialBackoff: true,
    reconnectDelay: 5000,
    maxDelay: 300000, // 5 minutes max
    maxAttempts: 2,
    message: 'Too many connection attempts - rate limited',
    userAction: 'Please wait before trying again',
    handler: 'handleRateLimit'
  },
  
  // ============================================================
  // ERROR STATES
  // ============================================================
  
  [DisconnectReason.BAD_REQUEST]: {
    statusCode: 400,
    shouldReconnect: false,
    isPermanent: true,
    requiresCleanup: true,
    message: 'Invalid connection request',
    userAction: 'Please reconnect using /connect',
    handler: 'handleBadRequest'
  }
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Get configuration for a disconnect reason
 */
export function getDisconnectConfig(statusCode) {
  return DisconnectConfig[statusCode] || {
    statusCode: statusCode,
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    requiresAuthClear: true, // ✅ Default to auth clear for unknown errors
    keepCredentials: true,
    reconnectDelay: 10000,
    maxAttempts: 2,
    message: `Unknown disconnect reason: ${statusCode}`,
    userAction: 'Attempting to reconnect...',
    handler: 'handleUnknown'
  }
}

/**
 * Check if disconnect is permanent
 */
export function isPermanentDisconnect(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.isPermanent === true
}

/**
 * Check if should reconnect
 */
export function shouldReconnect(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.shouldReconnect === true
}

/**
 * Check if requires cleanup
 */
export function requiresCleanup(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.requiresCleanup === true
}

/**
 * Check if supports 515 complex flow
 */
export function supports515Flow(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.supports515Flow === true
}

/**
 * Get reconnection delay
 */
export function getReconnectDelay(statusCode, attemptNumber = 0) {
  const config = getDisconnectConfig(statusCode)
  
  if (!config.shouldReconnect) {
    return null
  }
  
  // Exponential backoff for rate limiting
  if (config.useExponentialBackoff) {
    const delay = config.reconnectDelay * Math.pow(2, attemptNumber)
    return Math.min(delay, config.maxDelay || 300000)
  }
  
  return config.reconnectDelay || 5000
}

/**
 * Get max reconnection attempts
 */
export function getMaxAttempts(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.maxAttempts || 2
}

/**
 * Get disconnect message
 */
export function getDisconnectMessage(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.message
}

/**
 * Get handler name
 */
export function getHandlerName(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.handler || 'handleUnknown'
}

/**
 * Check if should clear voluntary disconnect flag
 */
export function shouldClearVoluntaryFlag(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.clearVoluntaryFlag === true
}

/**
 * Check if requires auth clear
 */
export function requiresAuthClear(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.requiresAuthClear === true
}

/**
 * Check if should keep credentials during cleanup
 */
export function shouldKeepCredentials(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.keepCredentials === true
}

/**
 * Check if requires user notification
 */
export function requiresNotification(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.requiresNotification === true
}

/**
 * Get user action message
 */
export function getUserAction(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.userAction || null
}

// ==========================================
// LEGACY COMPATIBILITY
// ==========================================

export const DisconnectMessages = {
  [DisconnectReason.METHOD_NOT_ALLOWED]: 'Connection closed before pairing completed',
  [DisconnectReason.CONNECTION_CLOSED]: 'Connection closed unexpectedly',
  [DisconnectReason.CONNECTION_LOST]: 'Connection lost - network issue detected',
  [DisconnectReason.TIMED_OUT]: 'Connection request timed out',
  [DisconnectReason.LOGGED_OUT]: 'Account logged out from WhatsApp',
  [DisconnectReason.FORBIDDEN]: 'Account banned or restricted by WhatsApp',
  [DisconnectReason.CONNECTION_REPLACED]: 'Connection replaced by another device',
  [DisconnectReason.BAD_SESSION]: 'Session data corrupted or invalid',
  [DisconnectReason.RESTART_REQUIRED]: 'Connection restart required after pairing',
  [DisconnectReason.STREAM_ERROR_UNKNOWN]: 'Stream error - restart required',
  [DisconnectReason.UNAVAILABLE]: 'WhatsApp service unavailable',
  [DisconnectReason.TOO_MANY_REQUESTS]: 'Too many connection attempts',
  [DisconnectReason.CONFLICT]: 'Session conflict detected',
  [DisconnectReason.INTERNAL_SERVER_ERROR]: 'WhatsApp internal server error',
  [DisconnectReason.BAD_REQUEST]: 'Invalid connection request',
  [DisconnectReason.NOT_FOUND]: 'Resource not found'
}

/**
 * Legacy function - use getDisconnectConfig instead
 */
export function canReconnect(statusCode) {
  return shouldReconnect(statusCode)
}