import { gameManager } from "../../lib/game managers/game-manager.js"
import RockPaperScissorsGame from "../../lib/game managers/rock-paper-scissors.js"

export default {
  name: "rps",
  commands: ["rps", "rockpaperscissors", "tournament"],
  description: "✂️ Start a Rock Paper Scissors tournament - Battle for supremacy!",
  permissions: {
  // All false = public command, no restrictions
},
category: "gamemenu",
  usage: "• .rps [option] - Start Rock Paper Scissors tournament\n\n*Options:*\n• quick - 3 rounds\n• epic - 10 rounds\n• custom rounds:N - Custom rounds\n\n*Example:*\n.rps quick",

  async execute(sock, sessionId, args, m) {
    try {
      // Register the game if not already registered
      if (!gameManager.gameTypes.has("rps")) {
        gameManager.registerGame("rps", RockPaperScissorsGame)
      }

      // Check if user wants to start the game
      if (args.length === 0) {
        const gameInfo = `✂️ *ROCK PAPER SCISSORS TOURNAMENT* 🪨

📖 *How to Play:*
• Classic RPS but with multiple players
• Each round, all players choose simultaneously
• Winners of each round get points
• Most points after all rounds wins!
• Fast-paced tournament style

🎮 *Tournament Rules:*
• 🪨 Rock beats ✂️ Scissors
• 📄 Paper beats 🪨 Rock  
• ✂️ Scissors beats 📄 Paper
• ⏰ 15 seconds per round
• 🏆 1 point per round win

⚡ *Game Flow:*
• All players choose simultaneously
• Choices revealed together
• Winners get points
• Multiple rounds = tournament!
• Highest score wins the championship

🎯 *Strategy Tips:*
• 📊 Watch opponent patterns
• 🎲 Mix up your choices
• ⚡ Be quick with decisions
• 🧠 Psychology matters!

📝 *Commands During Game:*
• Type \`join\` to enter tournament
• Type \`rock\` or \`r\` for Rock 🪨
• Type \`paper\` or \`p\` for Paper 📄
• Type \`scissors\` or \`s\` for Scissors ✂️

⚙️ *Start Options:*
• \`${m.prefix}rps start\` - 5 rounds tournament
• \`${m.prefix}rps quick\` - 3 rounds tournament
• \`${m.prefix}rps epic\` - 10 rounds tournament
• \`${m.prefix}rps start rounds:7\` - Custom rounds

Ready for battle? ⚔️💪

━━━━━━━━━━━━━━━━━━━━
> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

        await sock.sendMessage(m.chat, { text: gameInfo }, { quoted: m })
        return { success: true }
      }

      // Parse command arguments
      const command = args[0].toLowerCase()
      const options = {}

      // Handle tournament type
      if (command === 'quick') {
        options.rounds = 3
      } else if (command === 'epic') {
        options.rounds = 10
      } else if (command !== 'start') {
        await sock.sendMessage(m.chat, {
          text: `❌ Invalid option! Available options:\n⚡ quick (3 rounds)\n🏆 start (5 rounds)\n🔥 epic (10 rounds)\n\nUse: \`${m.prefix}rps [option]\`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m })
        return { success: false }
      }

      // Parse additional options
      for (let i = 1; i < args.length; i++) {
        const arg = args[i].toLowerCase()
        if (arg.startsWith('rounds:')) {
          const rounds = parseInt(arg.split(':')[1])
          if (rounds >= 1 && rounds <= 20) {
            options.rounds = rounds
          }
        }
      }

      // Start the game
      const result = await gameManager.startGame(
        sock, 
        m.chat, 
        "rps", 
        m.sender, 
        options
      )

      if (result.success) {
        console.log(`[RPS] Tournament started by ${m.sender} in ${m.chat}`)
      } else {
        await sock.sendMessage(m.chat, { 
          text: result.message 
        }, { quoted: m })
      }

      return result

    } catch (error) {
      console.error("[RPS] Error:", error)
      await sock.sendMessage(m.chat, { 
        text: "❌ Error starting RPS tournament. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }, { quoted: m })
      return { success: false, error: error.message }
    }
  },
}