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
// ==========================================

export const DisconnectConfig = {
  // ============================================================
  // PERMANENT DISCONNECTS - NO RECONNECTION
  // ============================================================
  
  [DisconnectReason.LOGGED_OUT]: {
    shouldReconnect: false,
    isPermanent: true,
    requiresCleanup: true,
    requiresNotification: true,
    message: 'Account logged out from WhatsApp',
    userAction: 'Use /connect to reconnect',
    handler: 'handleLoggedOut'
  },
  
  [DisconnectReason.FORBIDDEN]: {
    shouldReconnect: false,
    isPermanent: true,
    requiresCleanup: true,
    requiresNotification: true,
    message: 'Account banned or restricted by WhatsApp',
    userAction: 'Contact WhatsApp support',
    handler: 'handleForbidden'
  },
  
  // ============================================================
  // IMMEDIATE RECONNECT (Post-Pairing Restart)
  // ============================================================
  
  [DisconnectReason.RESTART_REQUIRED]: {
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    clearVoluntaryFlag: true,
    reconnectDelay: 2000,
    maxAttempts: 10,
    message: 'Connection restart required (post-pairing)',
    supports515Flow: true, // Can use complex 515 flow if enabled
    handler: 'handleRestartRequired'
  },
  
  [DisconnectReason.STREAM_ERROR_UNKNOWN]: {
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    clearVoluntaryFlag: true,
    reconnectDelay: 2000,
    maxAttempts: 10,
    message: 'Stream error - restart required',
    supports515Flow: true, // Can use complex 515 flow if enabled
    handler: 'handleRestartRequired'
  },
  
  // ============================================================
  // CONNECTION REPLACEMENT - RECONNECT WITH DELAY
  // ============================================================
  
  [DisconnectReason.CONNECTION_REPLACED]: {
    shouldReconnect: false,
    isPermanent: true,
    requiresCleanup: true,
    clearVoluntaryFlag: true,
    message: 'Connection replaced by another device',
    userAction: 'Reconnecting automatically',
    handler: 'handleConnectionReplaced'
  },
  
  // ============================================================
  // BAD SESSION - SPECIAL HANDLING (Clear auth then reconnect)
  // ============================================================
  
  [DisconnectReason.BAD_SESSION]: {
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    requiresAuthClear: true,
    keepCredentials: true,
    reconnectDelay: 2000,
    maxAttempts: 5,
    message: 'Session data corrupted - clearing and reconnecting',
    handler: 'handleBadSession'
  },
  
  // ============================================================
  // CONNECTION TIMEOUT - COMPLETE CLEANUP
  // ============================================================
  
  [DisconnectReason.TIMED_OUT]: {
    shouldReconnect: false,
    isPermanent: true,
    requiresCleanup: true,
    requiresNotification: true,
    message: 'Connection request timed out',
    userAction: 'Use /connect to try again',
    handler: 'handleConnectionTimeout'
  },
  
  [DisconnectReason.CONNECTION_LOST]: {
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    message: 'Connection lost',
    handler: 'handleConnectionLost'
  },
  
  // ============================================================
  // TEMPORARY ISSUES - DELAYED RECONNECT
  // ============================================================
  
  [DisconnectReason.CONNECTION_CLOSED]: {
    shouldReconnect: false,
    isPermanent: true,
    requiresCleanup: true,
    clearVoluntaryFlag: true,
    message: 'Connection closed unexpectedly',
    handler: 'handleConnectionClosed'
  },
  
  [DisconnectReason.UNAVAILABLE]: {
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    reconnectDelay: 10000,
    maxAttempts: 5,
    message: 'WhatsApp service temporarily unavailable',
    handler: 'handleUnavailable'
  },
  
  [DisconnectReason.CONFLICT]: {
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    reconnectDelay: 5000,
    maxAttempts: 5,
    message: 'Session conflict detected',
    handler: 'handleConflict'
  },
  
  // ============================================================
  // RATE LIMITING - EXPONENTIAL BACKOFF
  // ============================================================
  
  [DisconnectReason.TOO_MANY_REQUESTS]: {
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    useExponentialBackoff: true,
    reconnectDelay: 5000,
    maxDelay: 300000, // 5 minutes max
    maxAttempts: 10,
    message: 'Too many connection attempts - backing off',
    handler: 'handleRateLimit'
  },
  
  // ============================================================
  // ERROR STATES - INVESTIGATE
  // ============================================================
  
  [DisconnectReason.INTERNAL_SERVER_ERROR]: {
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    reconnectDelay: 10000,
    maxAttempts: 3,
    message: 'WhatsApp internal server error',
    handler: 'handleInternalError'
  },
  
  [DisconnectReason.BAD_REQUEST]: {
    shouldReconnect: false,
    isPermanent: true,
    requiresCleanup: true,
    message: 'Invalid connection request',
    handler: 'handleBadRequest'
  },
  
  [DisconnectReason.NOT_FOUND]: {
    shouldReconnect: false,
    isPermanent: true,
    requiresCleanup: true,
    message: 'Resource not found',
    handler: 'handleNotFound'
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
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    reconnectDelay: 10000,
    maxAttempts: 5,
    message: `Unknown disconnect reason: ${statusCode}`,
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
  return config.maxAttempts || 5
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
  [DisconnectReason.CONNECTION_CLOSED]: 'Connection closed unexpectedly',
  [DisconnectReason.CONNECTION_LOST]: 'Connection lost or timed out',
  [DisconnectReason.TIMED_OUT]: 'Connection request timed out',
  [DisconnectReason.LOGGED_OUT]: 'Account logged out from WhatsApp',
  [DisconnectReason.FORBIDDEN]: 'Account banned or restricted by WhatsApp',
  [DisconnectReason.CONNECTION_REPLACED]: 'Connection replaced by another device',
  [DisconnectReason.BAD_SESSION]: 'Session data corrupted or invalid',
  [DisconnectReason.RESTART_REQUIRED]: 'Connection restart required',
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