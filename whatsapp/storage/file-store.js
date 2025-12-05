import fs from "fs/promises"
import fsr from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createComponentLogger } from "../../utils/logger.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = createComponentLogger("FILE_STORE")

// Store directory at project root
const STORE_ROOT = path.join(__dirname, "..", "..", "makeinstore")

// Config
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB per file
const MAX_MESSAGES_AGE = 2 * 60 * 60 * 1000 // 2 hours
const WRITE_BATCH_INTERVAL = 5000 // 5 seconds
const MAX_BATCH_CHANGES = 100
const MAX_MESSAGES_PER_SESSION = 50
const MAX_GROUPS_IN_MEMORY = 20

/**
 * FileBasedStore - Replaces makeInMemoryStore to reduce RAM usage
 * Stores messages, contacts, chats, and groups in files per session
 */
export class FileBasedStore {
  constructor(sessionId) {
    this.sessionId = sessionId
    this.sessionPath = path.join(STORE_ROOT, sessionId)

    this.buffer = {
      messages: [], // Array of last 50 messages (not Map per chat)
      contacts: new Map(),
      chats: new Map(),
      groups: new Map(), // Only keep last 20 groups in memory
      presences: new Map(),
    }

    // Write batching
    this.pendingWrites = new Set()
    this.changeCount = 0
    this.writeTimer = null
    this.isWriting = false

    // File paths
    this.files = {
      messages: path.join(this.sessionPath, "messages.json"),
      contacts: path.join(this.sessionPath, "contacts.json"),
      chats: path.join(this.sessionPath, "chats.json"),
      groups: path.join(this.sessionPath, "groups.json"),
    }

    this._ensureDirectory()
    this._startWriteBatcher()
    this._startCleanup()

    logger.info(`FileBasedStore created for ${sessionId}`)
  }

  async _ensureDirectory() {
    try {
      await fs.mkdir(this.sessionPath, { recursive: true })
    } catch (error) {
      logger.error(`Failed to create store directory for ${this.sessionId}:`, error.message)
    }
  }

  _startWriteBatcher() {
    this.writeTimer = setInterval(() => {
      if (this.pendingWrites.size > 0 || this.changeCount >= MAX_BATCH_CHANGES) {
        this._flushWrites()
      }
    }, WRITE_BATCH_INTERVAL)
  }

  _startCleanup() {
    setInterval(
      () => {
        this._cleanupOldMessages()
      },
      30 * 60 * 1000,
    )

    // Initial cleanup
    setTimeout(() => this._cleanupOldMessages(), 5000)
  }

  async _cleanupOldMessages() {
    try {
      const now = Date.now()
      let cleaned = 0

      this.buffer.messages = this.buffer.messages.filter((msg) => {
        const msgTime = msg.messageTimestamp ? msg.messageTimestamp * 1000 : 0
        return now - msgTime < MAX_MESSAGES_AGE
      })

      // Enforce max 50 messages
      if (this.buffer.messages.length > MAX_MESSAGES_PER_SESSION) {
        const toRemove = this.buffer.messages.length - MAX_MESSAGES_PER_SESSION
        this.buffer.messages = this.buffer.messages.slice(toRemove)
        cleaned += toRemove
      }

      if (this.buffer.groups.size > MAX_GROUPS_IN_MEMORY) {
        const entries = Array.from(this.buffer.groups.entries())
        const toRemove = entries.slice(0, entries.length - MAX_GROUPS_IN_MEMORY)
        toRemove.forEach(([id]) => this.buffer.groups.delete(id))
      }

      // Clean contacts - keep only 100 max
      if (this.buffer.contacts.size > 100) {
        const entries = Array.from(this.buffer.contacts.entries())
        const toRemove = entries.slice(0, entries.length - 100)
        toRemove.forEach(([id]) => this.buffer.contacts.delete(id))
      }

      // Clean file
      await this._cleanupMessagesFile()

      if (cleaned > 0) {
        logger.debug(`Cleaned ${cleaned} old messages for ${this.sessionId}`)
      }
    } catch (error) {
      logger.error(`Cleanup error for ${this.sessionId}:`, error.message)
    }
  }

  async _cleanupMessagesFile() {
    try {
      const filePath = this.files.messages
      if (!fsr.existsSync(filePath)) return

      const stats = await fs.stat(filePath)

      // If file too large or needs cleanup, truncate
      if (stats.size > MAX_FILE_SIZE) {
        const data = await this._readFile("messages")
        if (Array.isArray(data)) {
          const now = Date.now()

          const filtered = data
            .filter((msg) => {
              const msgTime = msg?.messageTimestamp ? msg.messageTimestamp * 1000 : 0
              return now - msgTime < MAX_MESSAGES_AGE
            })
            .slice(-MAX_MESSAGES_PER_SESSION)

          await this._writeFile("messages", filtered)
          logger.info(`Truncated messages file for ${this.sessionId}`)
        }
      }
    } catch (error) {
      logger.error(`Messages file cleanup error:`, error.message)
    }
  }

  async _readFile(type) {
    try {
      const filePath = this.files[type]
      if (!fsr.existsSync(filePath)) {
        return type === "messages" ? [] : {}
      }

      const content = await fs.readFile(filePath, "utf-8")
      return JSON.parse(content)
    } catch (error) {
      return type === "messages" ? [] : {}
    }
  }

  async _writeFile(type, data) {
    try {
      const filePath = this.files[type]
      const content = JSON.stringify(data, null, 0) // No pretty print to save space
      await fs.writeFile(filePath, content, "utf-8")
    } catch (error) {
      logger.error(`Write error for ${type}:`, error.message)
    }
  }

  async _flushWrites() {
    if (this.isWriting) return
    this.isWriting = true

    try {
      const types = Array.from(this.pendingWrites)
      this.pendingWrites.clear()
      this.changeCount = 0

      for (const type of types) {
        const data = this._bufferToObject(type)
        await this._writeFile(type, data)
      }
    } catch (error) {
      logger.error(`Flush error for ${this.sessionId}:`, error.message)
    } finally {
      this.isWriting = false
    }
  }

  _bufferToObject(type) {
    const buffer = this.buffer[type]
    if (!buffer) return type === "messages" ? [] : {}

    if (type === "messages") {
      return buffer
    }

    return Object.fromEntries(buffer)
  }

  _scheduleWrite(type) {
    this.pendingWrites.add(type)
    this.changeCount++

    if (this.changeCount >= MAX_BATCH_CHANGES) {
      this._flushWrites()
    }
  }

  // ==================== BAILEYS STORE INTERFACE ====================

  bind(ev) {
    // Messages upsert
    ev.on("messages.upsert", ({ messages }) => {
      for (const msg of messages) {
        if (!msg.key?.remoteJid) continue

        this.buffer.messages.push(msg)

        // Keep only last 50 messages TOTAL per session
        if (this.buffer.messages.length > MAX_MESSAGES_PER_SESSION) {
          this.buffer.messages.shift() // Remove oldest
        }

        this._scheduleWrite("messages")
      }
    })

    // Messages update
    ev.on("messages.update", (updates) => {
      for (const { key, update } of updates) {
        if (!key?.remoteJid || !key?.id) continue

        const msgIndex = this.buffer.messages.findIndex(
          (m) => m.key?.id === key.id && m.key?.remoteJid === key.remoteJid,
        )
        if (msgIndex !== -1) {
          Object.assign(this.buffer.messages[msgIndex], update)
          this._scheduleWrite("messages")
        }
      }
    })

    // Contacts upsert
    ev.on("contacts.upsert", (contacts) => {
      for (const contact of contacts) {
        if (contact.id) {
          this.buffer.contacts.set(contact.id, contact)
        }
      }
      // Keep only 100 contacts in memory
      if (this.buffer.contacts.size > 100) {
        const firstKey = this.buffer.contacts.keys().next().value
        this.buffer.contacts.delete(firstKey)
      }
      this._scheduleWrite("contacts")
    })

    // Contacts update
    ev.on("contacts.update", (updates) => {
      for (const update of updates) {
        if (update.id && this.buffer.contacts.has(update.id)) {
          const existing = this.buffer.contacts.get(update.id)
          Object.assign(existing, update)
        }
      }
      this._scheduleWrite("contacts")
    })

    // Chats upsert
    ev.on("chats.upsert", (chats) => {
      for (const chat of chats) {
        if (chat.id) {
          this.buffer.chats.set(chat.id, chat)
        }
      }
      // Keep only 50 chats in memory
      if (this.buffer.chats.size > 50) {
        const firstKey = this.buffer.chats.keys().next().value
        this.buffer.chats.delete(firstKey)
      }
      this._scheduleWrite("chats")
    })

    // Chats update
    ev.on("chats.update", (updates) => {
      for (const update of updates) {
        if (update.id && this.buffer.chats.has(update.id)) {
          const existing = this.buffer.chats.get(update.id)
          Object.assign(existing, update)
        }
      }
      this._scheduleWrite("chats")
    })

    ev.on("groups.update", (updates) => {
      for (const update of updates) {
        if (update.id) {
          const existing = this.buffer.groups.get(update.id) || {}
          this.buffer.groups.set(update.id, { ...existing, ...update })

          // Keep only last 20 groups in memory
          if (this.buffer.groups.size > MAX_GROUPS_IN_MEMORY) {
            const firstKey = this.buffer.groups.keys().next().value
            this.buffer.groups.delete(firstKey)
          }
        }
      }
      this._scheduleWrite("groups")
    })

    // Presence updates (minimal - don't persist, keep only 50)
    ev.on("presence.update", ({ id, presences }) => {
      this.buffer.presences.set(id, presences)

      if (this.buffer.presences.size > 50) {
        const firstKey = this.buffer.presences.keys().next().value
        this.buffer.presences.delete(firstKey)
      }
    })

    logger.debug(`Store bound to socket events for ${this.sessionId}`)
  }

  // Load message by key
  async loadMessage(jid, id) {
    const bufferedMsg = this.buffer.messages.find((m) => m.key?.id === id && m.key?.remoteJid === jid)
    if (bufferedMsg) return bufferedMsg

    // Load from file
    try {
      const data = await this._readFile("messages")
      if (Array.isArray(data)) {
        return data.find((m) => m.key?.id === id && m.key?.remoteJid === jid)
      }
      return undefined
    } catch {
      return undefined
    }
  }

  // Load messages for chat
  async loadMessages(jid, count = 50) {
    const buffered = this.buffer.messages.filter((m) => m.key?.remoteJid === jid)

    // If not enough, load from file
    if (buffered.length < count) {
      try {
        const data = await this._readFile("messages")
        if (Array.isArray(data)) {
          const fileMessages = data.filter((m) => m.key?.remoteJid === jid)
          buffered.push(...fileMessages)
        }
      } catch {
        // Ignore
      }
    }

    // Dedupe, sort by timestamp, return last N
    const unique = Array.from(new Map(buffered.map((m) => [m.key?.id, m])).values())
    unique.sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0))

    return unique.slice(-count)
  }

  // Get contact
  async getContact(jid) {
    if (this.buffer.contacts.has(jid)) {
      return this.buffer.contacts.get(jid)
    }
    // Load from file if not in buffer
    try {
      const data = await this._readFile("contacts")
      return data[jid] || undefined
    } catch {
      return undefined
    }
  }

  // Get all contacts
  async getAllContacts() {
    return Object.fromEntries(this.buffer.contacts)
  }

  // Get chat
  async getChat(jid) {
    return this.buffer.chats.get(jid) || undefined
  }

  // Get all chats
  async getAllChats() {
    return Array.from(this.buffer.chats.values())
  }

  async getGroupMetadata(jid) {
    // Check memory buffer first
    if (this.buffer.groups.has(jid)) {
      return this.buffer.groups.get(jid)
    }
    // Load from file
    try {
      const data = await this._readFile("groups")
      if (data[jid]) {
        // Cache in memory (will be evicted if over 20)
        this.buffer.groups.set(jid, data[jid])
        if (this.buffer.groups.size > MAX_GROUPS_IN_MEMORY) {
          const firstKey = this.buffer.groups.keys().next().value
          this.buffer.groups.delete(firstKey)
        }
        return data[jid]
      }
      return undefined
    } catch {
      return undefined
    }
  }

  async setGroupMetadata(jid, metadata) {
    this.buffer.groups.set(jid, metadata)
    if (this.buffer.groups.size > MAX_GROUPS_IN_MEMORY) {
      const firstKey = this.buffer.groups.keys().next().value
      this.buffer.groups.delete(firstKey)
    }
    this._scheduleWrite("groups")
  }

  // Get presence
  getPresence(jid) {
    return this.buffer.presences.get(jid)
  }

  // Cleanup on session end
  async cleanup() {
    try {
      clearInterval(this.writeTimer)

      // Final flush
      if (this.pendingWrites.size > 0) {
        await this._flushWrites()
      }

      // Clear buffers
      this.buffer.messages = []
      this.buffer.contacts.clear()
      this.buffer.chats.clear()
      this.buffer.groups.clear()
      this.buffer.presences.clear()

      logger.info(`Store cleaned up for ${this.sessionId}`)
    } catch (error) {
      logger.error(`Cleanup error for ${this.sessionId}:`, error.message)
    }
  }

  // Delete all session data
  async deleteAll() {
    try {
      await this.cleanup()
      await fs.rm(this.sessionPath, { recursive: true, force: true })
      logger.info(`Store deleted for ${this.sessionId}`)
    } catch (error) {
      logger.error(`Delete error for ${this.sessionId}:`, error.message)
    }
  }

  // Get stats
  getStats() {
    return {
      sessionId: this.sessionId,
      bufferedMessages: this.buffer.messages.length,
      bufferedContacts: this.buffer.contacts.size,
      bufferedChats: this.buffer.chats.size,
      bufferedGroups: this.buffer.groups.size,
      pendingWrites: this.pendingWrites.size,
    }
  }
}

// ==================== STORE MANAGER ====================

const stores = new Map()

export function createFileStore(sessionId) {
  if (stores.has(sessionId)) {
    return stores.get(sessionId)
  }

  const store = new FileBasedStore(sessionId)
  stores.set(sessionId, store)
  return store
}

export function getFileStore(sessionId) {
  return stores.get(sessionId)
}

export async function deleteFileStore(sessionId) {
  const store = stores.get(sessionId)
  if (store) {
    await store.deleteAll()
    stores.delete(sessionId)
    return true
  }
  return false
}

export function getStoreStats() {
  const stats = {}
  for (const [sessionId, store] of stores.entries()) {
    stats[sessionId] = store.getStats()
  }
  return stats
}

// Ensure store directory exists on module load
fs.mkdir(STORE_ROOT, { recursive: true }).catch(() => {})
