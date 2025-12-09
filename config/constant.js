// Constants and configuration values for the WhatsApp bot
// Platform constants and configuration
export const JID_FORMATS = {
  PRIVATE: "@s.whatsapp.net",
  GROUP: "@g.us",
  BROADCAST: "@broadcast",
}

export const WARNING_LIMITS = {
  ANTILINK: 4,
  ANTICALL: 4,
  ANTIIMAGE: 4,
  ANTIGROUPMENTION: 4,
}

export const TIMEOUTS = {
  SESSION: Number.parseInt(process.env.SESSION_TIMEOUT) || 86400000, // 24 hours
  PAIRING_CODE: 300000, // 5 minutes
  RECONNECT: Number.parseInt(process.env.WA_RECONNECT_INTERVAL) || 5000,
}

export const BOT_SETTINGS = {
  DEFAULT_PUBLIC_MODE: true,
  DEFAULT_GROUPONLY: false,
  MAX_RETRIES: 3,
  RATE_LIMIT_WINDOW: 60000, // 1 minute
  RATE_LIMIT_MAX: 10, // 10 commands per minute
}

export const ADMIN = {
  PASSWORD_REQUIRED: true,
  SESSION_DURATION: 3600000, // 1 hour
}

export const PLUGIN_TYPES = {
  GROUPS: "groups",
  CHATS: "chats",
  BOTH: "both",
}

export const CONNECTION_STATES = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  PAIRING: "pairing",
  ERROR: "error",
}

// Storage configuration constants
export const STORAGE_CONFIG = {
  // Storage type: 'mongo' or 'file'
  TYPE: process.env.SESSION_STORAGE_TYPE || "mongo",
  // Auth sessions directory for file-based storage
  AUTH_SESSIONS_DIR: process.env.AUTH_SESSIONS_DIR || "./auth_sessions",
  // Active sockets storage: 'memory' or 'file'
  SOCKETS_STORAGE: process.env.SOCKETS_STORAGE_TYPE || "file",
  // Sockets state file path
  SOCKETS_STATE_FILE: process.env.SOCKETS_STATE_FILE || "./auth_sessions/.sockets_state.json",
}

// Helper to check storage type
export const isFileBasedStorage = () => STORAGE_CONFIG.TYPE === "file"
export const isMongoBasedStorage = () => STORAGE_CONFIG.TYPE === "mongo"
