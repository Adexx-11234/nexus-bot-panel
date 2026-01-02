import { createComponentLogger } from '../../utils/logger.js'
import { useMultiFileAuthState, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys'
import pino from 'pino'
import { extendSocket } from "./socket-extensions.js"
import fs from 'fs/promises'
import path from 'path'

const logger = createComponentLogger('CONNECTION_MANAGER')

// ✅ Socket Inspector - Logs all property accesses to JSON
function createSocketInspector(sock, sessionId) {
  const inspectionLog = {
    sessionId,
    timestamp: new Date().toISOString(),
    properties: {},
    methods: {},
    eventListeners: [],
    propertyAccesses: [],
    methodCalls: []
  }

  // Helper to serialize values safely
  const serializeValue = (value, depth = 0) => {
    if (depth > 3) return '[Max Depth Reached]'
    
    if (value === null) return null
    if (value === undefined) return '[undefined]'
    
    const type = typeof value
    
    if (type === 'function') {
      return {
        type: 'function',
        name: value.name || '[anonymous]',
        length: value.length
      }
    }
    
    if (type === 'symbol') return value.toString()
    if (type === 'bigint') return value.toString()
    if (type === 'boolean' || type === 'number' || type === 'string') return value
    
    if (value instanceof Date) return value.toISOString()
    if (value instanceof RegExp) return value.toString()
    if (value instanceof Error) {
      return {
        type: 'Error',
        name: value.name,
        message: value.message,
        stack: value.stack
      }
    }
    
    if (Buffer.isBuffer(value)) {
      return {
        type: 'Buffer',
        length: value.length,
        preview: value.slice(0, 20).toString('hex')
      }
    }
    
    if (Array.isArray(value)) {
      return value.slice(0, 10).map(v => serializeValue(v, depth + 1))
    }
    
    if (type === 'object') {
      try {
        const obj = {}
        const keys = Object.keys(value).slice(0, 20) // Limit to 20 keys
        
        for (const key of keys) {
          try {
            obj[key] = serializeValue(value[key], depth + 1)
          } catch (e) {
            obj[key] = `[Error: ${e.message}]`
          }
        }
        
        return obj
      } catch (e) {
        return `[Error serializing: ${e.message}]`
      }
    }
    
    return String(value)
  }

  // Snapshot initial state
  const captureInitialState = () => {
    try {
      const keys = Object.keys(sock)
      
      for (const key of keys) {
        try {
          const value = sock[key]
          const type = typeof value
          
          if (type === 'function') {
            inspectionLog.methods[key] = {
              name: value.name || key,
              length: value.length,
              isAsync: value.constructor.name === 'AsyncFunction'
            }
          } else {
            inspectionLog.properties[key] = {
              type: type,
              value: serializeValue(value, 0),
              writable: true,
              enumerable: true
            }
          }
        } catch (e) {
          inspectionLog.properties[key] = {
            error: e.message
          }
        }
      }
      
      // Special handling for important objects
      if (sock.ws) {
        inspectionLog.properties.ws_details = {
          type: 'WebSocket',
          readyState: sock.ws.socket?._readyState,
          url: sock.ws.socket?.url,
          protocol: sock.ws.socket?.protocol
        }
      }
      
      if (sock.ev) {
        inspectionLog.properties.ev_details = {
          type: 'EventEmitter',
          isBuffering: typeof sock.ev.isBuffering === 'function' ? sock.ev.isBuffering() : false,
          listenerCount: sock.ev.listenerCount ? sock.ev.listenerCount('connection.update') : 'unknown'
        }
      }
      
      if (sock.user) {
        inspectionLog.properties.user_details = serializeValue(sock.user, 0)
      }
      
      if (sock.authState) {
        inspectionLog.properties.authState_details = {
          type: 'AuthState',
          hasCreds: !!sock.authState?.creds,
          hasKeys: !!sock.authState?.keys
        }
      }
      
    } catch (e) {
      inspectionLog.captureError = e.message
    }
  }

  captureInitialState()

  // Create proxy to track runtime access
  const handler = {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      
      // Log property access
      inspectionLog.propertyAccesses.push({
        timestamp: Date.now(),
        property: String(prop),
        type: typeof value,
        value: serializeValue(value, 0)
      })
      
      // If it's a function, wrap it to log calls
      if (typeof value === 'function') {
        return new Proxy(value, {
          apply(target, thisArg, argumentsList) {
            inspectionLog.methodCalls.push({
              timestamp: Date.now(),
              method: String(prop),
              args: argumentsList.map(arg => serializeValue(arg, 0))
            })
            
            return Reflect.apply(target, thisArg, argumentsList)
          }
        })
      }
      
      return value
    },
    
    set(target, prop, value) {
      inspectionLog.propertyAccesses.push({
        timestamp: Date.now(),
        property: String(prop),
        type: 'SET',
        value: serializeValue(value, 0)
      })
      
      return Reflect.set(target, prop, value)
    }
  }

  const proxySock = new Proxy(sock, handler)
  
  // Save inspection log to file
  const saveLog = async () => {
    try {
      const logsDir = path.join(process.cwd(), 'socket-inspections')
      await fs.mkdir(logsDir, { recursive: true })
      
      const filename = `sock_${sessionId}_${Date.now()}.json`
      const filepath = path.join(logsDir, filename)
      
      // Limit log size
      const limitedLog = {
        ...inspectionLog,
        propertyAccesses: inspectionLog.propertyAccesses.slice(-100), // Last 100 accesses
        methodCalls: inspectionLog.methodCalls.slice(-50) // Last 50 calls
      }
      
      await fs.writeFile(filepath, JSON.stringify(limitedLog, null, 2))
      logger.info(`📝 Socket inspection saved: ${filename}`)
      
      return filepath
    } catch (e) {
      logger.error(`Failed to save socket inspection:`, e)
      return null
    }
  }

  // Save log after 5 seconds and return the save function
  setTimeout(saveLog, 5000)
  
  // Attach save function to proxy for manual saving
  proxySock._saveInspectionLog = saveLog
  
  return proxySock
}

export class ConnectionManager {
  constructor() {
    this.fileManager = null
    this.mongoClient = null
    this.mongoStorage = null
    this.activeSockets = new Map()
    this.pairingInProgress = new Set()
    this.connectionTimeouts = new Map()
    this.enableSocketInspection = process.env.INSPECT_SOCKETS === 'true' // Enable via env var
  }

  initialize(fileManager, storage = null) {
  this.fileManager = fileManager
  this.storage = storage  // Store entire storage object
  
  // ✅ Dynamic getters for MongoDB state
  Object.defineProperty(this, 'mongoClient', {
    get() {
      return this.storage?.client || null
    }
  })
  
  Object.defineProperty(this, 'mongoStorage', {
    get() {
      return this.storage?.mongoStorage || null
    }
  })
  
  Object.defineProperty(this, 'isMongoAvailable', {
    get() {
      return !!(this.storage?.isMongoConnected && this.storage?.mongoStorage?.isConnected)
    }
  })
  
  logger.info('Connection manager initialized')
  
  if (this.enableSocketInspection) {
    logger.info('🔍 Socket inspection ENABLED - logs will be saved to socket-inspections/')
  }
}

async createConnection(sessionId, phoneNumber = null, callbacks = {}, allowPairing = true) {
  try {
    logger.info(`Creating connection for ${sessionId}`)

    // Get authentication state
    const authState = await this._getAuthState(sessionId, allowPairing)
    if (!authState) {
      throw new Error('Failed to get authentication state')
    }

    // ✅ Create store BEFORE socket
    const { createSessionStore, createBaileysSocket, bindStoreToSocket } = await import('./config.js')
    
    // ✅ CRITICAL FIX: Import proto for fallback
    const { proto } = await import('@whiskeysockets/baileys')
    
    const store = createSessionStore(sessionId)

    // ✅ CRITICAL FIX: Create fast getMessage with in-memory cache
    // This prevents slow store lookups from causing 408 timeouts
    const messageCache = new Map()  // Fast in-memory cache
    const maxCacheSize = 1000
    let cacheHits = 0
    let cacheMisses = 0
    
    const getMessage = async (key) => {
      if (!key || !key.remoteJid || !key.id) {
        return proto.Message.fromObject({})
      }
      
      const cacheKey = `${key.remoteJid}:${key.id}`
      
      // ✅ FAST PATH: Check in-memory cache first (< 1ms)
      if (messageCache.has(cacheKey)) {
        cacheHits++
        return messageCache.get(cacheKey)
      }
      
      cacheMisses++
      
      // ✅ SLOW PATH: Try store lookup (50-200ms)
      if (store) {
        try {
          const msg = await Promise.race([
            store.loadMessage(key.remoteJid, key.id),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('getMessage timeout')), 5000)
            )
          ])
          
          if (msg?.message) {
            // ✅ Cache for next time
            if (messageCache.size >= maxCacheSize) {
              const firstKey = messageCache.keys().next().value
              messageCache.delete(firstKey)
            }
            messageCache.set(cacheKey, msg.message)
            return msg.message
          }
        } catch (error) {
          // Store lookup failed or timed out
          logger.debug(`getMessage store lookup failed for ${key.id}: ${error.message}`)
        }
      }
      
      // ✅ FALLBACK: Return empty message to continue processing
      // This prevents blocking the entire message pipeline
      return proto.Message.fromObject({})
    }
    
    // Store cache stats for monitoring
    getMessage._cacheHits = () => cacheHits
    getMessage._cacheMisses = () => cacheMisses
    getMessage._cacheSize = () => messageCache.size
        

    // ✅ Create socket WITH getMessage function
    let sock = createBaileysSocket(authState.state, sessionId, getMessage)
    extendSocket(sock)
    
    // ✅ NEW: Install session error recovery handler
    // Automatically requests pre-keys when "No matching sessions found" error occurs
    try {
      const { integratSessionErrorRecovery } = await import('./session-error-handler.js')
      integratSessionErrorRecovery(sock, sessionId)
      logger.info(`[${sessionId}] ✅ Session error recovery handler installed`)
    } catch (handlerError) {
      logger.warn(`[${sessionId}] Failed to install session error handler: ${handlerError.message}`)
    }
    
    // ✅ INSPECTION: Wrap socket with proxy if enabled
    if (this.enableSocketInspection) {
      logger.info(`🔍 Inspecting socket for ${sessionId}`)
      sock = createSocketInspector(sock, sessionId)
    }
    
    // ✅ Bind store to socket IMMEDIATELY
    logger.info(`Binding store to socket for ${sessionId}`)
    await bindStoreToSocket(sock, sessionId)
    
    // ✅ Give store time to sync initial data (reduced for faster initialization)
    await new Promise(resolve => setTimeout(resolve, 500))
    
    logger.info(`Store bound and ready for ${sessionId}`)

    // Setup credentials update handler
    sock.ev.on('creds.update', authState.saveCreds)

    // Store socket metadata
    sock.sessionId = sessionId
    sock.authMethod = authState.method
    sock.authCleanup = authState.cleanup
    sock.connectionCallbacks = callbacks
    sock._sessionStore = store
    sock._storeCleanup = () => {
      if (authState.cleanup) authState.cleanup()
    }

    // ⚠️ REMOVED: ev.process() was causing message duplication
    // The dispatcher.js already has sock.ev.on(MESSAGES_UPSERT) handler
    // that captures ALL messages (including buffered ones from Baileys).
    // Using BOTH ev.process() AND sock.ev.on() causes messages to be processed twice.
    
    // Track active socket
    this.activeSockets.set(sessionId, sock)

    // Handle pairing if needed
    if (allowPairing && phoneNumber && !authState.state.creds?.registered) {
      this._schedulePairing(sock, sessionId, phoneNumber, callbacks)
    }

    logger.info(`Socket created for ${sessionId} using ${authState.method} auth`)
    return sock

  } catch (error) {
    logger.error(`Failed to create connection for ${sessionId}:`, error)
    throw error
  }
}

// ============================================================================
// REPLACE _getAuthState in connection-manager.js
// This fixes MongoDB auth detection for pairing sessions
// ============================================================================

async _getAuthState(sessionId, allowPairing = true) {
  try {
    logger.info(`[${sessionId}] 🔍 Getting auth state (pairing: ${allowPairing})`)
    
    // ✅ CRITICAL: Check CURRENT MongoDB status dynamically
    const isMongoAvailable = this.isMongoAvailable
    
    logger.info(`[${sessionId}] ℹ️ MongoDB status: ${isMongoAvailable ? 'AVAILABLE ✅' : 'NOT AVAILABLE ❌'}`)
    
    // Try MongoDB first if available RIGHT NOW
    if (isMongoAvailable && this.mongoStorage) {
      try {
        const { useMongoDBAuthState } = await import('../storage/index.js')
        
        logger.info(`[${sessionId}] 📦 Attempting MongoDB auth (Pairing: ${allowPairing})`)
        
        const mongoAuth = await useMongoDBAuthState(
          this.mongoStorage, 
          sessionId, 
          allowPairing, 
          'telegram'
        )

        if (mongoAuth?.state?.creds) {
          const hasCreds = mongoAuth.state.creds.noiseKey && mongoAuth.state.creds.signedIdentityKey
          
          if (hasCreds || allowPairing) {
            logger.info(`[${sessionId}] ✅ Using MongoDB auth (has creds: ${hasCreds}, pairing: ${allowPairing})`)
            
            const authState = {
              creds: mongoAuth.state.creds,
              keys: makeCacheableSignalKeyStore(
                mongoAuth.state.keys,
                pino({ level: 'silent' })
              )
            }
            
            return {
              state: authState,
              saveCreds: mongoAuth.saveCreds,
              cleanup: mongoAuth.cleanup,
              method: 'mongodb'
            }
          }
        }
        
        logger.warn(`[${sessionId}] ⚠️ MongoDB auth returned invalid state`)
      } catch (mongoError) {
        logger.error(`[${sessionId}] ❌ MongoDB auth error: ${mongoError.message}`)
      }
    } else {
      logger.info(`[${sessionId}] ℹ️ MongoDB not available - using file auth`)
    }

    // Fall back to file-based auth
    if (!this.fileManager) {
      throw new Error('No auth state provider available')
    }

    logger.info(`[${sessionId}] 📁 Using file auth`)
    
    await this.fileManager.ensureSessionDirectory(sessionId)
    const sessionPath = this.fileManager.getSessionPath(sessionId)
    const fileAuth = await useMultiFileAuthState(sessionPath)

    if (fileAuth?.state?.creds) {
      const hasCreds = fileAuth.state.creds.noiseKey && fileAuth.state.creds.signedIdentityKey
      logger.info(`[${sessionId}] ✅ File auth loaded (has creds: ${hasCreds})`)
      
      const authState = {
        creds: fileAuth.state.creds,
        keys: makeCacheableSignalKeyStore(
          fileAuth.state.keys,
          pino({ level: 'silent' })
        )
      }
      
      return {
        state: authState,
        saveCreds: fileAuth.saveCreds,
        cleanup: () => {},
        method: 'file'
      }
    }

    throw new Error('No valid auth state found')

  } catch (error) {
    logger.error(`[${sessionId}] ❌ Auth state retrieval failed: ${error.message}`)
    return null
  }
}

  _schedulePairing(sock, sessionId, phoneNumber, callbacks) {
    if (this.pairingInProgress.has(sessionId)) {
      logger.warn(`Pairing already in progress for ${sessionId}`)
      return
    }

    this.pairingInProgress.add(sessionId)

    const waitForWebSocketAndPair = async () => {
      try {
        logger.info(`Waiting for WebSocket to be OPEN for ${sessionId}`)
        
        const maxWait = 30000 // 30 seconds
        const checkInterval = 100 // Check every 100ms
        let waited = 0
        
        while (waited < maxWait) {
          const readyState = sock.ws?.socket?._readyState
          
          // ✅ CRITICAL FIX: ONLY proceed when readyState is 1 (OPEN), not 0 (CONNECTING)
          if (sock.ws && readyState === 1) {
            logger.info(`✅ WebSocket OPEN after ${waited}ms (readyState: ${readyState})`)
            break
          }
          
          // Log current state every second for debugging
          if (waited % 1000 === 0 && waited > 0) {
            logger.debug(`Still waiting... readyState: ${readyState}, waited: ${waited}ms`)
          }
          
          await new Promise(resolve => setTimeout(resolve, checkInterval))
          waited += checkInterval
        }
        
        // Check final state
        const finalReadyState = sock.ws?.socket?._readyState
        
        if (finalReadyState !== 1) {
          throw new Error(`WebSocket not ready after ${maxWait}ms (readyState: ${finalReadyState})`)
        }
        
        // ✅ Additional small delay to ensure WebSocket is stable
        logger.debug(`Waiting additional 500ms for WebSocket stability...`)
        await new Promise(resolve => setTimeout(resolve, 500))
        
        logger.info(`Requesting pairing code for ${sessionId}`)
        
        const { handlePairing } = await import('../utils/index.js')
        await handlePairing(sock, sessionId, phoneNumber, new Map(), callbacks)

        // Keep pairing flag for extended period
        setTimeout(() => {
          this.pairingInProgress.delete(sessionId)
        }, 500000)

      } catch (error) {
        logger.error(`Pairing error for ${sessionId}:`, error)
        this.pairingInProgress.delete(sessionId)
        
        if (callbacks?.onError) {
          callbacks.onError(error)
        }
      }
    }
    
    // Start waiting
    waitForWebSocketAndPair()
  }

  async checkAuthAvailability(sessionId) {
  const availability = {
    mongodb: false,
    file: false,
    preferred: 'none'
  }

  if (this.mongoClient) {
    try {
      const { hasValidAuthData } = await import('../storage/index.js')
      const db = this.mongoClient.db()
      const collection = db.collection('auth_baileys')
      availability.mongodb = await hasValidAuthData(collection, sessionId)
    } catch (error) {
      availability.mongodb = false
    }
  }

  if (this.fileManager) {
    // Now async
    availability.file = await this.fileManager.hasValidCredentials(sessionId)
  }

  availability.preferred = availability.mongodb ? 'mongodb' : 
                          availability.file ? 'file' : 'none'

  return availability
}

  async cleanupAuthState(sessionId) {
    const results = { mongodb: false, file: false }

    logger.info(`Cleaning up auth state for ${sessionId}`)

    if (this.mongoClient) {
      try {
        const { cleanupSessionAuthData } = await import('../storage/index.js')
        const db = this.mongoClient.db()
        const collection = db.collection('auth_baileys')
        results.mongodb = await cleanupSessionAuthData(collection, sessionId)
      } catch (error) {
        logger.error(`MongoDB auth cleanup error:`, error)
      }
    }

    if (this.fileManager) {
      try {
        results.file = await this.fileManager.cleanupSessionFiles(sessionId)
      } catch (error) {
        logger.error(`File auth cleanup error:`, error)
      }
    }

    // ✅ CRITICAL: Delete store on cleanup
    const { deleteSessionStore } = await import('./config.js')
    deleteSessionStore(sessionId)

    this.activeSockets.delete(sessionId)
    this.pairingInProgress.delete(sessionId)
    this.clearConnectionTimeout(sessionId)

    return results
  }

  async disconnectSocket(sessionId) {
    try {
      const sock = this.activeSockets.get(sessionId)
      
      if (sock) {
        // Call store cleanup
        if (sock._storeCleanup) {
          sock._storeCleanup()
        }

        // Call socket cleanup if available
        if (typeof sock.authCleanup === 'function') {
          sock.authCleanup()
        }

        // Remove event listeners
        if (sock.ev && typeof sock.ev.removeAllListeners === 'function') {
          sock.ev.removeAllListeners()
        }

        // Close WebSocket
        if (sock.ws && sock.ws.socket._readyState === 1) {
          sock.ws.close(1000, 'Disconnect')
        }
      }

      // ✅ Delete store
      const { deleteSessionStore } = await import('./config.js')
      deleteSessionStore(sessionId)

      this.activeSockets.delete(sessionId)
      this.pairingInProgress.delete(sessionId)
      this.clearConnectionTimeout(sessionId)

      logger.info(`Socket disconnected for ${sessionId}`)
      return true

    } catch (error) {
      logger.error(`Disconnect error for ${sessionId}:`, error)
      return false
    }
  }

  setConnectionTimeout(sessionId, callback, duration = 300000) {
    this.clearConnectionTimeout(sessionId)
    const timeout = setTimeout(callback, duration)
    this.connectionTimeouts.set(sessionId, timeout)
    logger.debug(`Connection timeout set for ${sessionId} (${duration}ms)`)
  }

  clearConnectionTimeout(sessionId) {
    const timeout = this.connectionTimeouts.get(sessionId)
    if (timeout) {
      clearTimeout(timeout)
      this.connectionTimeouts.delete(sessionId)
      return true
    }
    return false
  }

// Fix 3
isSocketReady(sock) {
  return !!(sock?.user && sock?.ws?.socket?._readyState === 1)
}

  async waitForSocketReady(sock, timeout = 30000) {
    if (this.isSocketReady(sock)) {
      return true
    }

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        sock.ev.off('connection.update', handler)
        resolve(false)
      }, timeout)

      const handler = (update) => {
        if (update.connection === 'open') {
          clearTimeout(timeoutId)
          sock.ev.off('connection.update', handler)
          resolve(true)
        }
      }

      sock.ev.on('connection.update', handler)
    })
  }

  getStats() {
    return {
      activeSockets: this.activeSockets.size,
      activeSocketIds: Array.from(this.activeSockets.keys()),
      pairingInProgress: this.pairingInProgress.size,
      activeTimeouts: this.connectionTimeouts.size,
      mongoAvailable: !!this.mongoClient,
      fileManagerAvailable: !!this.fileManager
    }
  }

  async cleanup() {
    logger.info('Starting connection manager cleanup')

    for (const [sessionId, timeout] of this.connectionTimeouts.entries()) {
      clearTimeout(timeout)
    }
    this.connectionTimeouts.clear()

    const disconnectPromises = []
    for (const sessionId of this.activeSockets.keys()) {
      disconnectPromises.push(this.disconnectSocket(sessionId))
    }
    await Promise.allSettled(disconnectPromises)

    this.activeSockets.clear()
    this.pairingInProgress.clear()

    logger.info('Connection manager cleanup completed')
  }
}
