// Core module barrel export
export { WhatsAppClient } from './client.js'
export { ConnectionManager } from './connection.js'
export { DecryptionHandler, getDecryptionHandler, resetDecryptionHandler } from './decryption-handler.js'
export { 
  wrapBaileysSocket,
  getSocket,
  getAllSockets,
  getSocketCount,
  getAllSessions,
  getSessionInfo,
  updateConnectionStatus,
  removeSocket,
  getStats
} from './socket-wrapper.js'

// Re-export everything from config for convenience
export { 
  baileysConfig,
  createSessionStore,
  getSessionStore,
  deleteSessionStore,
  bindStoreToSocket,
  createBaileysSocket,
  setupSocketDefaults,
  getBaileysConfig,
  getGroupMetadata,
  updateCacheFromEvent,
  updateParticipantsInCache,
  invalidateGroupCache,
  refreshGroupMetadata,
  isUserGroupAdmin,
  isBotGroupAdmin,
  setupCacheInvalidation,
  updateGroupCache,
  getGroupCache,
  clearGroupCache,
  clearAllGroupCache,
  getCacheStats,
  updateSessionLastMessage,
  ensureCacheableKeys,
  wrapSocketForDecryptionErrors
} from './config.js'