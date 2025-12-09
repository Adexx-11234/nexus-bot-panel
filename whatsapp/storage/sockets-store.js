import fs from "fs"
import path from "path"
import { createComponentLogger } from "../../utils/logger.js"
import { STORAGE_CONFIG } from "../../config/constant.js"

const logger = createComponentLogger("SOCKETS_STORE")

/**
 * SocketsStore - Persistent storage for active socket state
 * Stores socket metadata to file so it persists across restarts
 */
class SocketsStore {
  constructor() {
    this.stateFile = path.resolve(process.cwd(), STORAGE_CONFIG.SOCKETS_STATE_FILE)
    this.socketsMap = new Map()
    this.useFileStorage = STORAGE_CONFIG.SOCKETS_STORAGE === "file"
    this._ensureDirectory()
    this._loadState()
  }

  _ensureDirectory() {
    try {
      const dir = path.dirname(this.stateFile)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    } catch (error) {
      logger.error("Failed to create sockets state directory:", error)
    }
  }

  _loadState() {
    if (!this.useFileStorage) return

    try {
      if (fs.existsSync(this.stateFile)) {
        const data = fs.readFileSync(this.stateFile, "utf8")
        const parsed = JSON.parse(data)

        // Only load metadata, not actual sockets (those need to be recreated)
        if (parsed.sessions && Array.isArray(parsed.sessions)) {
          for (const session of parsed.sessions) {
            this.socketsMap.set(session.sessionId, {
              sessionId: session.sessionId,
              userId: session.userId,
              phoneNumber: session.phoneNumber,
              source: session.source,
              connectedAt: session.connectedAt,
              socket: null, // Will be populated when socket reconnects
            })
          }
          logger.info(`Loaded ${this.socketsMap.size} session states from file`)
        }
      }
    } catch (error) {
      logger.error("Failed to load sockets state:", error)
    }
  }

  _saveState() {
    if (!this.useFileStorage) return

    try {
      const sessions = []
      for (const [sessionId, data] of this.socketsMap.entries()) {
        sessions.push({
          sessionId,
          userId: data.userId,
          phoneNumber: data.phoneNumber,
          source: data.source,
          connectedAt: data.connectedAt,
        })
      }

      const state = {
        updatedAt: new Date().toISOString(),
        sessions,
      }

      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2))
    } catch (error) {
      logger.error("Failed to save sockets state:", error)
    }
  }

  // Map-like interface
  get(sessionId) {
    const data = this.socketsMap.get(sessionId)
    return data?.socket || null
  }

  has(sessionId) {
    return this.socketsMap.has(sessionId)
  }

  set(sessionId, socket, metadata = {}) {
    this.socketsMap.set(sessionId, {
      sessionId,
      userId: metadata.userId || sessionId.replace("session_", ""),
      phoneNumber: metadata.phoneNumber || socket?.user?.id?.split(":")[0],
      source: metadata.source || "telegram",
      connectedAt: new Date().toISOString(),
      socket,
    })
    this._saveState()
    return this
  }

  delete(sessionId) {
    const result = this.socketsMap.delete(sessionId)
    this._saveState()
    return result
  }

  clear() {
    this.socketsMap.clear()
    this._saveState()
  }

  get size() {
    return this.socketsMap.size
  }

  keys() {
    return this.socketsMap.keys()
  }

  values() {
    // Return only sockets that exist
    const sockets = []
    for (const data of this.socketsMap.values()) {
      if (data.socket) {
        sockets.push(data.socket)
      }
    }
    return sockets[Symbol.iterator]()
  }

  entries() {
    // Return [sessionId, socket] pairs
    const entries = []
    for (const [sessionId, data] of this.socketsMap.entries()) {
      if (data.socket) {
        entries.push([sessionId, data.socket])
      }
    }
    return entries[Symbol.iterator]()
  }

  // Get all session metadata (for reconnection)
  getAllSessionMetadata() {
    const metadata = []
    for (const [sessionId, data] of this.socketsMap.entries()) {
      metadata.push({
        sessionId,
        userId: data.userId,
        phoneNumber: data.phoneNumber,
        source: data.source,
        connectedAt: data.connectedAt,
        hasSocket: !!data.socket,
      })
    }
    return metadata
  }

  // Update socket for existing session
  updateSocket(sessionId, socket) {
    const data = this.socketsMap.get(sessionId)
    if (data) {
      data.socket = socket
      data.connectedAt = new Date().toISOString()
      this._saveState()
      return true
    }
    return false
  }

  // Iterator support
  [Symbol.iterator]() {
    return this.entries()
  }

  forEach(callback) {
    for (const [sessionId, data] of this.socketsMap.entries()) {
      if (data.socket) {
        callback(data.socket, sessionId, this)
      }
    }
  }
}

// Singleton instance
let socketsStoreInstance = null

export function getSocketsStore() {
  if (!socketsStoreInstance) {
    socketsStoreInstance = new SocketsStore()
  }
  return socketsStoreInstance
}

export function createSocketsStore() {
  return getSocketsStore()
}
