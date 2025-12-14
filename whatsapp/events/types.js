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
  CONNECTION_CLOSED: 428,
  CONNECTION_LOST: 408,
  TIMED_OUT: 408,
  
  // Early connection close (pre-pairing)
  METHOD_NOT_ALLOWED: 405,
  
  // Authentication & Session issues
  LOGGED_OUT: 401,
  FORBIDDEN: 403,
  CONNECTION_REPLACED: 440,
  BAD_SESSION: 500,
  
  // Special cases (Post-pairing)
  RESTART_REQUIRED: 515,
  STREAM_ERROR_UNKNOWN: 516,
  
  // Service availability
  UNAVAILABLE: 503,
  
  // Rate limiting
  TOO_MANY_REQUESTS: 429,
  
  // Other errors
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
  BAD_REQUEST: 400,
  NOT_FOUND: 404
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
  // EARLY CONNECTION CLOSE (Pre-Pairing)
  // ============================================================
  
  [DisconnectReason.METHOD_NOT_ALLOWED]: {
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    clearVoluntaryFlag: true,
    reconnectDelay: 3000,
    maxAttempts: 3,
    message: 'Connection closed before pairing - retrying',
    userAction: 'Reconnecting automatically',
    handler: 'handleEarlyClose'
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
    supports515Flow: true,
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
    supports515Flow: true,
    handler: 'handleRestartRequired'
  },
  
  // ============================================================
  // CONNECTION REPLACEMENT - RECONNECT WITH DELAY
  // ============================================================
  
  [DisconnectReason.CONNECTION_REPLACED]: {
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    clearVoluntaryFlag: true,
    reconnectDelay: 10000, // 10 seconds
    maxAttempts: 6,
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
    maxAttempts: 10,
    message: 'Session data corrupted - clearing and reconnecting',
    handler: 'handleBadSession'
  },
  
  // ============================================================
  // CONNECTION TIMEOUT - NOW RECONNECTS
  // ============================================================
  
  [DisconnectReason.TIMED_OUT]: {
    shouldReconnect: true, // Changed from false
    isPermanent: false, // Changed from true
    requiresCleanup: false, // Changed from true
    reconnectDelay: 30000, // Wait 30 seconds
    maxAttempts: 7,
    message: 'Connection request timed out - retrying',
    userAction: 'Reconnecting automatically',
    handler: 'handleConnectionTimeout'
  },
  
  [DisconnectReason.CONNECTION_LOST]: {
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    reconnectDelay: 15000, // 15 seconds
    maxAttempts: 10,
    message: 'Connection lost',
    handler: 'handleConnectionLost'
  },
  
  // ============================================================
  // TEMPORARY ISSUES - DELAYED RECONNECT
  // ============================================================
  
  [DisconnectReason.CONNECTION_CLOSED]: {
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    clearVoluntaryFlag: true,
    reconnectDelay: 15000, // 15 seconds
    maxAttempts: 10,
    message: 'Connection closed unexpectedly',
    handler: 'handleConnectionClosed'
  },
  
  [DisconnectReason.UNAVAILABLE]: {
    shouldReconnect: true,
    isPermanent: false,
    requiresCleanup: false,
    reconnectDelay: 30000, // 30 seconds
    maxAttempts: 7,
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
    maxAttempts: 5,
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

export function isPermanentDisconnect(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.isPermanent === true
}

export function shouldReconnect(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.shouldReconnect === true
}

export function requiresCleanup(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.requiresCleanup === true
}

export function supports515Flow(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.supports515Flow === true
}

export function getReconnectDelay(statusCode, attemptNumber = 0) {
  const config = getDisconnectConfig(statusCode)
  
  if (!config.shouldReconnect) {
    return null
  }
  
  if (config.useExponentialBackoff) {
    const delay = config.reconnectDelay * Math.pow(2, attemptNumber)
    return Math.min(delay, config.maxDelay || 300000)
  }
  
  return config.reconnectDelay || 5000
}

export function getMaxAttempts(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.maxAttempts || 5
}

export function getDisconnectMessage(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.message
}

export function getHandlerName(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.handler || 'handleUnknown'
}

export function shouldClearVoluntaryFlag(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.clearVoluntaryFlag === true
}

export function requiresAuthClear(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.requiresAuthClear === true
}

export function shouldKeepCredentials(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.keepCredentials === true
}

export function requiresNotification(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.requiresNotification === true
}

export function getUserAction(statusCode) {
  const config = getDisconnectConfig(statusCode)
  return config.userAction || null
}

// ==========================================
// LEGACY COMPATIBILITY
// ==========================================

export const DisconnectMessages = {
  [DisconnectReason.METHOD_NOT_ALLOWED]: 'Connection closed before pairing',
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

export function canReconnect(statusCode) {
  return shouldReconnect(statusCode)
}