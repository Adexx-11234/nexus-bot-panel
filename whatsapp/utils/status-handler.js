import { createComponentLogger } from "../../utils/logger.js"
import { UserQueries } from "../../database/query.js"

const logger = createComponentLogger("STATUS_HANDLER")

/**
 * StatusHandler - Handles automatic status viewing and reactions
 * Fire and forget - reduced cache, faster cleanup
 */
export class StatusHandler {
  constructor() {
    this.processedStatuses = new Set()
    this.maxCacheSize = 200
    this.reactionEmojis = [
      '❤️', '🔥', '😍', '👍', '😊', '🎉', '💯', '✨', '👏', '🥰',
      '💖', '⚡', '🌟', '💪', '🙌', '🤩', '😎', '🚀', '💕', '🌈',
      '🎊', '🏆', '⭐', '💝', '🎯', '🔮', '🌺', '🦋', '🌸', '💫',
      '🍀', '🎨', '🎭', '🎪', '🎬', '🎮', '🎲', '🎸', '🎹', '🎺',
      '🌙', '☀️', '🌊', '🌴', '🍕', '🍔', '🍟', '🍿', '🧁', '🍩',
      '🦄', '🐉', '🦅', '🦁', '🐺', '🦊', '🐼', '🐨', '🐯', '🦖',
      '💎', '👑', '🗿', '🌋', '🏔️', '🗽', '🎡', '🎢', '🎠', '⛵',
      '🛸', '🚁', '✈️', '🏎️', '🏍️', '🚂', '🛹', '⚽', '🏀', '🎾',
      '🎱', '🎳', '🏓', '🥊', '🥋', '⛳', '🎿', '🏂', '🏋️', '🤸',
      '🧘', '💃', '🕺', '🎤', '🎧', '📻', '📱', '💻', '⌚', '📷',
      '🔬', '🔭', '🧪', '🧬', '🔥', '💧', '🌪️', '☄️', '🌠', '🪐'
    ]

    this._startCleanup()
  }

  _startCleanup() {
    setInterval(() => {
      this.cleanup()
    }, 30000) // Every 30 seconds
  }

  async handleStatusMessage(sock, sessionId, message) {
    try {
      if (!this.isStatusMessage(message)) {
        return
      }

      const messageId = message.key?.id
      const statusSender = message.key?.participant

      if (!statusSender) {
        return
      }

      if (!message.key || !message.key.remoteJid || !message.key.participant) {
        return
      }

      if (this.processedStatuses.has(messageId)) {
        return
      }

      this.processedStatuses.add(messageId)

      setTimeout(() => {
        this.processedStatuses.delete(messageId)
      }, 30000)

      const telegramId = this._extractTelegramId(sessionId)
      if (!telegramId) return

      const settings = await UserQueries.getPresenceSettings(telegramId)

      if (settings.auto_status_view) {
        await this.viewStatus(sock, message)
      }

      if (settings.auto_status_like) {
        setTimeout(
          async () => {
            await this.likeStatus(sock, message)
          },
          2000 + Math.random() * 3000,
        )
      }
    } catch (error) {
      logger.error("[StatusHandler] Error handling status:", error)
    }
  }

  isStatusMessage(message) {
    const remoteJid = message.key?.remoteJid
    return remoteJid === "status@broadcast"
  }

  async viewStatus(sock, message) {
    try {
      await sock.readMessages([message.key])
    } catch (error) {
      // Silent fail
    }
  }

  async likeStatus(sock, message) {
    try {
      const statusSender = message.key?.participant

      if (!statusSender || !sock.user || !sock.user.id) {
        return
      }

      const randomEmoji = this.reactionEmojis[Math.floor(Math.random() * this.reactionEmojis.length)]

      await sock.sendMessage(
        message.key.remoteJid,
        {
          react: {
            text: randomEmoji,
            key: message.key,
          },
        },
        {
          statusJidList: [message.key.participant, sock.user.id],
        },
      )
    } catch (error) {
      // Silent fail
    }
  }

  _extractTelegramId(sessionId) {
    const match = sessionId.match(/session_(-?\d+)/)
    return match ? Number.parseInt(match[1]) : null
  }

  cleanup() {
    if (this.processedStatuses.size > this.maxCacheSize) {
      const entries = Array.from(this.processedStatuses)
      this.processedStatuses.clear()
      entries.slice(-100).forEach((id) => this.processedStatuses.add(id))
    }
  }

  getStats() {
    return {
      processedStatuses: this.processedStatuses.size,
      maxSize: this.maxCacheSize,
    }
  }
}

let statusHandlerInstance = null

export function getStatusHandler() {
  if (!statusHandlerInstance) {
    statusHandlerInstance = new StatusHandler()
  }
  return statusHandlerInstance
}

export async function handleStatusMessage(sock, sessionId, message) {
  const handler = getStatusHandler()
  await handler.handleStatusMessage(sock, sessionId, message)
}
