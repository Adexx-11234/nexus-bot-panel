// WhatsApp event types
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

// Connection states
export const ConnectionState = {
  CONNECTING: 'connecting',
  OPEN: 'open',
  CLOSE: 'close'
}

// Disconnect reasons from Baileys
// These are HTTP-style status codes returned by WhatsApp
export const DisconnectReason = {
  // Connection issues
  CONNECTION_CLOSED: 428,      // Connection was closed unexpectedly
  CONNECTION_LOST: 408,         // Connection timeout/lost
  TIMED_OUT: 408,              // Request timeout
  
  // Authentication & Session issues
  LOGGED_OUT: 401,             // User logged out from WhatsApp
  FORBIDDEN: 403,              // Account banned/restricted by WhatsApp
  CONNECTION_REPLACED: 440,    // Another device connected with same account
  BAD_SESSION: 500,            // Bad MAC - Usually auth storage pile-up (recoverable!)
  
  // Special cases
  RESTART_REQUIRED: 515,       // Connection needs restart (happens after pairing code)
  STREAM_ERROR_UNKNOWN: 516,   // Unknown stream error (similar to 515, needs restart)
  UNAVAILABLE: 503,            // Service temporarily unavailable
  
  // Rate limiting
  TOO_MANY_REQUESTS: 429       // Too many connection attempts
}

// Human-readable disconnect messages
export const DisconnectMessages = {
  [DisconnectReason.CONNECTION_CLOSED]: 'Connection closed unexpectedly',
  [DisconnectReason.CONNECTION_LOST]: 'Connection lost or timed out',
  [DisconnectReason.TIMED_OUT]: 'Connection request timed out',
  [DisconnectReason.LOGGED_OUT]: 'Account logged out from WhatsApp',
  [DisconnectReason.FORBIDDEN]: 'Account banned or restricted by WhatsApp',
  [DisconnectReason.CONNECTION_REPLACED]: 'Connection replaced by another device',
  [DisconnectReason.BAD_SESSION]: 'Session data corrupted or invalid',
  [DisconnectReason.RESTART_REQUIRED]: 'Connection restart required',
  [DisconnectReason.UNAVAILABLE]: 'WhatsApp service unavailable',
  [DisconnectReason.TOO_MANY_REQUESTS]: 'Too many connection attempts'
}

// Check if a disconnect reason is permanent (no reconnection should be attempted)
export function isPermanentDisconnect(statusCode) {
  return [
    DisconnectReason.LOGGED_OUT,
    DisconnectReason.FORBIDDEN,
    DisconnectReason.CONNECTION_REPLACED,
    DisconnectReason.BAD_SESSION
  ].includes(statusCode)
}

// Check if a disconnect reason allows reconnection
export function canReconnect(statusCode) {
  return !isPermanentDisconnect(statusCode)
}

// Get human-readable message for disconnect reason
export function getDisconnectMessage(statusCode) {
  return DisconnectMessages[statusCode] || `Unknown disconnect reason: ${statusCode}`
}