import { gameManager } from "../../lib/game managers/game-manager.js"

export default {
  name: "endgame",
  commands: ["endgame", "stopgame", "gamestop"],
  description: "🛑 End active games in this group",
  permissions: {
  // All false = public command, no restrictions
},

  async execute(sock, sessionId, args, m) {
    try {
      // Check if there are any active games
      const activeGames = gameManager.getActiveGames(m.chat)
      if (activeGames.length === 0) {
        await sock.sendMessage(m.chat, {
          text: "❌ No active games found in this group!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
        }, { quoted: m })
        return { success: false, message: "No active games" }
      }

      // If only one game, end it
      if (activeGames.length === 1) {
        const result = await gameManager.endGame(sock, m.chat, m.sender)
        
        if (result.success) {
          await sock.sendMessage(m.chat, {
            text: `🛑 ${result.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m })
        } else {
          await sock.sendMessage(m.chat, {
            text: `🛑 ${result.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m })
        }

        return result
      }

      // Multiple games - show list or handle specific game
      if (args.length === 0) {
        // Show games list and instructions
        const gamesList = activeGames
          .map((game, index) => 
            `${index + 1}. ${game.name} (Host: @${game.hostJid.split('@')[0]}, Players: ${game.players.size})`
          )
          .join('\n')

        await sock.sendMessage(m.chat, {
          text: `🎮 **Multiple Active Games Found:**\n\n${gamesList}\n\n📋 **Options:**\n• \`${m.prefix}endgame all\` - End all your hosted games\n• \`${m.prefix}endgame [number]\` - End specific game by number\n• \`${m.prefix}endgame [gamename]\` - End by game type\n\n⚠️ You can only end games you host or if you're admin.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m })
        
        return { success: true }
      }

      const option = args[0].toLowerCase()

      // Handle "all" option - end all games hosted by user
      if (option === 'all') {
        const userHostedGames = activeGames.filter(game => game.hostJid === m.sender)
        
        if (userHostedGames.length === 0) {
          await sock.sendMessage(m.chat, {
            text: "❌ You don't host any active games!\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
          }, { quoted: m })
          return { success: false }
        }

        let endedCount = 0
        const endedGames = []

        for (const game of userHostedGames) {
          const result = await gameManager.endGame(sock, m.chat, m.sender, game.gameId)
          if (result.success) {
            endedCount++
            endedGames.push(game.name)
          }
        }

        await sock.sendMessage(m.chat, {
          text: `🛑 Ended ${endedCount} game(s): ${endedGames.join(', ')}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m })

        return { success: true }
      }

      // Handle number selection (1, 2, 3...)
      const gameNumber = parseInt(option)
      if (!isNaN(gameNumber) && gameNumber >= 1 && gameNumber <= activeGames.length) {
        const selectedGame = activeGames[gameNumber - 1]
        const result = await gameManager.endGame(sock, m.chat, m.sender, selectedGame.gameId)
        
        if (result.success) {
          await sock.sendMessage(m.chat, {
            text: `🛑 ${result.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m })
        } else {
          await sock.sendMessage(m.chat, {
            text: result.message
          }, { quoted: m })
        }

        return result
      }

      // Handle game name selection
      const gamesByName = activeGames.filter(game => 
        game.name.toLowerCase().includes(option) || 
        game.name.toLowerCase().replace(/\s/g, '') === option.replace(/\s/g, '')
      )

      if (gamesByName.length === 0) {
        await sock.sendMessage(m.chat, {
          text: `❌ No active games found matching "${option}"\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m })
        return { success: false }
      }

      if (gamesByName.length === 1) {
        const result = await gameManager.endGame(sock, m.chat, m.sender, gamesByName[0].gameId)
        
        if (result.success) {
          await sock.sendMessage(m.chat, {
            text: `🛑 ${result.message}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          }, { quoted: m })
        } else {
          await sock.sendMessage(m.chat, {
            text: result.message
          }, { quoted: m })
        }

        return result
      }

      // Multiple games with same name
      const gamesList = gamesByName
        .map((game, index) => 
          `${index + 1}. ${game.name} (Host: @${game.hostJid.split('@')[0]})`
        )
        .join('\n')

      await sock.sendMessage(m.chat, {
        text: `🎮 **Multiple ${option} games found:**\n\n${gamesList}\n\nPlease be more specific with the game number.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      }, { quoted: m })

      return { success: true }

    } catch (error) {
      console.error("[EndGame] Error:", error)
      await sock.sendMessage(m.chat, {
        text: "❌ Error ending game. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙"
      }, { quoted: m })
      return { success: false, error: error.message }
    }
  },
}