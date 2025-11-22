import { createComponentLogger } from "../../utils/logger.js"

const logger = createComponentLogger("GAME-MANAGER")

class GameManager {
  constructor() {
    this.activeGames = new Map() // groupJid -> Map(gameId -> gameInstance)
    this.playerStats = new Map() // userJid -> stats
    this.gameTypes = new Map() // gameName -> gameClass
    this.maxGamesPerGroup = 3 // Maximum concurrent games per group
  }

  /**
   * Register a game type
   */
  registerGame(gameName, gameClass) {
    this.gameTypes.set(gameName.toLowerCase(), gameClass)
    logger.debug(`Registered game: ${gameName}`)
  }

  /**
   * Start a new game in a group
   */
  async startGame(sock, groupJid, gameName, hostJid, options = {}) {
    try {
      const GameClass = this.gameTypes.get(gameName.toLowerCase())
      if (!GameClass) {
        throw new Error(`Game type '${gameName}' not found`)
      }

      // Initialize group games map if not exists
      if (!this.activeGames.has(groupJid)) {
        this.activeGames.set(groupJid, new Map())
      }

      const groupGames = this.activeGames.get(groupJid)

      // Check if group has reached maximum games
      if (groupGames.size >= this.maxGamesPerGroup) {
        const gamesList = Array.from(groupGames.values())
          .map(game => game.name)
          .join(', ')
        return {
          success: false,
          message: `⚠️ Maximum games limit reached! Active games: ${gamesList}\nEnd a game first with 'endgame' command.`
        }
      }

      // Check if user already hosts a game of this type
      for (const [gameId, game] of groupGames) {
        if (game.hostJid === hostJid && game.name.toLowerCase() === gameName.toLowerCase()) {
          return {
            success: false,
            message: `⚠️ You already host a '${game.name}' game! End it first or join the existing one.`
          }
        }
      }

      // Create unique game ID
      const gameId = `${gameName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      
      // Create new game instance
      const gameInstance = new GameClass(sock, groupJid, hostJid, options)
      gameInstance.gameId = gameId // Add unique identifier
      
      // Add to active games
      groupGames.set(gameId, gameInstance)

      // Initialize and start the game
      const startResult = await gameInstance.start()
      if (!startResult.success) {
        groupGames.delete(gameId)
        return startResult
      }

      logger.info(`Started ${gameName} (${gameId}) in group ${groupJid}`)
      return startResult

    } catch (error) {
      logger.error(`Error starting game ${gameName}:`, error)
      return {
        success: false,
        message: `❌ Failed to start game: ${error.message}`
      }
    }
  }

  /**
   * End a game in a group
   */
  async endGame(sock, groupJid, userJid, gameId = null) {
    try {
      const groupGames = this.activeGames.get(groupJid)
      if (!groupGames || groupGames.size === 0) {
        return {
          success: false,
          message: "❌ No active games in this group!"
        }
      }

      let gameToEnd = null
      let gameIdToEnd = null

      if (gameId) {
        // End specific game
        gameToEnd = groupGames.get(gameId)
        gameIdToEnd = gameId
      } else if (groupGames.size === 1) {
        // Only one game, end it
        gameIdToEnd = Array.from(groupGames.keys())[0]
        gameToEnd = groupGames.get(gameIdToEnd)
      } else {
        // Multiple games, find user's hosted game
        for (const [gId, game] of groupGames) {
          if (game.hostJid === userJid) {
            gameToEnd = game
            gameIdToEnd = gId
            break
          }
        }

        if (!gameToEnd) {
          const gamesList = Array.from(groupGames.values())
            .map(game => `${game.name} (by @${game.hostJid.split('@')[0]})`)
            .join('\n')
          return {
            success: false,
            message: `❌ Multiple games active. Specify which game to end:\n${gamesList}\n\nYou can only end games you host or if you're admin.`
          }
        }
      }

      if (!gameToEnd) {
        return {
          success: false,
          message: "❌ Game not found!"
        }
      }

      // Check if user can end the game (host or admin)
      const isAdmin = await gameToEnd.isAdmin(userJid)
      if (gameToEnd.hostJid !== userJid && !isAdmin) {
        return {
          success: false,
          message: `❌ Only the game host (@${gameToEnd.hostJid.split('@')[0]}) or group admins can end this game!`
        }
      }

      await gameToEnd.end("Game ended by user")
      groupGames.delete(gameIdToEnd)

      // Clean up empty group
      if (groupGames.size === 0) {
        this.activeGames.delete(groupJid)
      }

      return {
        success: true,
        message: `🎮 Game '${gameToEnd.name}' has been ended.`
      }

    } catch (error) {
      logger.error("Error ending game:", error)
      return {
        success: false,
        message: `❌ Error ending game: ${error.message}`
      }
    }
  }

  /**
   * Process a message for active games
   */
  async processGameMessage(sock, groupJid, userJid, message) {
    try {
      const groupGames = this.activeGames.get(groupJid)
      if (!groupGames || groupGames.size === 0) return null

      // Try each active game in the group
      for (const [gameId, game] of groupGames) {
        const result = await game.processMessage(userJid, message)
        if (result) {
          // If game ended itself, remove it
          if (!game.isActive) {
            groupGames.delete(gameId)
            if (groupGames.size === 0) {
              this.activeGames.delete(groupJid)
            }
          }
          return result
        }
      }

      return null
    } catch (error) {
      logger.error("Error processing game message:", error)
      return null
    }
  }

  /**
   * Get active games in group
   */
  getActiveGames(groupJid) {
    const groupGames = this.activeGames.get(groupJid)
    return groupGames ? Array.from(groupGames.values()) : []
  }

  /**
   * Get specific game
   */
  getGame(groupJid, gameId) {
    const groupGames = this.activeGames.get(groupJid)
    return groupGames ? groupGames.get(gameId) : null
  }

  /**
   * Get games list for a group
   */
  getGamesListText(groupJid) {
    const games = this.getActiveGames(groupJid)
    if (games.length === 0) {
      return "No active games in this group."
    }

    return "🎮 **Active Games:**\n" + 
      games.map(game => 
        `• ${game.name} (Host: @${game.hostJid.split('@')[0]}, Players: ${game.players.size})`
      ).join('\n')
  }

  /**
   * Get player statistics
   */
  getPlayerStats(userJid) {
    return this.playerStats.get(userJid) || {
      gamesPlayed: 0,
      gamesWon: 0,
      totalScore: 0,
      favoriteGame: null,
      lastPlayed: null
    }
  }

  /**
   * Update player statistics
   */
  updatePlayerStats(userJid, gameResult) {
    const stats = this.getPlayerStats(userJid)
    
    stats.gamesPlayed++
    if (gameResult.won) stats.gamesWon++
    if (gameResult.score) stats.totalScore += gameResult.score
    stats.lastPlayed = new Date().toISOString()
    
    // Track favorite game
    if (!stats.favoriteGame) {
      stats.favoriteGame = gameResult.gameName
    }

    this.playerStats.set(userJid, stats)
    logger.debug(`Updated stats for ${userJid}:`, stats)
  }

  /**
   * Get available games list
   */
  getAvailableGames() {
    return Array.from(this.gameTypes.keys())
  }

  /**
   * Clean up inactive games
   */
  cleanupInactiveGames() {
    let cleanedCount = 0
    
    for (const [groupJid, groupGames] of this.activeGames.entries()) {
      const expiredGames = []
      
      for (const [gameId, game] of groupGames) {
        if (game.isExpired()) {
          expiredGames.push({ gameId, game })
        }
      }
      
      // Remove expired games
      for (const { gameId, game } of expiredGames) {
        game.end("Game expired due to inactivity")
        groupGames.delete(gameId)
        cleanedCount++
        logger.info(`Cleaned up expired game ${game.name} (${gameId}) in ${groupJid}`)
      }
      
      // Remove empty group
      if (groupGames.size === 0) {
        this.activeGames.delete(groupJid)
      }
    }
    
    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} expired games`)
    }
  }

  /**
   * Get total active games count
   */
  getTotalActiveGames() {
    let total = 0
    for (const groupGames of this.activeGames.values()) {
      total += groupGames.size
    }
    return total
  }

  /**
   * Get groups with active games
   */
  getActiveGroupsCount() {
    return this.activeGames.size
  }
}

/**
 * Enhanced Base Game Class - All games extend this
 */
class BaseGame {
  constructor(sock, groupJid, hostJid, options = {}) {
    this.sock = sock
    this.groupJid = groupJid
    this.hostJid = hostJid
    this.options = options
    this.players = new Set([hostJid])
    this.isActive = false
    this.createdAt = Date.now()
    this.lastActivity = Date.now()
    this.maxPlayers = options.maxPlayers || 10
    this.minPlayers = options.minPlayers || 2
    this.timeoutMinutes = options.timeoutMinutes || 30
    this.gameId = null // Will be set by GameManager
  }

  async start() {
    throw new Error("start() method must be implemented by game class")
  }

  async processMessage(userJid, message) {
    throw new Error("processMessage() method must be implemented by game class")
  }

  async end(reason = "Game ended") {
    this.isActive = false
    await this.sendMessage(`🎮 ${reason}`)
  }

  async sendMessage(text, options = {}) {
    try {
      await this.sock.sendMessage(this.groupJid, { text }, options)
    } catch (error) {
      logger.error("Error sending game message:", error)
    }
  }

  async sendMentionMessage(text, mentions = []) {
    try {
      await this.sock.sendMessage(this.groupJid, { 
        text, 
        mentions 
      })
    } catch (error) {
      logger.error("Error sending mention message:", error)
    }
  }

  joinPlayer(userJid) {
    if (this.players.size >= this.maxPlayers) {
      return { success: false, message: "Game is full!" }
    }
    
    this.players.add(userJid)
    this.lastActivity = Date.now()
    return { success: true }
  }

  removePlayer(userJid) {
    this.players.delete(userJid)
    this.lastActivity = Date.now()
  }

  isPlayer(userJid) {
    return this.players.has(userJid)
  }

async isAdmin(userJid) {
  try {
    // Import admin checker from groups module
    const { isGroupAdmin } = await import("../../whatsapp/index.js")
    return await isGroupAdmin(this.sock, this.groupJid, userJid)
  } catch (error) {
    logger.error("Error checking admin status:", error)
    return false
  }
}

  isExpired() {
    const now = Date.now()
    const expireTime = this.timeoutMinutes * 60 * 1000
    return (now - this.lastActivity) > expireTime
  }

  updateActivity() {
    this.lastActivity = Date.now()
  }

  getPlayersList() {
    return Array.from(this.players).map(jid => `@${jid.split('@')[0]}`).join(', ')
  }

  formatUserMention(userJid) {
    return `@${userJid.split('@')[0]}`
  }
}

// Export singleton instance
const gameManager = new GameManager()
export { gameManager, BaseGame }