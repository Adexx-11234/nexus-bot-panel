// ==================== ULTIMATE LOG SUPPRESSION ====================
import dotenv from "dotenv"
dotenv.config()

import { EventEmitter } from 'events'

// Increase max listeners globally
EventEmitter.defaultMaxListeners = 900
process.setMaxListeners(900)

// Also increase for process warnings
process.setMaxListeners(0)

if (process.env.SUPPRESS_LIBRARY_LOGS !== 'false') {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)

  const suppressPatterns = [
    'SessionEntry', '<Buffer', 'Closing', 'libsignal', 'Bad MAC',
    'session_cipher', '_chains', 'registrationId', 'currentRatchet',
    'ephemeralKeyPair', 'indexInfo', 'pendingPreKey', 'baseKey',
    'remoteIdentityKey', 'pubKey', 'privKey', 'lastRemoteEphemeralKey',
    'previousCounter', 'rootKey', 'baseKeyType', 'signedKeyId',
    'preKeyId', 'chainKey', 'chainType', 'messageKeys', 'used:',
    'created:', 'closed:'
  ]

  const shouldSuppress = (chunk) => {
    const text = chunk.toString()
    return suppressPatterns.some(pattern => text.includes(pattern))
  }

  process.stdout.write = function(chunk, encoding, callback) {
    if (!shouldSuppress(chunk)) {
      return originalStdoutWrite(chunk, encoding, callback)
    }
    if (typeof encoding === 'function') encoding()
    else if (typeof callback === 'function') callback()
    return true
  }

  process.stderr.write = function(chunk, encoding, callback) {
    if (!shouldSuppress(chunk)) {
      return originalStderrWrite(chunk, encoding, callback)
    }
    if (typeof encoding === 'function') encoding()
    else if (typeof callback === 'function') callback()
    return true
  }
}
// ==================== END ULTIMATE LOG SUPPRESSION ====================

import express from "express"
import cookieParser from 'cookie-parser'
import { createComponentLogger } from "./utils/logger.js"
import { testConnection, closePool } from "./config/database.js"
import { runMigrations } from "./database/migrations/run-migrations.js"
import { quickSetup as quickSetupTelegram } from "./telegram/index.js"
import { quickSetup as quickSetupWhatsApp, VIPHelper } from "./whatsapp/index.js"
import { WebInterface } from "./web/index.js"
import { GroupScheduler } from "./database/groupscheduler.js"
import pluginLoader from "./utils/plugin-loader.js"

const logger = createComponentLogger("MAIN")
const PORT = process.env.PORT || 3000
const app = express()

// Platform components
let telegramBot = null
let sessionManager = null
let groupScheduler = null
let webInterface = null
let server = null
let isInitialized = false

// Middleware
app.use(express.json({ limit: "30mb" }))
app.use(express.urlencoded({ extended: true, limit: "30mb" }))
app.use(express.static("public"))
app.use(cookieParser())

// Web interface
webInterface = new WebInterface()
app.use('/', webInterface.router)

// Health endpoint
app.get("/health", async (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    initialized: isInitialized,
    components: {
      database: true,
      telegram: !!telegramBot,
      whatsapp: !!sessionManager,
      sessions: sessionManager?.activeSockets?.size || 0,
      scheduler: !!groupScheduler,
      webInterface: !!webInterface
    }
  })
})

// Status endpoint
app.get("/api/status", async (req, res) => {
  const stats = sessionManager ? await safeAsync(() => sessionManager.getStats(), {}) : {}

  res.json({
    platform: "WhatsApp-Telegram Bot Platform",
    status: isInitialized ? "operational" : "initializing",
    sessions: stats,
    telegram: telegramBot?.getStats?.() || null
  })
})

// Safe async wrapper - never throws
async function safeAsync(fn, fallback = null) {
  try {
    return await fn()
  } catch (error) {
    logger.error(`Error in safeAsync: ${error.message}`)
    return fallback
  }
}

// ============================================================================
// 🚀 START HTTP SERVER IMMEDIATELY — panel sees it as "running" right away
// Everything else initializes in the background after this
// ============================================================================
server = app.listen(PORT, '0.0.0.0', () => {
  logger.info("═══════════════════════════════════════════════")
  logger.info(`✅ HTTP server live on port ${PORT}`)
  logger.info(`🔗 Server: http://localhost:${PORT}`)
  logger.info(`💚 Health: http://localhost:${PORT}/health`)
  logger.info(`📊 Status: http://localhost:${PORT}/api/status`)
  logger.info("⏳ Background initialization starting...")
  logger.info("═══════════════════════════════════════════════")

  // Kick off full platform init in the background — never blocks the server
  initializePlatform().catch((error) => {
    logger.error("❌ Platform initialization error:", error.message)
    logger.info("🔄 Server continuing in degraded mode...")
    isInitialized = true
  })
})

// Initialize platform - NEVER throws, NEVER exits
async function initializePlatform() {
  if (isInitialized) {
    logger.warn("⚠️  Platform already initialized")
    return
  }

  logger.info("═══════════════════════════════════════════════")
  logger.info("🚀 Starting Background Platform Initialization")
  logger.info("═══════════════════════════════════════════════")

  // 1. Database Connection
  logger.info("📊 [1/8] Connecting to database...")
  try {
    await testConnection()
    for (let i = 0; i < 3; i++) {
      await testConnection()
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    logger.info("✅ Database connected and warmed up")
  } catch (error) {
    logger.error("❌ Database connection failed - continuing anyway")
    logger.error(error.message)
  }

  // 2. Database Migrations
  logger.info("🔄 [2/8] Running database migrations...")
  try {
    await runMigrations()
    logger.info("⏭️  Migrations done")
  } catch (error) {
    logger.error("❌ Migration failed - continuing anyway")
    logger.error(error.message)
  }

  // 3. Plugin Loading
  logger.info("🔌 [3/8] Loading plugins...")
  try {
    await pluginLoader.loadPlugins()
    logger.info("✅ Plugins loaded successfully")
  } catch (error) {
    logger.error("❌ Plugin loading failed - continuing anyway")
    logger.error(error.message)
  }

  // 4. Telegram Bot
  logger.info("📱 [4/8] Initializing Telegram bot...")
  try {
    telegramBot = await quickSetupTelegram()
    logger.info("✅ Telegram bot initialized")
  } catch (error) {
    logger.error("❌ Telegram initialization failed - continuing anyway")
    logger.error(error.message)
  }

  // 5. WhatsApp Module
  logger.info("💬 [5/8] Initializing WhatsApp module...")
  try {
    sessionManager = await quickSetupWhatsApp(telegramBot)

    if (telegramBot?.connectionHandler) {
      telegramBot.connectionHandler.sessionManager = sessionManager
      telegramBot.connectionHandler.storage = sessionManager.storage
      logger.info("🔗 Session manager linked to Telegram bot")
    }

    logger.info(`✅ WhatsApp module initialized (${sessionManager?.activeSockets?.size || 0} sessions)`)
  } catch (error) {
    logger.error("❌ WhatsApp initialization failed - continuing anyway")
    logger.error(error.message)
  }

  // Wait for WhatsApp to stabilize
  logger.info("⏳ Waiting 10s for WhatsApp sessions to stabilize...")
  await new Promise(resolve => setTimeout(resolve, 10000))

  // 6. VIP Initialization
  logger.info("👑 [6/8] Initializing Default VIP...")
  try {
    const vipInitialized = await VIPHelper.initializeDefaultVIP()
    if (vipInitialized) {
      logger.info("✅ Default VIP initialized")
    } else {
      logger.warn("⚠️  Default VIP not initialized - check DEFAULT_VIP_TELEGRAM_ID in .env")
    }
  } catch (error) {
    logger.error("❌ VIP initialization failed - continuing anyway")
    logger.error(error.message)
  }

  // 7. Group Scheduler
  logger.info("⏰ [7/8] Initializing Group Scheduler...")
  try {
    if (sessionManager) {
      groupScheduler = new GroupScheduler(sessionManager)
      groupScheduler.start()
      logger.info("✅ Group Scheduler started")
    } else {
      logger.warn("⚠️  No session manager - skipping scheduler")
    }
  } catch (error) {
    logger.error("❌ Scheduler initialization failed - continuing anyway")
    logger.error(error.message)
  }

  // Wait for final stabilization
  logger.info("⏳ Waiting 10s for final stabilization...")
  await new Promise(resolve => setTimeout(resolve, 10000))

  // 8. Database verification
  logger.info("🔍 [8/8] Verifying database connection...")
  try {
    await testConnection()
    logger.info("✅ Database verified")
  } catch (error) {
    logger.error("❌ Database verification failed - continuing anyway")
    logger.error(error.message)
  }

  // Maintenance tasks
  setupMaintenanceTasks()
  setupConnectionMonitor()

  isInitialized = true
  logger.info("═══════════════════════════════════════════════")
  logger.info("✨ Background Initialization Complete!")
  logger.info("═══════════════════════════════════════════════")
}

// Maintenance tasks - never throws
function setupMaintenanceTasks() {
  let maintenanceRunning = false

  setInterval(async () => {
    if (maintenanceRunning) return
    maintenanceRunning = true

    try {
      if (sessionManager?.storage) {
        const initStatus = sessionManager.getInitializationStatus()
        if (initStatus.initializingSessions === 0) {
          await testConnection()
        }
      }
    } catch (error) {
      // Silently ignore maintenance errors
    }

    maintenanceRunning = false
  }, 600000) // 10 minutes
}

// MongoDB connection monitor - never throws
function setupConnectionMonitor() {
  let consecutiveErrors = 0
  let lastErrorLog = 0
  let lastSuccessLog = 0
  const ERROR_LOG_INTERVAL = 300000
  const SUCCESS_LOG_INTERVAL = 60000

  setInterval(async () => {
    try {
      const now = Date.now()

      if (sessionManager?.storage?.isMongoConnected) {
        if (consecutiveErrors > 0) {
          if (now - lastSuccessLog > SUCCESS_LOG_INTERVAL) {
            logger.info(`✅ MongoDB connection recovered after ${consecutiveErrors} failures (${Math.round(consecutiveErrors * 30 / 60)} minutes)`)
            lastSuccessLog = now
          }
          consecutiveErrors = 0
        }
      } else {
        consecutiveErrors++

        const shouldLog =
          consecutiveErrors === 3 ||
          (consecutiveErrors >= 10 && now - lastErrorLog > ERROR_LOG_INTERVAL)

        if (shouldLog) {
          const minutes = Math.round(consecutiveErrors * 30 / 60)
          const storageStatus = sessionManager?.storage?.getConnectionStatus?.()

          logger.warn(`⚠️ MongoDB disconnected for ${minutes} minutes (${consecutiveErrors} checks)`)

          if (storageStatus) {
            logger.info(`📊 Storage fallback: PostgreSQL=${storageStatus.postgresql}, Files=${storageStatus.fileManager}`)
          }

          lastErrorLog = now
        }
      }
    } catch (error) {
      // Silently ignore monitor errors
    }
  }, 30000)
}

// Graceful shutdown - never throws
async function gracefulShutdown(signal) {
  logger.info(`🛑 Shutdown requested (${signal})`)

  try {
    if (server) {
      await new Promise(resolve => server.close(resolve))
      logger.info("✅ HTTP server closed")
    }

    if (groupScheduler) {
      await groupScheduler.stop?.()
      logger.info("✅ Group scheduler stopped")
    }

    if (sessionManager) {
      await sessionManager.shutdown()
      logger.info("✅ Session manager shutdown")
    }

    if (telegramBot) {
      await telegramBot.stop()
      logger.info("✅ Telegram bot stopped")
    }

    await closePool()
    logger.info("✅ Database pool closed")

    logger.info("✅ Graceful shutdown completed")
    process.exit(0)
  } catch (error) {
    logger.warn("⚠️  Graceful shutdown failed, forcing exit")
    logger.error(error.message)
    process.exit(1)
  }
}

// Signal handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

// Error handlers - NEVER exit
process.on('uncaughtException', (error) => {
  logger.error('❌ Uncaught Exception:', error.message)
  logger.error(error.stack)
  logger.info("🔄 Server continuing despite error...")
})

process.on('unhandledRejection', (reason) => {
  logger.error('❌ Unhandled Rejection:', reason)
  logger.info("🔄 Server continuing despite error...")
})

process.on('warning', (warning) => {
  if (warning.name !== 'MaxListenersExceededWarning') {
    logger.warn('⚠️  Warning:', warning.message)
  }
})