import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("SESSION_STATE")

/**
 * DEPRECATED: SessionState should not be used
 * All session data is persisted in the storage folder (MongoDB or file-based)
 * Fetching fresh data on-demand prevents RAM bloat
 */
export class SessionState {
  constructor() {
    logger.warn("SessionState is deprecated - use storage layer directly instead")
  }

  set(sessionId, data) {
    // Do nothing - data should be in storage
  }

  get(sessionId) {
    // Return null - fetch from storage instead
    return null
  }

  update(sessionId, updates) {
    // Do nothing - update in storage
    return false
  }

  delete(sessionId) {
    // Do nothing
    return false
  }

  has(sessionId) {
    return false
  }

  getAll() {
    return []
  }

  clear() {
    // No-op
  }

  size() {
    return 0
  }
}
