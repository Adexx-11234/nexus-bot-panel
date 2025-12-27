import { gameManager } from "../../lib/game managers/game-manager.js"

export default {
  name: "games",
  commands: ["games", "gamelist", "activegames"],
  description: "🎮 Show active games and gaming statistics",
  permissions: {
  // All false = public command, no restrictions
},

  async execute(sock, sessionId, args, m) {
    try {
      const command = args[0]?.toLowerCase() || 'list'

      switch (command) {
        case 'list':
        case 'active':
          return await this.showActiveGames(sock, m)
        
        case 'stats':
        case 'statistics':
          return await this.showGameStats(sock, m)
        
        case 'available':
        case 'all':
          return await this.showAvailableGames(sock, m)
        
        case 'help':
          return await this.showHelp(sock, m)
        
        default:
          return await this.showActiveGames(sock, m)
      }

    } catch (error) {
      console.error("[Games] Error:", error)
      await sock.sendMessage(m.chat, {
        text: "❌ Error retrieving games information. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
      return { success: false, error: error.message }
    }
  },

  async showActiveGames(sock, m) {
    const activeGames = gameManager.getActiveGames(m.chat)
    
    if (activeGames.length === 0) {
      await sock.sendMessage(m.chat, {
        text: `🎮 *ACTIVE GAMES* 🎮\n\n❌ No active games in this group!\n\nStart a game with:\n• \`${m.prefix}wordguess\` - Word guessing\n• \`${m.prefix}tictactoe\` - TicTacToe\n• \`${m.prefix}mathquiz\` - Math quiz\n• \`${m.prefix}trivia\` - Trivia quiz\n• \`${m.prefix}rps\` - Rock Paper Scissors\n• \`${m.prefix}reaction\` - Speed test\n• \`${m.prefix}numguess\` - Number guessing\n\n━━━━━━━━━━━━━━━━━━━━\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })
      return { success: true }
    }

    let gamesList = `🎮 *ACTIVE GAMES* 🎮\n\n`
    
    activeGames.forEach((game, index) => {
      const timeElapsed = Math.floor((Date.now() - game.createdAt) / 60000)
      const hostMention = `@${game.hostJid.split('@')[0]}`
      
      gamesList += `${index + 1}. **${game.name}** 🎯\n`
      gamesList += `   👥 Host: ${hostMention}\n`
      gamesList += `   👫 Players: ${game.players.size}/${game.maxPlayers}\n`
      gamesList += `   ⏰ Running: ${timeElapsed}m\n`
      
      if (game.vsBot) {
        gamesList += `   🤖 vs Bot (${game.botDifficulty})\n`
      }
      
      gamesList += `\n`
    })

    gamesList += `📊 **Group Stats:**\n`
    gamesList += `• Active Games: ${activeGames.length}/${gameManager.maxGamesPerGroup}\n`
    gamesList += `• Total Players: ${new Set(activeGames.flatMap(g => Array.from(g.players))).size}\n\n`
    
    gamesList += `💡 Use \`${m.prefix}endgame\` to end games\n`
    gamesList += `📋 Use \`${m.prefix}games stats\` for more info\n\n`
    gamesList += `━━━━━━━━━━━━━━━━━━━━\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

    await sock.sendMessage(m.chat, { text: gamesList }, { quoted: m })
    return { success: true }
  },

  async showGameStats(sock, m) {
    const playerStats = gameManager.getPlayerStats(m.sender)
    const totalActiveGames = gameManager.getTotalActiveGames()
    const totalActiveGroups = gameManager.getActiveGroupsCount()
    const availableGames = gameManager.getAvailableGames()

    const statsText = `📊 *GAMING STATISTICS* 📊\n\n` +
      `👤 **Your Personal Stats:**\n` +
      `🎮 Games Played: ${playerStats.gamesPlayed}\n` +
      `🏆 Games Won: ${playerStats.gamesWon}\n` +
      `📈 Win Rate: ${playerStats.gamesPlayed > 0 ? Math.round((playerStats.gamesWon / playerStats.gamesPlayed) * 100) : 0}%\n` +
      `⭐ Total Score: ${playerStats.totalScore}\n` +
      `💖 Favorite Game: ${playerStats.favoriteGame || 'None yet'}\n` +
      `📅 Last Played: ${playerStats.lastPlayed ? new Date(playerStats.lastPlayed).toLocaleDateString() : 'Never'}\n\n` +
      
      `🌐 **Global Bot Stats:**\n` +
      `🎯 Active Games: ${totalActiveGames}\n` +
      `👥 Active Groups: ${totalActiveGroups}\n` +
      `🎮 Available Games: ${availableGames.length}\n\n` +
      
      `📋 **Available Games:**\n` +
      `• Word Guessing 🔤\n` +
      `• TicTacToe ⭕\n` +
      `• Math Quiz 🧮\n` +
      `• Trivia Quiz 🧠\n` +
      `• Rock Paper Scissors ✂️\n` +
      `• Reaction Speed ⚡\n` +
      `• Number Guessing 🔢\n\n` +
      
      `━━━━━━━━━━━━━━━━━━━━\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

    await sock.sendMessage(m.chat, { text: statsText }, { quoted: m })
    return { success: true }
  },

  async showAvailableGames(sock, m) {
    const gamesInfo = `🎯 *AVAILABLE GAMES* 🎯\n\n` +
      
      `🔤 **Word Guessing** (\`${m.prefix}wordguess\`)\n` +
      `   • Guess letters or words from clues\n` +
      `   • Multiple categories & rounds\n` +
      `   • Perfect for groups!\n\n` +
      
      `⭕ **TicTacToe** (\`${m.prefix}tictactoe\`)\n` +
      `   • Classic 3x3 grid battle\n` +
      `   • vs Human or vs AI Bot\n` +
      `   • 3 difficulty levels\n\n` +
      
      `🧮 **Math Quiz** (\`${m.prefix}mathquiz\`)\n` +
      `   • Fast-paced calculation challenges\n` +
      `   • Multiple difficulty levels\n` +
      `   • Time-based scoring\n\n` +
      
      `🧠 **Trivia Quiz** (\`${m.prefix}trivia\`)\n` +
      `   • Test knowledge across categories\n` +
      `   • Science, History, Geography, Entertainment\n` +
      `   • Multiple choice questions\n\n` +
      
      `✂️ **Rock Paper Scissors** (\`${m.prefix}rps\`)\n` +
      `   • Tournament-style battles\n` +
      `   • Multiple players compete\n` +
      `   • Quick rounds, fast action\n\n` +
      
      `⚡ **Reaction Speed** (\`${m.prefix}reaction\`)\n` +
      `   • Test your reflexes\n` +
      `   • Millisecond precision\n` +
      `   • Competitive scoring\n\n` +
      
      `🔢 **Number Guessing** (\`${m.prefix}numguess\`)\n` +
      `   • Guess the secret number\n` +
      `   • Progressive hints system\n` +
      `   • Multiple difficulty ranges\n\n` +
      
      `🎮 **How to Play:**\n` +
      `1. Type any game command to see rules\n` +
      `2. Add 'start' or options to begin\n` +
      `3. Follow in-game instructions\n` +
      `4. Use \`${m.prefix}endgame\` to stop\n\n` +
      
      `━━━━━━━━━━━━━━━━━━━━\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

    await sock.sendMessage(m.chat, { text: gamesInfo }, { quoted: m })
    return { success: true }
  },

  async showHelp(sock, m) {
    const helpText = `🎮 *GAMES HELP* 🎮\n\n` +
      
      `📋 **Commands:**\n` +
      `• \`${m.prefix}games\` - Show active games\n` +
      `• \`${m.prefix}games stats\` - Your statistics\n` +
      `• \`${m.prefix}games available\` - All available games\n` +
      `• \`${m.prefix}endgame\` - End active games\n\n` +
      
      `🎯 **Quick Start:**\n` +
      `• Type any game name to see rules\n` +
      `• Add 'start' to begin playing\n` +
      `• Most games support multiple players\n` +
      `• Up to ${gameManager.maxGamesPerGroup} games per group\n\n` +
      
      `⚡ **Pro Tips:**\n` +
      `• Games auto-end after 30 minutes\n` +
      `• Only hosts/admins can end games\n` +
      `• Join games anytime (most games)\n` +
      `• Bot games available for solo play\n\n` +
      
      `━━━━━━━━━━━━━━━━━━━━\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

    await sock.sendMessage(m.chat, { text: helpText }, { quoted: m })
    return { success: true }
  }
}