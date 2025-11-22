/**
 * Telegram Bot Module - Main Entry Point
 * Handles WhatsApp connection management via Telegram bot
 */

// ============================================================================
// CORE - Bot and Configuration
// ============================================================================
export {
  TelegramBot,
  telegramConfig,
  initializeTelegramBot,
  getTelegramBot
} from './core/index.js'

// ============================================================================
// HANDLERS - Request Handlers
// ============================================================================
export {
  ConnectionHandler,
  AdminHandler,
  CommandHandler
} from './handlers/index.js'

// ============================================================================
// MIDDLEWARE - Authentication and Authorization
// ============================================================================
export {
  AuthMiddleware,
  AdminMiddleware
} from './middleware/index.js'

// ============================================================================
// UTILS - Utilities
// ============================================================================
export {
  validatePhone
} from './utils/index.js'

export {
  TelegramMessages,
  TelegramKeyboards
} from './ui/index.js'

// ============================================================================
// VERSION & INFO
// ============================================================================
export const VERSION = '2.0.0'
export const MODULE_NAME = 'Telegram Bot Module'

/**
 * Get module information
 */
export function getModuleInfo() {
  return {
    name: MODULE_NAME,
    version: VERSION,
    folders: [
      'core',
      'handlers',
      'middleware',
      'utils'
    ],
    description: 'Telegram bot for WhatsApp connection management'
  }
}

/**
 * Initialize Telegram module (convenience function)
 */
export async function initializeTelegramModule(options = {}) {
  const {
    token = process.env.TELEGRAM_BOT_TOKEN,
    enablePolling = true
  } = options

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is required')
  }

  const { initializeTelegramBot } = await import('./core/index.js')
  
  const bot = await initializeTelegramBot(token, {
    enablePolling
  })

  return bot
}

/**
 * Quick setup for common use case
 */
export async function quickSetup() {
  // Read token from environment, don't accept it as parameter
  const token = process.env.TELEGRAM_BOT_TOKEN
  
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN not found in environment variables')
  }
  
  return await initializeTelegramModule({
    token,
    enablePolling: true
  })
}