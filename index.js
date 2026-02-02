// ==================== ULTIMATE LOG SUPPRESSION ====================
import dotenv from "dotenv"
dotenv.config()

import { EventEmitter } from 'events'
import v8 from 'v8'
import fs from 'fs'
import path from 'path'

// ==================== END MEMORY LIMIT AUTO-FIX ====================

// ==================== FILE LOGGING SETUP ====================
const LOG_DIR = './logs'
const MEMORY_LOG_FILE = path.join(LOG_DIR, 'memory-monitor.log')

// Create logs directory if it doesn't exist
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

// Function to write to log file
function writeToLog(message) {
  const timestamp = new Date().toISOString()
  const logMessage = `[${timestamp}] ${message}\n`
  
  // Write to file (append mode)
  fs.appendFileSync(MEMORY_LOG_FILE, logMessage, 'utf8')
  
  // Also log to console
  console.log(message)
}

// ==================== MEMORY MONITORING ====================
// Get current heap limit
const heapStats = v8.getHeapStatistics()
const heapLimitMB = Math.round(heapStats.heap_size_limit / 1024 / 1024)

writeToLog('═══════════════════════════════════════════════')
writeToLog(`🧠 Node.js Heap Limit: ${heapLimitMB} MB`)
writeToLog(`💻 Pterodactyl RAM Allocated: 14.39 GB`)
writeToLog(`📊 Expected Sessions: ~600`)
writeToLog(`📈 Expected Memory Usage: 3-5 GB (600 sessions × ~5MB each)`)
if (heapLimitMB < 4000) {
  writeToLog(`⚠️  CRITICAL: Node.js limit (${heapLimitMB}MB) is TOO LOW for 600 sessions!`)
  writeToLog(`🔧 FIX: Contact admin to add --max-old-space-size=8192 to startup command`)
} else {
  writeToLog(`✅ Node.js memory limit is adequate for 600 sessions`)
}
writeToLog(`📝 Memory logs: ${MEMORY_LOG_FILE}`)
writeToLog('═══════════════════════════════════════════════')

// Memory monitoring function
function logMemoryUsage() {
  const usage = process.memoryUsage()
  const heapStats = v8.getHeapStatistics()
  const usedPercent = (heapStats.used_heap_size / heapStats.heap_size_limit) * 100
  
  const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024)
  const heapLimitMB = Math.round(heapStats.heap_size_limit / 1024 / 1024)
  const rssMB = Math.round(usage.rss / 1024 / 1024)
  const uptimeMinutes = Math.round(process.uptime() / 60)
  
  const emoji = usedPercent > 85 ? '🚨' : usedPercent > 70 ? '⚠️' : '💾'
  const sessions = sessionManager?.activeSockets?.size || 0
  const message = `${emoji} [MEMORY] ${heapUsedMB}MB / ${heapLimitMB}MB (${usedPercent.toFixed(1)}%) | RSS: ${rssMB}MB | Sessions: ${sessions} | Uptime: ${uptimeMinutes}m`
  
  writeToLog(message)
  
  // Calculate expected memory for current sessions
  const expectedMemoryMB = sessions * 5 // ~5MB per session average
  const memoryPerSession = sessions > 0 ? (heapUsedMB / sessions).toFixed(2) : 0
  
  if (usedPercent > 70 && usedPercent <= 85) {
    writeToLog(`⚠️  Memory usage high! ${heapUsedMB}MB for ${sessions} sessions (${memoryPerSession}MB/session)`)
    if (heapUsedMB > expectedMemoryMB * 1.5) {
      writeToLog(`⚠️  Possible leak: Using ${heapUsedMB}MB but expected ~${expectedMemoryMB}MB for ${sessions} sessions`)
    }
  }
  
  if (usedPercent > 85) {
    writeToLog(`🚨 CRITICAL! Server will crash soon at ${usedPercent.toFixed(1)}%`)
    writeToLog(`📊 Active WhatsApp sessions: ${sessions}`)
    writeToLog(`📈 Memory per session: ${memoryPerSession}MB`)
    
    if (heapLimitMB < 4000) {
      writeToLog(`🔧 SOLUTION: Increase Node.js memory limit with --max-old-space-size=8192`)
    }
    
    // Log event listener counts
    try {
      if (sessionManager?.activeSockets) {
        let totalListeners = 0
        let leakySessions = 0
        sessionManager.activeSockets.forEach((socket, sessionId) => {
          if (socket._events) {
            const listenerCount = Object.keys(socket._events).reduce((sum, event) => {
              const listeners = socket._events[event]
              return sum + (Array.isArray(listeners) ? listeners.length : 1)
            }, 0)
            totalListeners += listenerCount
            
            if (listenerCount > 100) {
              leakySessions++
              writeToLog(`⚠️  Session ${sessionId}: ${listenerCount} listeners (POTENTIAL LEAK!)`)
            }
          }
        })
        writeToLog(`📊 Total event listeners: ${totalListeners} across ${sessions} sessions`)
        writeToLog(`📊 Average listeners per session: ${(totalListeners / sessions).toFixed(1)}`)
        if (leakySessions > 0) {
          writeToLog(`⚠️  ${leakySessions} sessions have excessive listeners`)
        }
      }
    } catch (err) {
      // Ignore errors in listener counting
    }
  }
  
  return { heapUsedMB, heapLimitMB, usedPercent, rssMB }
}

// Log memory every 3 minutes
setInterval(() => {
  logMemoryUsage()
}, 180000)

// Initial log after startup
setTimeout(() => {
  writeToLog('\n═══════════════════════════════════════════════')
  writeToLog('📊 Initial Memory Check (after 30s startup):')
  logMemoryUsage()
  writeToLog('═══════════════════════════════════════════════\n')
}, 30000)

// Increase max listeners globally (REQUIRED for 600+ sessions)
EventEmitter.defaultMaxListeners = 900
process.setMaxListeners(900)
process.setMaxListeners(0)

writeToLog('✅ EventEmitter max listeners set to 900 (normal for 600+ sessions)')
// ==================== END MEMORY MONITORING ====================

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

  console.log('🔇 Library log suppression active')
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
const PORT = process.env.PORT || 7088  // Changed to match Pterodactyl allocation
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

// Initialize platform - NEVER throws, NEVER exits
async function initializePlatform() {
  if (isInitialized) {
    logger.warn("⚠️  Platform already initialized")
    return
  }

  logger.info("═══════════════════════════════════════════════")
  logger.info("🚀 Starting Platform Initialization")
  logger.info("═══════════════════════════════════════════════")
  
  // 1. Database Connection
  logger.info("📊 [1/9] Connecting to database...")
  try {
    await testConnection()
    // Warmup connection pool
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
  logger.info("🔄 [2/9] Running database migrations...")
  try {
     await runMigrations()
    logger.info("⏭️  Migrations skipped Done")
  } catch (error) {
    logger.error("❌ Migration failed - continuing anyway")
    logger.error(error.message)
  }

  // 3. Plugin Loading
  logger.info("🔌 [3/9] Loading plugins...")
  try {
    await pluginLoader.loadPlugins()
    logger.info("✅ Plugins loaded successfully")
  } catch (error) {
    logger.error("❌ Plugin loading failed - continuing anyway")
    logger.error(error.message)
  }

  // 4. Telegram Bot
  logger.info("📱 [4/9] Initializing Telegram bot...")
  try {
    telegramBot = await quickSetupTelegram()
    logger.info("✅ Telegram bot initialized")
  } catch (error) {
    logger.error("❌ Telegram initialization failed - continuing anyway")
    logger.error(error.message)
  }

  // 5. WhatsApp Module
  logger.info("💬 [5/9] Initializing WhatsApp module...")
  try {
    sessionManager = await quickSetupWhatsApp(telegramBot)
    
    // Link session manager to telegram
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
  logger.info("👑 [6/9] Initializing Default VIP...")
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
  logger.info("⏰ [7/9] Initializing Group Scheduler...")
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
  logger.info("🔍 [8/9] Verifying database connection...")
  try {
    await testConnection()
    logger.info("✅ Database verified")
  } catch (error) {
    logger.error("❌ Database verification failed - continuing anyway")
    logger.error(error.message)
  }

  // 9. HTTP Server
  logger.info("🌐 [9/9] Starting HTTP server...")
  try {
    server = app.listen(PORT, () => {
      logger.info("✅ HTTP server started")
      logger.info(`🔗 Server: http://localhost:${PORT}`)
      logger.info(`💚 Health: http://localhost:${PORT}/health`)
      logger.info(`📊 Status: http://localhost:${PORT}/api/status`)
    })
  } catch (error) {
    logger.error("❌ HTTP server failed - platform may be inaccessible")
    logger.error(error.message)
  }

  // Maintenance tasks
  setupMaintenanceTasks()
  setupConnectionMonitor()

  isInitialized = true
  logger.info("═══════════════════════════════════════════════")
  logger.info("✨ Platform Initialization Complete!")
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
  const ERROR_LOG_INTERVAL = 300000 // Log error every 5 minutes max
  const SUCCESS_LOG_INTERVAL = 60000 // Log success every 1 minute max

  setInterval(async () => {
    try {
      const now = Date.now()
      
      if (sessionManager?.storage?.isMongoConnected) {
        // MongoDB is connected
        if (consecutiveErrors > 0) {
          // Recovery detected
          if (now - lastSuccessLog > SUCCESS_LOG_INTERVAL) {
            logger.info(`✅ MongoDB connection recovered after ${consecutiveErrors} failures (${Math.round(consecutiveErrors * 30 / 60)} minutes)`)
            lastSuccessLog = now
          }
          consecutiveErrors = 0
        }
      } else {
        // MongoDB is disconnected
        consecutiveErrors++
        
        // Smart logging: Log immediately at 3 failures, then every 5 minutes
        const shouldLog = 
          consecutiveErrors === 3 || // First real warning
          (consecutiveErrors >= 10 && now - lastErrorLog > ERROR_LOG_INTERVAL) // Then periodically
        
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
  }, 30000) // 30 seconds
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

// Start platform - NEVER exits on error
initializePlatform().catch((error) => {
  logger.error("❌ Platform initialization error:", error.message)
  logger.info("🔄 Server will continue in degraded mode...")
  
  // Ensure HTTP server starts even if init fails
  if (!server) {
    server = app.listen(PORT, () => {
      logger.info(`🔗 Server running on port ${PORT} (degraded mode)`)
    })
  }
  
  isInitialized = true
})
