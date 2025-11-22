/**
 * Telegram Bot Configuration
 */

export const telegramConfig = {
  // Bot settings
  token: process.env.TELEGRAM_BOT_TOKEN,
  
  // Polling settings
  polling: {
    interval: 300,
    timeout: 10,
    limit: 100,
    retryTimeout: 5000
  },
  
  // Admin settings
  admin: {
    defaultAdminId: process.env.DEFAULT_ADMIN_ID,
    adminPassword: process.env.ADMIN_PASSWORD,
    maxLoginAttempts: 3,
    lockoutDuration: 15 * 60 * 1000, // 15 minutes
    sessionTimeout: 30 * 60 * 1000   // 30 minutes
  },
  
  // Connection settings
  connection: {
    pairingCodeTimeout: 60000,        // 1 minute
    connectionTimeout: 120000,        // 2 minutes
    phoneValidationTimeout: 300000    // 5 minutes
  },
  
  // Message settings
  messages: {
    maxMessageLength: 4096,
    parseMode: 'Markdown'
  },
  
  // Rate limiting
  rateLimit: {
    maxRequestsPerMinute: 30,
    maxRequestsPerSecond: 3
  }
}

/**
 * Validate configuration
 */
export function validateConfig() {
  const errors = []
  
  if (!telegramConfig.token) {
    errors.push('TELEGRAM_BOT_TOKEN is required')
  }
  
  if (!telegramConfig.admin.defaultAdminId) {
    errors.push('DEFAULT_ADMIN_ID is required')
  }
  
  if (!telegramConfig.admin.adminPassword) {
    errors.push('ADMIN_PASSWORD is required')
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`)
  }
  
  return true
}

/**
 * Get admin configuration
 */
export function getAdminConfig() {
  return {
    defaultAdminId: telegramConfig.admin.defaultAdminId,
    adminPassword: telegramConfig.admin.adminPassword,
    maxLoginAttempts: telegramConfig.admin.maxLoginAttempts,
    lockoutDuration: telegramConfig.admin.lockoutDuration,
    sessionTimeout: telegramConfig.admin.sessionTimeout
  }
}