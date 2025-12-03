import { createComponentLogger } from '../../utils/logger.js'
const logger = createComponentLogger('CORE_CONFIG')

/**
 * Re-export everything from the main baileys config
 * This allows core modules to import from ./config.js instead of ../../config/baileys.js
 */
export {
  baileysConfig,
  createSessionStore,
  getSessionStore,
  deleteSessionStore,
  bindStoreToSocket,
  createBaileysSocket,  // ✅ Added this
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
  getCacheStats
} from '../../config/baileys.js'

// No logging needed - this is just a re-export module