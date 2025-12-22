/**
 * Core Module Exports
 */

export { TelegramBot } from './bot.js'
export { telegramConfig, validateConfig } from '../../config/telegram.js'

// Singleton pattern
let botInstance = null

/**
 * Initialize telegram bot singleton
 */
export async function initializeTelegramBot(token, options = {}) {
  const { TelegramBot } = await import('./bot.js')
  
  if (!botInstance) {
    botInstance = new TelegramBot(token, options)
    await botInstance.initialize()
  }
  
  return botInstance
}

/**
 * Get telegram bot instance
 */
export function getTelegramBot() {
  if (!botInstance) {
    throw new Error('Telegram bot not initialized. Call initializeTelegramBot first.')
  }
  return botInstance
}

/**
 * Reset telegram bot (for testing)
 */
export function resetTelegramBot() {
  if (botInstance) {
    botInstance.stop().catch(() => {})
  }
  botInstance = null
}