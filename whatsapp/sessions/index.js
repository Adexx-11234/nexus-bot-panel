// Sessions module barrel export
export { SessionManager } from './manager.js'
export { SessionState } from './state.js'
export { WebSessionDetector } from './detector.js'
export { SessionEventHandlers } from './handlers.js'

// Store singleton in global to ensure single instance across all imports
const GLOBAL_KEY = Symbol.for('__whatsapp_session_manager_instance__')

/**
 * Get singleton instance from global
 */
function getGlobalInstance() {
  return globalThis[GLOBAL_KEY] || null
}

/**
 * Set singleton instance in global
 */
function setGlobalInstance(instance) {
  globalThis[GLOBAL_KEY] = instance
  console.log('[SessionManager] Singleton instance stored globally')
}

/**
 * Initialize session manager singleton
 */
export async function initializeSessionManager(telegramBot, sessionDir = './sessions') {
  let instance = getGlobalInstance()
  
  if (!instance) {
    const { SessionManager } = await import('./manager.js')
    instance = new SessionManager(telegramBot, sessionDir)
    setGlobalInstance(instance)
    console.log('[SessionManager] NEW singleton instance created')
  } else {
    console.log('[SessionManager] Reusing existing singleton instance')
  }
  
  return instance
}

/**
 * Get session manager instance (returns null if not initialized)
 */
export function getSessionManager() {
  const instance = getGlobalInstance()
  if (!instance) {
    console.warn('[SessionManager] Instance not initialized. Call initializeSessionManager() first.')
  }
  return instance
}

/**
 * Ensure session manager exists (throws if not initialized)
 */
export function ensureSessionManager() {
  const instance = getGlobalInstance()
  
  if (!instance) {
    console.error('[SessionManager] Instance not initialized!')
    throw new Error(
      '[SessionManager] Instance not initialized. ' +
      'Make sure initializeSessionManager() is called during app startup.'
    )
  }
  
  return instance
}

/**
 * Get session manager or return null (safe getter)
 */
export function getSessionManagerSafe() {
  return getGlobalInstance()
}

/**
 * Reset session manager (for testing)
 */
export function resetSessionManager() {
  const instance = getGlobalInstance()
  if (instance) {
    delete globalThis[GLOBAL_KEY]
    console.log('[SessionManager] Singleton instance reset')
  }
}

/**
 * Check if session manager is initialized
 */
export function isSessionManagerInitialized() {
  return getGlobalInstance() !== null
}