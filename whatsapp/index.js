/**
 * WhatsApp Module - Main Entry Point
 * Organized, clean, and efficient WhatsApp bot implementation
 */

// ============================================================================
// CORE - Socket, Connection, Configuration
// ============================================================================
export {
  WhatsAppClient,
  ConnectionManager,
  baileysConfig,
  getBaileysSocket,
  createBaileysSocket,
  setupSocketDefaults
} from './core/index.js'

// ============================================================================
// SESSIONS - Session Management
// ============================================================================
export {
  SessionManager,
  SessionState,
  WebSessionDetector,
  SessionEventHandlers,
  initializeSessionManager,
  getSessionManager,
  resetSessionManager
} from './sessions/index.js'

// ============================================================================
// STORAGE - Data Persistence
// ============================================================================
export {
  SessionStorage,
  MongoDBStorage,
  PostgreSQLStorage,
  FileManager,
  useMongoDBAuthState,
  cleanupSessionAuthData,
  hasValidAuthData,
  getSessionStorage,
  initializeStorage
} from './storage/index.js'

// ============================================================================
// EVENTS - Event Handling
// ============================================================================
export {
  EventDispatcher,
  MessageEventHandler,
  GroupEventHandler,
  ConnectionEventHandler,
  UtilityEventHandler,
  EventTypes,
  ConnectionState,
  DisconnectReason
} from './events/index.js'

// ============================================================================
// MESSAGES - Message Processing
// ============================================================================
export {
  MessageProcessor,
  MessageLogger,
  MessagePersistence,
  MessageExtractor,
  serializeMessage,
  extractMessageText,
  extractMediaData,
  getMediaType
} from './messages/index.js'

// ============================================================================
// GROUPS - Group Management
// ============================================================================
export {
  GroupMetadataManager,
  getGroupMetadataManager,
  GroupParticipantsHandler,
  GroupAdminChecker,
  GroupNotifier,
  resolveLidToJid,
  resolveParticipants,
  isGroupAdmin,
  isBotAdmin,
  isGroupOwner,
  getGroupAdmins
} from './groups/index.js'

// ============================================================================
// CONTACTS - Contact Management
// ============================================================================
export {
  ContactManager,
  getContactManager,
  ContactResolver
} from './contacts/index.js'

// ============================================================================
// UTILS - Utility Functions
// ============================================================================
export {
  // JID utilities
  normalizeJid,
  formatJid,
  isGroupJid,
  isUserJid,
  extractPhoneNumber,
  isSameJid,
  createJidFromPhone,
  parseJid,
  getDisplayId,
  normalizeJids,
  createRateLimitKey,
  
  // Pairing
  handlePairing,
  
  // Validators
  validatePhoneNumber,
  validateJid,
  validateGroupJid,
  validateUserJid,
  validateSessionId,
  validateMessageKey,
  validateUrl,
  validateEmail,
  validateTelegramId,
  validateFileSize,
  validateMimeType,
  sanitizeString,
  validateCommand,
  
  // Formatters
  formatTimestamp,
  getRelativeTime,
  formatFileSize,
  formatDuration,
  formatPhoneNumber,
  formatNumber,
  formatPercentage,
  truncateString,
  formatList,
  formatKeyValue,
  
  // Helpers
  sleep,
  retry,
  withTimeout,
  chunkArray,
  uniqueArray,
  deepClone,
  isEmpty,
  safeJsonParse,
  safeJsonStringify,
  randomString,
  randomId,
  debounce,
  throttle,
  pick,
  omit,
  mergeDeep,
  ViewOnceHandler,
  AntiDeletedHandler,
  VIPHelper,
  VIPTakeover,
  PresenceManager,
  getPresenceManager,
  initializePresenceForSession,
  handlePresenceBeforeSend,
  handlePresenceAfterSend,
  handlePresenceOnReceive
} from './utils/index.js'

// ============================================================================
// HANDLERS - Bridge Handlers (Backward Compatibility)
// ============================================================================
export {
  handleMessagesUpsert,
  handleGroupParticipantsUpdate,
  WhatsAppEventHandler,
  messageProcessor,
  getMessageProcessor  // ✅ ADDED: Export message processor getter
} from './handlers/index.js'

// ============================================================================
// RE-EXPORTS FROM CONFIG
// ============================================================================
export {
  getGroupMetadata,
  invalidateGroupCache,
  refreshGroupMetadata,
  isUserGroupAdmin,
  isBotGroupAdmin,
  setupCacheInvalidation,
  updateCacheFromEvent,
  updateParticipantsInCache
} from '../config/baileys.js'

// ============================================================================
// VERSION & INFO
// ============================================================================
export const VERSION = '2.0.0'
export const MODULE_NAME = 'WhatsApp Bot Platform'

/**
 * Get module information
 */
export function getModuleInfo() {
  return {
    name: MODULE_NAME,
    version: VERSION,
    folders: [
      'core',
      'sessions',
      'storage',
      'events',
      'messages',
      'groups',
      'contacts',
      'utils',
      'handlers'
    ],
    description: 'Organized, efficient, and maintainable WhatsApp bot implementation'
  }
}

/**
 * Initialize WhatsApp module (convenience function)
 */
export async function initializeWhatsAppModule(telegramBot = null, options = {}) {
  const {
    sessionDir = './sessions',
    enableEventHandlers = true,
    initializeSessions = true
  } = options

  // Use the singleton pattern from sessions/index.js
  const { initializeSessionManager } = await import('./sessions/index.js')
  const sessionManager = await initializeSessionManager(telegramBot, sessionDir)
  
  // Initialize the session manager components
  await sessionManager.initialize()

  // Initialize existing sessions if requested
  if (initializeSessions) {
    const result = await sessionManager.initializeExistingSessions()
    console.log(`[WhatsApp] Initialized ${result.initialized}/${result.total} sessions`)
  }

  // Enable event handlers if requested
  if (enableEventHandlers) {
    sessionManager.enableEventHandlers()
  }

  return sessionManager
}

/**
 * Quick setup for common use case
 */
export async function quickSetup(telegramBot) {
  return await initializeWhatsAppModule(telegramBot, {
    sessionDir: './sessions',
    enableEventHandlers: true,
    initializeSessions: true
  })
}

// ============================================================================
// DEFAULT EXPORT - For backward compatibility
// ============================================================================
export default {
  // Re-export everything that was already exported
  ...await (async () => {
    const core = await import('./core/index.js')
    const sessions = await import('./sessions/index.js')
    const storage = await import('./storage/index.js')
    const events = await import('./events/index.js')
    const messages = await import('./messages/index.js')
    const groups = await import('./groups/index.js')
    const contacts = await import('./contacts/index.js')
    const utils = await import('./utils/index.js')
    const handlers = await import('./handlers/index.js')
    const config = await import('../config/baileys.js')
    
    return {
      ...core,
      ...sessions,
      ...storage,
      ...events,
      ...messages,
      ...groups,
      ...contacts,
      ...utils,
      ...handlers,
      ...config,
      VERSION,
      MODULE_NAME,
      getModuleInfo,
      initializeWhatsAppModule,
      quickSetup
    }
  })()
}