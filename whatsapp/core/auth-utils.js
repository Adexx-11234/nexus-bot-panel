/**
 * Auth utilities re-exported from storage module
 * These are used by the connection manager for auth validation and cleanup
 */

// Re-export from auth-state.js in storage module
export {
  hasValidAuthData,
  cleanupSessionAuthData,
} from "../storage/auth-state.js"
