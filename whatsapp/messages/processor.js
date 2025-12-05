import { createComponentLogger } from "../../utils/logger.js"
import { MessageLogger } from "./logger.js"
import { MessagePersistence } from "./persistence.js"
import { MessageExtractor } from "./extractor.js"
import { recordSessionActivity, analyzeMessage } from "../utils/index.js"

const logger = createComponentLogger("MessageProcessor")

/**
 * MessageProcessor - Main message processing pipeline
 * Handles message processing, commands, anti-plugins
 */
export class MessageProcessor {
  constructor() {
    this.isInitialized = false
    this.messageLogger = new MessageLogger()
    this.messagePersistence = new MessagePersistence()
    this.messageExtractor = new MessageExtractor()
    this.userStates = new Map() // key: "chatId_userId" -> { type, data, expires, handler }

    // Plugin loader (lazy loaded)
    this.pluginLoader = null

    // Minimal stats tracking
    this.messageStats = {
      processed: 0,
      commands: 0,
      errors: 0,
      blocked: 0, // Track blocked messages
    }
  }

  /**
   * Set state with custom handler function
   * @param {string} chatId - Chat ID
   * @param {string} userId - User ID
   * @param {string} type - State type (for debugging/logging)
   * @param {object} data - Any data to store
   * @param {function} handler - Function to call when user replies: (sock, sessionId, m, data, userReply) => Promise
   */
  _setState(chatId, userId, type, data, handler) {
    const key = `${chatId}_${userId}`
    this.userStates.set(key, {
      type,
      data,
      handler, // The plugin's custom handler function
      expires: Date.now() + 5 * 60 * 1000, // 5 minutes
    })
    logger.debug(`State set: ${type} for ${userId}`)
  }

  _getState(chatId, userId) {
    const key = `${chatId}_${userId}`
    const state = this.userStates.get(key)

    if (state && Date.now() > state.expires) {
      this.userStates.delete(key)
      logger.debug(`State expired: ${state.type}`)
      return null
    }

    return state
  }

  _clearState(chatId, userId) {
    const key = `${chatId}_${userId}`
    this.userStates.delete(key)
  }

  /**
   * UNIVERSAL handler for ANY reply (not just numbers!)
   * Works for: numbers, text, yes/no, anything!
   */
  async _handleStateReply(sock, sessionId, m) {
    // Only check if NOT a command
    if (m.isCommand) return null

    // Must be replying to bot
    if (!m.quoted) return null

    const quotedSender = m.quoted.sender || m.quoted.participant
    const botJid = sock.user?.id

    if (quotedSender !== botJid && !this.pluginLoader.compareJids(quotedSender, botJid)) {
      return null
    }

    // Get user's state
    const state = this._getState(m.chat, m.sender)
    if (!state) return null

    // State exists and user is replying to bot
    // Call the handler function that the plugin provided
    try {
      logger.debug(`Executing state handler: ${state.type}`)

      const result = await state.handler(sock, sessionId, m, state.data, m.body.trim())

      return result || { processed: true }
    } catch (error) {
      logger.error(`Error in state handler (${state.type}):`, error)

      // Clear broken state
      this._clearState(m.chat, m.sender)

      await sock.sendMessage(
        m.chat,
        {
          text: `❌ An error occurred. Please try again.`,
        },
        { quoted: m },
      )

      return { processed: true, error: true }
    }
  }

  /**
   * Initialize processor
   */
  async initialize() {
    if (!this.isInitialized) {
      // Lazy load plugin loader
      const pluginLoaderModule = await import("../../utils/plugin-loader.js")
      this.pluginLoader = pluginLoaderModule.default

      if (!this.pluginLoader.isInitialized) {
        await this.pluginLoader.loadPlugins()
      }

      this.isInitialized = true
      logger.info("Message processor initialized")
    }
  }

  /**
   * Get user's custom prefix from database
   * @private
   */
  async getUserPrefix(telegramId) {
    try {
      const { UserQueries } = await import("../../database/query.js")
      const settings = await UserQueries.getUserSettings(telegramId)

      // Return custom prefix or default to '.'
      const prefix = settings?.custom_prefix || "."

      // Handle 'none' prefix case (empty string means no prefix required)
      return prefix === "none" ? "" : prefix
    } catch (error) {
      logger.error("Error getting user prefix:", error)
      return "." // Fallback to default on error
    }
  }

  /**
   * Process message through pipeline
   */
  async processMessage(sock, sessionId, m, prefix = null) {
    try {
      recordSessionActivity(sessionId)

      await this.initialize()

      // Validate message
      if (!m || !m.message) {
        return { processed: false, error: "Invalid message object" }
      }

      const virtexCheck = analyzeMessage(m.message)
      if (virtexCheck.isMalicious) {
        logger.warn(`[${sessionId}] BLOCKED malicious message: ${virtexCheck.reason}`)
        this.messageStats.blocked++

        // Fire-and-forget: Try to delete the malicious message if in group
        const chat = m.key?.remoteJid || m.from
        const isGroup = chat && chat.endsWith("@g.us")

        if (isGroup && chat) {
          sock.sendMessage(chat, { delete: m.key }).catch(() => {})

          // Notify group about blocked message (fire-and-forget)
          const senderNumber = (m.key?.participant || m.sender || "").split("@")[0]
          sock
            .sendMessage(chat, {
              text:
                `🛡️ *Security Alert*\n\n` +
                `Blocked malicious message from @${senderNumber}\n` +
                `Reason: ${virtexCheck.reason}\n\n` +
                `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
              mentions: [m.key?.participant || m.sender],
            })
            .catch(() => {})
        }

        return { processed: false, blocked: true, reason: virtexCheck.reason }
      }

      const chat = m.key?.remoteJid || m.from
      const isGroup = chat && chat.endsWith("@g.us")

      // Skip protocol/system messages
      if (m.message?.protocolMessage) {
        const protocolType = m.message.protocolMessage.type

        const skipTypes = [
          "PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE",
          "MESSAGE_EDIT",
          "REVOKE",
          "EPHEMERAL_SETTING",
        ]

        if (skipTypes.includes(protocolType)) {
          logger.debug(`Skipping protocol message type: ${protocolType}`)
          return { processed: false, silent: true, protocolMessage: true }
        }
      }

      // Set chat, isGroup, and sender
      if (!m.chat) {
        m.chat = m.key?.remoteJid || m.from
      }
      if (typeof m.isGroup === "undefined") {
        m.isGroup = m.chat && m.chat.endsWith("@g.us")
      }

      if (!m.sender) {
        if (m.isGroup) {
          m.sender = m.key?.participant || m.participant || m.key?.remoteJid
        } else {
          if (m.key?.fromMe) {
            m.sender = m.originalSelfAuthorUserJidString || sock.user?.id
          } else {
            m.sender = m.key?.remoteJid || m.chat
          }
        }
      }

      if (m.sender?.includes("@lid") && m.originalSelfAuthorUserJidString) {
        m.sender = m.originalSelfAuthorUserJidString
        logger.debug(`Corrected @lid sender to: ${m.sender}`)
      }

      // Validate critical fields
      if (!m.chat || !m.sender) {
        logger.error("Missing critical message fields:", { chat: m.chat, sender: m.sender })
        return { processed: false, error: "Missing chat or sender information" }
      }

      // Get session context
      m.sessionContext = this._getSessionContext(sessionId)
      m.sessionId = sessionId

      // Get user's custom prefix directly from database
      const userPrefix = await this.getUserPrefix(m.sessionContext.telegram_id)
      m.prefix = userPrefix
      logger.debug(`Using prefix '${m.prefix}' for user ${m.sessionContext.telegram_id}`)

      // Extract contact info
      await this._extractContactInfo(sock, m)

      // Extract quoted message
      m.quoted = this.messageExtractor.extractQuotedMessage(m)

      // Extract message body
      m.body = this.messageExtractor.extractMessageBody(m)
      m.text = m.body

      // Set admin status
      await this._setAdminStatus(sock, m)

      // Determine if it's a command
      const isCommand = m.body && (m.prefix === "" || m.body.startsWith(m.prefix))
      m.isCommand = isCommand

      if (isCommand) {
        this._parseCommand(m, m.prefix)
      }

      // Process anti-plugins (skip for commands)
      if (!m.isCommand) {
        await this._processAntiPlugins(sock, sessionId, m)

        if (m._wasDeletedByAntiPlugin) {
          this.messagePersistence.persistMessage(sessionId, sock, m).catch(() => {})
          this.messageLogger.logEnhancedMessageEntry(sock, sessionId, m).catch(() => {})
          return { processed: true, deletedByAntiPlugin: true }
        }
      }

      // Fire-and-forget for persistence and logging
      this.messagePersistence.persistMessage(sessionId, sock, m).catch((err) => {
        logger.debug(`Persistence failed for ${m.key?.id}:`, err.message)
      })

      this.messageLogger.logEnhancedMessageEntry(sock, sessionId, m).catch((err) => {
        logger.debug(`Logging failed for ${m.key?.id}:`, err.message)
      })

      // ✅ CHECK STATE REPLY FIRST (before interactive responses and commands)
      // This handles number replies, text replies, etc. for multi-step flows
      const stateReplyResult = await this._handleStateReply(sock, sessionId, m)
      if (stateReplyResult) {
        return stateReplyResult
      }

      // Handle interactive responses (buttons, lists)
      if (m.message?.listResponseMessage) {
        return await this._handleListResponse(sock, sessionId, m)
      }

      if (
        m.message?.interactiveResponseMessage ||
        m.message?.templateButtonReplyMessage ||
        m.message?.buttonsResponseMessage
      ) {
        return await this._handleInteractiveResponse(sock, sessionId, m)
      }

      // Execute command if it's a command
      if (m.isCommand && m.body) {
        this.messageStats.commands++
        return await this._handleCommand(sock, sessionId, m)
      }

      // Process game messages (non-commands only)
      if (!m.isCommand && m.body && m.body.trim()) {
        const gameResult = await this._handleGameMessage(sock, sessionId, m)
        if (gameResult) {
          return gameResult
        }
      }

      this.messageStats.processed++
      return { processed: true }
    } catch (error) {
      logger.error(`Error processing message:`, error)
      this.messageStats.errors++
      return { processed: false, error: error.message }
    }
  }

  /**
   * Get session context
   * @private
   */
  _getSessionContext(sessionId) {
    const sessionIdMatch = sessionId.match(/session_(-?\d+)/)

    if (sessionIdMatch) {
      const telegramId = Number.parseInt(sessionIdMatch[1])
      return {
        telegram_id: telegramId,
        session_id: sessionId,
        isWebSession: telegramId < 0,
        id: telegramId,
      }
    }

    return {
      telegram_id: "Unknown",
      session_id: sessionId,
      id: null,
    }
  }

  /**
   * Extract contact info (push name)
   * @private
   */
  async _extractContactInfo(sock, m) {
    try {
      const { getContactResolver } = await import("../contacts/index.js")
      const resolver = getContactResolver()
      await resolver.extractPushName(sock, m)
    } catch (error) {
      logger.error("Error extracting contact info:", error)
      m.pushName = "Unknown"
    }
  }

  /**
   * Set admin status for message
   * @private
   */
  async _setAdminStatus(sock, m) {
    try {
      // Private chats: both are admins
      if (!m.isGroup) {
        m.isAdmin = true
        m.isBotAdmin = true
        m.isCreator = this._checkIsBotOwner(sock, m.sender)
        return
      }

      // Group chats: check admin status
      const { isGroupAdmin, isBotAdmin } = await import("../groups/index.js")

      m.isAdmin = await isGroupAdmin(sock, m.chat, m.sender)
      m.isBotAdmin = await isBotAdmin(sock, m.chat)
      m.isCreator = this._checkIsBotOwner(sock, m.sender)

      // Get group metadata for reference
      const { getGroupMetadataManager } = await import("../groups/index.js")
      const metadataManager = getGroupMetadataManager()
      m.groupMetadata = await metadataManager.getMetadata(sock, m.chat)
      m.participants = m.groupMetadata?.participants || []
    } catch (error) {
      logger.error("Error setting admin status:", error)
      m.isAdmin = false
      m.isBotAdmin = false
      m.isCreator = this._checkIsBotOwner(sock, m.sender)
    }
  }

  /**
   * Check if user is bot owner
   * @private
   */
  _checkIsBotOwner(sock, userJid) {
    try {
      if (!sock?.user?.id || !userJid) {
        return false
      }

      const botNumber = sock.user.id.split(":")[0]
      const userNumber = userJid.split("@")[0]

      return botNumber === userNumber
    } catch (error) {
      return false
    }
  }

  /**
   * Parse command from message
   * @private
   */
  _parseCommand(m, prefix) {
    // Handle 'none' prefix case (empty string)
    const commandText = prefix === "" ? m.body.trim() : m.body.slice(prefix.length).trim()

    const [cmd, ...args] = commandText.split(/\s+/)

    m.command = {
      name: cmd.toLowerCase(),
      args: args,
      raw: commandText,
      fullText: m.body,
    }
  }

  /**
   * Process anti-plugins
   * @private
   */
  async _processAntiPlugins(sock, sessionId, m) {
    try {
      if (!this.pluginLoader) return

      await this.pluginLoader.processAntiPlugins(sock, sessionId, m)
    } catch (error) {
      logger.error("Error processing anti-plugins:", error)
    }
  }

  /**
   * Handle game messages
   * @private
   */
  async _handleGameMessage(sock, sessionId, m) {
    try {
      const { gameManager } = await import("../../lib/game managers/game-manager.js")

      // Skip if no body or if it's a command with prefix
      if (!m.body || (m.prefix && m.body.startsWith(m.prefix))) return null
      if (!m.chat) return null

      // GAME DEDUPLICATION: Check if message is a game command
      const isGameCommand = await this.isGameCommand(m.body)

      if (isGameCommand) {
        // Lock game command to prevent multiple sessions from processing same game action
        const { default: pluginLoader } = await import("../../utils/plugin-loader.js")
        const messageKey = pluginLoader.deduplicator.generateKey(m.chat, m.key?.id)

        if (messageKey) {
          if (!pluginLoader.deduplicator.tryLockForProcessing(messageKey, sessionId, "game-start")) {
            logger.debug("Game command already being processed by another session")
            return null // Another session is processing the game
          }
        }
      }

      const result = await gameManager.processGameMessage(sock, m.chat, m.sender, m.body)

      // Mark as processed if game action was successful
      if (result && result.success !== false && isGameCommand) {
        const { default: pluginLoader } = await import("../../utils/plugin-loader.js")
        const messageKey = pluginLoader.deduplicator.generateKey(m.chat, m.key?.id)

        if (messageKey) {
          pluginLoader.deduplicator.markAsProcessed(messageKey, sessionId, "game-start")
        }
      }

      if (result && result.success !== false) {
        return { processed: true, gameMessage: true, result }
      }

      return null
    } catch (error) {
      logger.error("Error handling game message:", error)
      return null
    }
  }

  /**
   * Check if message is a game command by checking plugin loader
   * @private
   */
  async isGameCommand(messageBody) {
    try {
      if (!messageBody || typeof messageBody !== "string") return false

      // Import plugin loader
      const { default: pluginLoader } = await import("../../utils/plugin-loader.js")

      // Extract first word as potential command
      const firstWord = messageBody.trim().split(/\s+/)[0].toLowerCase()

      // Check if command exists in plugin loader
      const plugin = pluginLoader.findCommand(firstWord)

      // Check if it's a game command (gamemenu category)
      if (plugin && plugin.category === "gamemenu") {
        return true
      }

      // Also check if message contains any game-related keywords
      // This handles cases like "tictactoe start", "rps start", etc.
      const gameKeywords = ["tictactoe", "rps", "trivia", "quiz", "hangman", "math", "guess"]
      const containsGameKeyword = gameKeywords.some((keyword) => messageBody.toLowerCase().includes(keyword))

      return containsGameKeyword
    } catch (error) {
      logger.error("Error checking if message is game command:", error)
      return false
    }
  }

  /**
   * Handle interactive response (buttons, lists)
   * @private
   */
  async _handleInteractiveResponse(sock, sessionId, m) {
    try {
      let selectedCommand = null

      if (m.message?.interactiveResponseMessage?.nativeFlowResponseMessage) {
        const flowResponse = m.message.interactiveResponseMessage.nativeFlowResponseMessage
        const paramsJson = flowResponse.paramsJson

        if (paramsJson) {
          try {
            const params = JSON.parse(paramsJson)
            selectedCommand = params.id
          } catch (parseError) {
            // Silent fail
          }
        }
      } else if (m.message?.templateButtonReplyMessage) {
        selectedCommand = m.message.templateButtonReplyMessage.selectedId
      } else if (m.message?.buttonsResponseMessage) {
        selectedCommand = m.message.buttonsResponseMessage.selectedButtonId
      } else if (m.message?.interactiveResponseMessage) {
        const response = m.message.interactiveResponseMessage
        selectedCommand = response.selectedButtonId || response.selectedId || response.body?.text
      }

      if (selectedCommand) {
        if (selectedCommand.startsWith(m.prefix)) {
          m.body = selectedCommand
          m.isCommand = true
          this._parseCommand(m, m.prefix)
          return await this._handleCommand(sock, sessionId, m)
        } else {
          return { processed: true, buttonResponse: selectedCommand }
        }
      }

      return { processed: true, interactiveResponse: true }
    } catch (error) {
      logger.error("Error handling interactive response:", error)
      return { processed: false, error: error.message }
    }
  }

  /**
   * Handle list response
   * @private
   */
  async _handleListResponse(sock, sessionId, m) {
    const selectedRowId = m.message.listResponseMessage.singleSelectReply.selectedRowId

    if (selectedRowId?.startsWith(m.prefix)) {
      m.body = selectedRowId
      m.isCommand = true
      this._parseCommand(m, m.prefix)
      return await this._handleCommand(sock, sessionId, m)
    }

    return { processed: true, listResponse: true }
  }

  /**
   * Handle command execution
   * @private
   */
  async _handleCommand(sock, sessionId, m) {
    const command = m.command.name

    try {
      if (!this.pluginLoader) {
        throw new Error("Plugin loader not initialized")
      }

      const exec = await this.pluginLoader.executeCommand(sock, sessionId, command, m.command.args, m)

      if (exec?.ignore) {
        return { processed: true, ignored: true }
      } else if (exec?.success) {
        await this._sendCommandResponse(sock, m, exec.result || exec)
      }
    } catch (error) {
      logger.error(`Error executing command ${command}:`, error)
    }

    return { processed: true, commandExecuted: true }
  }

  /**
   * Send command response
   * @private
   */
  async _sendCommandResponse(sock, m, result) {
    if (!result?.response) return

    const messageOptions = { quoted: m }

    if (result.mentions && Array.isArray(result.mentions)) {
      messageOptions.mentions = result.mentions
    }

    try {
      if (result.isList && result.response.sections) {
        await sock.sendMessage(m.chat, result.response, messageOptions)
      } else if (result.media) {
        const mediaMessage = {
          [result.mediaType || "image"]: result.media,
          caption: result.response,
        }
        await sock.sendMessage(m.chat, mediaMessage, messageOptions)
      } else {
        await sock.sendMessage(m.chat, { text: result.response }, messageOptions)
      }
    } catch (error) {
      logger.error("Failed to send response:", error)
    }
  }

  /**
   * Get processor stats
   */
  getStats() {
    return {
      ...this.messageStats,
      userStates: this.userStates.size,
      isInitialized: this.isInitialized,
    }
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.messageStats = {
      processed: 0,
      commands: 0,
      errors: 0,
      blocked: 0,
    }
  }

  /**
   * Perform maintenance
   */
  performMaintenance() {
    // Clean up any temporary data if needed
    logger.debug("Message processor maintenance performed")
  }
}
