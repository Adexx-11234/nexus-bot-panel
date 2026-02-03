# Fixes for the Auth State Issue

## Issue Analysis

The problem is that `cleanupSessionAuthData` is being called **during auth state retrieval**, not just during cleanup. Looking at the code, when MongoDB auth check fails (returns `false`), it's treated as "no auth found" which triggers a cleanup before even trying to create the session.

The flow is:
1. `generatePairingCode` → checks `authAvailability`
2. Auth check fails (returns `false`) 
3. Cleanup is triggered
4. Then it tries to create session (which creates NEW auth)
5. But the cleanup already happened, causing confusion

---

## 1. Fix in OLD session-manager.js

**Location:** `whatsapp/sessions/session-manager.js` (the old file you're currently using)

### **Fix the `generatePairingCode` method in telegram/handlers/connection.js:**

```javascript
// REPLACE THIS SECTION in telegram/handlers/connection.js:

async generatePairingCode(userId, phoneNumber, userInfo) {
  try {
    const sessionId = `session_${userId}`

    logger.info(`Generating pairing code for ${phoneNumber} (user: ${userId})`)

    // REMOVE THIS ENTIRE BLOCK - DON'T CHECK AUTH BEFORE PAIRING:
    /*
    // Check if session already exists with valid auth
    const authAvailability = await this.sessionManager.sessionConnection.checkAuthAvailability(sessionId)
    if (authAvailability.preferred !== 'none') {
      logger.warn(`Session ${sessionId} already has auth data (${authAvailability.preferred}), cleaning before new pairing`)
      await this.sessionManager.performCompleteUserCleanup(sessionId)
      await new Promise(resolve => setTimeout(resolve, 2000))
      logger.info(`Cleanup completed for ${sessionId}, proceeding with pairing`)
    }
    */

    // INSTEAD, JUST CREATE THE SESSION - LET IT HANDLE AUTH INTERNALLY
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        logger.error(`Pairing code generation timeout for ${userId}`)
        resolve({ success: false, error: "Connection timeout. Please try again." })
      }, 60000)

      this.sessionManager.createSession(userId, phoneNumber, {
        
        onPairingCode: (code) => {
          clearTimeout(timeout)
          logger.info(`Pairing code generated for ${userId}: ${code}`)
          resolve({ success: true, code })
        },
        
        onConnected: async (socket) => {
          clearTimeout(timeout)
          logger.info(`WhatsApp connected for user ${userId}: ${phoneNumber}`)
          
          await new Promise(resolve => setTimeout(resolve, 2000))
          
          if (socket?.user && socket.readyState === socket.ws?.OPEN) {
            await this.handleConnectionSuccess(sessionId, phoneNumber, userId)
          } else {
            logger.warn(`Socket disconnected immediately after connection for ${userId}`)
            resolve({ success: false, error: "Connection unstable. Please try again." })
          }
        },
        
        onError: (error) => {
          clearTimeout(timeout)
          logger.error(`Session creation error for ${userId}:`, error)
          
          const errorMessage = error.message || "Connection failed"
          
          if (errorMessage.includes('401')) {
            resolve({ success: false, error: "Invalid session. Please try connecting again." })
          } else if (errorMessage.includes('timeout')) {
            resolve({ success: false, error: "Connection timeout. Please check your internet and try again." })
          } else if (errorMessage.includes('auth')) {
            resolve({ success: false, error: "Authentication failed. Please try again." })
          } else {
            resolve({ success: false, error: errorMessage })
          }
        }
        
      }, false, 'telegram', true) // IMPORTANT: allowPairing = true
      .catch(error => {
        clearTimeout(timeout)
        logger.error(`Session creation failed for ${userId}:`, error)
        
        const errorMessage = error.message || "Failed to create session"
        
        if (errorMessage.includes('Maximum sessions limit')) {
          resolve({ success: false, error: "Server is at capacity. Please try again in a few minutes." })
        } else {
          resolve({ success: false, error: errorMessage })
        }
      })
    })

  } catch (error) {
    logger.error("Pairing code generation error:", error)
    return { 
      success: false, 
      error: error.message || "Unexpected error occurred. Please try again." 
    }
  }
}
```

### **The Key Changes:**
1. ✅ **REMOVED** auth availability check before pairing
2. ✅ **REMOVED** cleanup before pairing
3. ✅ Let `createSession` handle everything internally
4. ✅ Session creation will create fresh auth if needed

---

## 2. Fix in NEW whatsapp/sessions/manager.js

**Location:** In the new organized structure

### **In `sessions/manager.js`, update the `createSession` method:**

```javascript
// Around line 200-250 in the new manager.js

async createSession(userId, phoneNumber = null, callbacks = {}, isReconnect = false, source = 'telegram', allowPairing = true) {
  const userIdStr = String(userId)
  const sessionId = userIdStr.startsWith('session_') ? userIdStr : `session_${userIdStr}`
  
  // Prevent duplicate session creation
  if (this.initializingSessions.has(sessionId)) {
    logger.warn(`Session ${sessionId} already initializing`)
    return this.activeSockets.get(sessionId)
  }
  
  if (this.activeSockets.has(sessionId) && !isReconnect) {
    logger.info(`Session ${sessionId} already exists`)
    return this.activeSockets.get(sessionId)
  }

  // Check session limit
  if (this.activeSockets.size >= this.maxSessions) {
    throw new Error(`Maximum sessions limit (${this.maxSessions}) reached`)
  }

  this.initializingSessions.add(sessionId)
  
  try {
    // ADD THIS: Only cleanup if it's a reconnect OR if there's existing auth AND socket
    if (isReconnect) {
      await this._cleanupExistingSession(sessionId)
    } else if (allowPairing) {
      // NEW PAIRING: Check if there's stale auth that needs cleanup
      const existingSocket = this.activeSockets.has(sessionId)
      const authAvailability = await this.connectionManager.checkAuthAvailability(sessionId)
      
      // Only cleanup if there's BOTH old auth AND no active socket (stale session)
      if (authAvailability.preferred !== 'none' && !existingSocket) {
        logger.info(`Cleaning up stale auth for new pairing: ${sessionId}`)
        await this.performCompleteUserCleanup(sessionId)
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
    
    // Create socket connection
    const sock = await this.connectionManager.createConnection(
      sessionId,
      phoneNumber,
      callbacks,
      allowPairing
    )

    if (!sock) throw new Error('Failed to create socket connection')

    // ... rest of the method stays the same
```

---

## 3. Fix telegram/handlers/connection.js (Full Update)

**Replace the entire file with:**

```javascript
import { TelegramMessages } from "../utils/messages.js"
import { TelegramKeyboards } from "../utils/keyboards.js"
import { validatePhone } from "../utils/validation.js"
import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("CONNECTION_HANDLER")

export class ConnectionHandler {
  constructor(bot) {
    this.bot = bot
    this.pendingConnections = new Map()
    this.sessionManager = null
    this.storage = null
  }

  /**
   * Initialize dependencies (lazy loading)
   */
  async _ensureDependencies() {
    if (!this.sessionManager || !this.storage) {
      const { getSessionManager } = await import('../../whatsapp/index.js')
      this.sessionManager = getSessionManager()
      this.storage = this.sessionManager.storage
    }
  }

  /**
   * Handle initial connection request
   */
  async handleConnect(chatId, userId, userInfo) {
    try {
      await this._ensureDependencies()
      
      const sessionId = `session_${userId}`
      
      // Check if user is actually connected
      const isReallyConnected = await this.sessionManager.isReallyConnected(sessionId)
      
      if (isReallyConnected) {
        const session = await this.storage.getSession(sessionId)
        return this.bot.sendMessage(
          chatId,
          TelegramMessages.alreadyConnected(session.phoneNumber),
          { 
            parse_mode: "Markdown",
            reply_markup: TelegramKeyboards.mainMenu() 
          }
        )
      }

      // Start connection flow
      this.pendingConnections.set(userId, { 
        step: 'phone',
        timestamp: Date.now(),
        userInfo
      })
      
      await this.bot.sendMessage(
        chatId,
        TelegramMessages.askPhoneNumber(),
        { 
          parse_mode: "Markdown",
          reply_markup: TelegramKeyboards.connecting()
        }
      )

      // Auto-cleanup after 5 minutes
      setTimeout(() => {
        if (this.pendingConnections.has(userId)) {
          this.pendingConnections.delete(userId)
        }
      }, 300000)

    } catch (error) {
      logger.error("Connection initiation error:", error)
      await this.bot.sendMessage(chatId, TelegramMessages.error("Failed to start connection"))
    }
  }

  /**
   * Handle phone number input
   */
  async handlePhoneNumber(msg) {
    const userId = msg.from.id
    const chatId = msg.chat.id
    const phone = msg.text.trim()

    const pending = this.pendingConnections.get(userId)
    if (!pending || pending.step !== 'phone') {
      return false
    }

    try {
      await this._ensureDependencies()

      // Validate phone
      const validation = validatePhone(phone)
      if (!validation.isValid) {
        await this.bot.sendMessage(
          chatId, 
          TelegramMessages.invalidPhone(),
          {
            parse_mode: "Markdown",
            reply_markup: TelegramKeyboards.connecting()
          }
        )
        return true
      }

      // Update state
      this.pendingConnections.set(userId, { 
        step: 'generating',
        phone: validation.formatted,
        userInfo: pending.userInfo,
        timestamp: Date.now()
      })

      // Show loading
      const loadingMsg = await this.bot.sendMessage(
        chatId,
        TelegramMessages.connecting(),
        { parse_mode: "Markdown" }
      )

      // Generate code
      const result = await this.generatePairingCode(userId, validation.formatted, pending.userInfo)
      
      // Delete loading
      await this.bot.deleteMessage(chatId, loadingMsg.message_id)

      if (result.success) {
        await this.bot.sendMessage(
          chatId,
          TelegramMessages.showPairingCode(result.code),
          { 
            parse_mode: "Markdown",
            reply_markup: TelegramKeyboards.codeOptions(result.code)
          }
        )

        // Update state
        this.pendingConnections.set(userId, { 
          step: 'waiting_connection',
          phone: validation.formatted,
          code: result.code,
          userInfo: pending.userInfo,
          timestamp: Date.now()
        })

        // Cleanup after 2 minutes
        setTimeout(() => {
          if (this.pendingConnections.get(userId)?.code === result.code) {
            this.pendingConnections.delete(userId)
          }
        }, 120000)

      } else {
        await this.bot.sendMessage(
          chatId, 
          TelegramMessages.error(result.error || "Could not generate pairing code")
        )
        this.pendingConnections.delete(userId)
      }

      return true

    } catch (error) {
      logger.error("Phone number handling error:", error)
      await this.bot.sendMessage(chatId, TelegramMessages.error("Failed to process phone number"))
      this.pendingConnections.delete(userId)
      return true
    }
  }

  /**
   * Generate pairing code - FIXED VERSION
   */
  async generatePairingCode(userId, phoneNumber, userInfo) {
    try {
      await this._ensureDependencies()
      
      const sessionId = `session_${userId}`
      logger.info(`Generating pairing code for ${phoneNumber} (user: ${userId})`)

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          logger.error(`Pairing timeout for ${userId}`)
          resolve({ success: false, error: "Connection timeout. Please try again." })
        }, 60000)

        this.sessionManager.createSession(userId, phoneNumber, {
          
          onPairingCode: (code) => {
            clearTimeout(timeout)
            logger.info(`Pairing code generated for ${userId}: ${code}`)
            resolve({ success: true, code })
          },
          
          onConnected: async (socket) => {
            clearTimeout(timeout)
            logger.info(`WhatsApp connected for ${userId}: ${phoneNumber}`)
            
            await new Promise(resolve => setTimeout(resolve, 2000))
            
            if (socket?.user && socket.readyState === socket.ws?.OPEN) {
              await this.handleConnectionSuccess(sessionId, phoneNumber, userId)
            } else {
              resolve({ success: false, error: "Connection unstable" })
            }
          },
          
          onError: (error) => {
            clearTimeout(timeout)
            logger.error(`Session error for ${userId}:`, error)
            resolve({ success: false, error: error.message || "Connection failed" })
          }
          
        }, false, 'telegram', true) // allowPairing = true
        .catch(error => {
          clearTimeout(timeout)
          logger.error(`Session creation failed for ${userId}:`, error)
          resolve({ success: false, error: error.message || "Failed to create session" })
        })
      })

    } catch (error) {
      logger.error("Pairing code generation error:", error)
      return { success: false, error: error.message || "Unexpected error" }
    }
  }

  /**
   * Handle connection success
   */
  async handleConnectionSuccess(sessionId, phoneNumber, userId) {
    try {
      logger.info(`Connection successful for ${userId}: ${phoneNumber}`)
      this.pendingConnections.delete(userId)

      await this.bot.sendMessage(
        userId, 
        TelegramMessages.connected(phoneNumber),
        {
          parse_mode: 'Markdown',
          reply_markup: TelegramKeyboards.backButton("main_menu")
        }
      )
    } catch (error) {
      logger.error("Connection success handler error:", error)
    }
  }

  /**
   * Handle disconnect
   */
  async handleDisconnect(chatId, userId) {
    try {
      await this._ensureDependencies()
      
      const session = await this.storage.getSession(`session_${userId}`)
      
      if (!session || !session.isConnected) {
        return this.bot.sendMessage(
          chatId,
          TelegramMessages.notConnected(),
          { 
            parse_mode: "Markdown",
            reply_markup: TelegramKeyboards.mainMenu() 
          }
        )
      }

      await this.bot.sendMessage(
        chatId,
        TelegramMessages.confirmDisconnect(session.phoneNumber),
        { 
          parse_mode: "Markdown",
          reply_markup: TelegramKeyboards.confirmDisconnect()
        }
      )
    } catch (error) {
      logger.error("Disconnect request error:", error)
      await this.bot.sendMessage(chatId, TelegramMessages.error("Failed to disconnect"))
    }
  }

  /**
   * Confirm disconnect
   */
  async confirmDisconnect(chatId, userId) {
    let processingMsg
    try {
      await this._ensureDependencies()
      
      const session = await this.storage.getSession(`session_${userId}`)
      
      processingMsg = await this.bot.sendMessage(
        chatId, 
        TelegramMessages.disconnecting(session?.phoneNumber || "WhatsApp")
      )

      const sessionId = `session_${userId}`
      await this.sessionManager.performCompleteUserCleanup(sessionId)

      await this.bot.deleteMessage(chatId, processingMsg.message_id)

      await this.bot.sendMessage(
        chatId,
        TelegramMessages.disconnected(),
        { 
          parse_mode: "Markdown",
          reply_markup: TelegramKeyboards.mainMenu() 
        }
      )

      logger.info(`User ${userId} disconnected successfully`)
    } catch (error) {
      logger.error("Disconnect error:", error)
      if (processingMsg) {
        await this.bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {})
      }
      await this.bot.sendMessage(chatId, TelegramMessages.error("Failed to disconnect"))
    }
  }

  /**
   * Handle status check
   */
  async handleStatus(chatId, userId) {
    try {
      await this._ensureDependencies()
      
      const sessionId = `session_${userId}`
      const isConnected = await this.sessionManager.isReallyConnected(sessionId)
      const session = await this.storage.getSession(sessionId)
      
      await this.bot.sendMessage(
        chatId,
        TelegramMessages.status(isConnected, session?.phoneNumber),
        { 
          parse_mode: "Markdown",
          reply_markup: TelegramKeyboards.mainMenu()
        }
      )
    } catch (error) {
      logger.error("Status check error:", error)
      await this.bot.sendMessage(chatId, TelegramMessages.error("Failed to check status"))
    }
  }

  // Helper methods
  isPendingConnection(userId) {
    return this.pendingConnections.has(userId)
  }

  getPendingConnection(userId) {
    return this.pendingConnections.get(userId)
  }

  clearPending(userId) {
    this.pendingConnections.delete(userId)
  }
}
```

---

## 4. Fix web/services/session-service.js

```javascript
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('WEB_SESSION_SERVICE')

export class WebSessionService {
  constructor() {
    this.sessionManager = null
    this.storage = null
    this.pairingCodes = new Map()
  }

  /**
   * Initialize dependencies (lazy loading)
   */
  async _ensureDependencies() {
    if (!this.sessionManager || !this.storage) {
      const { getSessionManager } = await import('../../whatsapp/index.js')
      this.sessionManager = getSessionManager()
      this.storage = this.sessionManager.storage
    }
  }

  async getSessionStatus(sessionId) {
    try {
      await this._ensureDependencies()
      
      const session = await this.storage.getSession(sessionId)
      const hasActiveSocket = this.sessionManager.activeSockets.has(sessionId)
      const isReallyConnected = await this.sessionManager.isReallyConnected(sessionId)

      return {
        sessionId,
        isConnected: session?.isConnected || false,
        connectionStatus: session?.connectionStatus || 'disconnected',
        phoneNumber: session?.phoneNumber || null,
        hasActiveSocket,
        canReconnect: !hasActiveSocket && session?.phoneNumber,
        reconnectAttempts: session?.reconnectAttempts || 0,
        source: session?.source || 'web'
      }
    } catch (error) {
      logger.error('Get session status error:', error)
      return {
        sessionId,
        isConnected: false,
        connectionStatus: 'disconnected',
        phoneNumber: null,
        hasActiveSocket: false,
        canReconnect: false
      }
    }
  }

  async createSession(userId, phoneNumber) {
    try {
      await this._ensureDependencies()
      
      const sessionId = `session_${userId}`

      const existingStatus = await this.getSessionStatus(sessionId)
      if (existingStatus.isConnected) {
        return { success: false, error: 'Session already connected' }
      }

      this.sessionManager.clearVoluntaryDisconnection(sessionId)

      const callbacks = {
        onQR: (qr) => {
          logger.info(`QR code generated for ${sessionId}`)
        },
        onPairingCode: (code) => {
          logger.info(`Pairing code generated for ${sessionId}: ${code}`)
          this.pairingCodes.set(sessionId, {
            code,
            timestamp: Date.now()
          })
        },
        onConnected: async () => {
          logger.info(`Session connected: ${sessionId}`)
          this.pairingCodes.delete(sessionId)
        },
        onError: (error) => {
          logger.error(`Session error for ${sessionId}:`, error)
        }
      }

      const sock = await this.sessionManager.createSession(
        userId,
        phoneNumber,
        callbacks,
        false,
        'web',
        true // Allow pairing
      )

      if (!sock) {
        return { success: false, error: 'Failed to create session' }
      }

      return {
        success: true,
        sessionId,
        message: 'Session created successfully'
      }
    } catch (error) {
      logger.error('Create session error:', error)
      return { success: false, error: error.message || 'Failed to create session' }
    }
  }

  // ... rest of methods stay the same but add _ensureDependencies() at start of each
}
```

---

## 5. Fix index.js (Main Startup)

```javascript
// REPLACE these imports:
import { WhatsAppClient } from "./whatsapp/client.js"
import { initializeSessionManager } from "./whatsapp/sessions/session-manager.js"

// WITH:
import { initializeWhatsAppModule } from "./whatsapp/index.js"

// THEN REPLACE initialization section:

// OLD WAY:
/*
// 4. Session Manager
logger.info("Initializing session manager...")
sessionManager = initializeSessionManager(telegramBot)

// 5. Initialize existing sessions
logger.info("Initializing existing sessions...")
const { initialized, total } = await sessionManager.initializeExistingSessions()
logger.info(`Sessions: ${initialized}/${total} initialized`)

// ... wait for stabilization...

// 7. WhatsApp Client
logger.info("Initializing WhatsApp client...")
whatsappClient = new WhatsAppClient(pluginLoader)
whatsappClient.setTelegramBot(telegramBot)
*/

// NEW WAY:
// 4. WhatsApp Module (includes session manager)
logger.info("Initializing WhatsApp module...")
sessionManager = await initializeWhatsAppModule(telegramBot, {
  sessionDir: './sessions',
  enableEventHandlers: false, // Enable after stabilization
  initializeSessions: true
})

logger.info(`Sessions initialized: ${sessionManager.activeSockets.size} active`)

// 5. Wait for sessions to stabilize
logger.info("Waiting for sessions to stabilize...")
await new Promise(resolve => setTimeout(resolve, 10000))

// Verify database
await testConnection()

// 6. Enable event handlers now
logger.info("Enabling event handlers...")
sessionManager.enableEventHandlers()
```

---

## 6. Full Implementation Guide Using whatsapp/index.js

### **Option 1: Quick Setup (Recommended)**

```javascript
import { quickSetup } from './whatsapp/index.js'

// One-liner setup
const sessionManager = await quickSetup(telegramBot)

// Now you can use it
const sock = await sessionManager.createSession(userId, phoneNumber)
```

### **Option 2: Custom Setup**

```javascript
import { initializeWhatsAppModule } from './whatsapp/index.js'

const sessionManager = await initializeWhatsAppModule(telegramBot, {
  sessionDir: './my-sessions',
  enableEventHandlers: true,
  initializeSessions: true
})
```

### **Option 3: Manual Control**

```javascript
import {
  getSessionManager,
  EventDispatcher,
  MessageProcessor
} from './whatsapp/index.js'

// Get session manager
const sessionManager = getSessionManager()
await sessionManager.initialize()

// Create session
const sock = await sessionManager.createSession(userId, phoneNumber, {
  onPairingCode: (code) => //console.log('Code:', code),
  onConnected: () => //console.log('Connected!'),
  onError: (error) => console.error('Error:', error)
})

// Setup events
const dispatcher = new EventDispatcher(sessionManager)
dispatcher.setupEventHandlers(sock, sessionId)
```

### **Using Utilities:**

```javascript
import {
  normalizeJid,
  validatePhoneNumber,
  isGroupAdmin,
  formatFileSize
} from './whatsapp/index.js'

// JID operations
const jid = normalizeJid(userInput)

// Validation
if (validatePhoneNumber(phone)) {
  // Process
}

// Admin check
const isAdmin = await isGroupAdmin(sock, groupJid, userJid)

// Formatting
const size = formatFileSize(bytes)
```

---

## Summary of Fixes

1. ✅ **Removed premature auth check** in `generatePairingCode`
2. ✅ **Fixed telegram handler** to use lazy-loaded dependencies
3. ✅ **Fixed web session service** to use lazy-loaded dependencies
4. ✅ **Updated index.js** to use new organized whatsapp module
5. ✅ **Fixed session creation** to only cleanup stale auth, not fresh attempts

The key issue was checking and cleaning auth **before** allowing the pairing process to create new auth. Now it properly lets the session creation flow handle everything.