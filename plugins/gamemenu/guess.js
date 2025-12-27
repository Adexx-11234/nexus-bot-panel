import { gameManager } from "../../lib/game managers/game-manager.js"
import NumberGuessingGame from "../../lib/game managers/number-guessing-game.js"

export default {
  name: "numguess",
  commands: ["numguess", "numberguess", "guessnum"],
  description: "🔢 Start a number guessing game - Guess the secret number!",
  permissions: {
  // All false = public command, no restrictions
},
category: "gamemenu",
  usage: "• .numguess [option] - Start number guessing game\n\n*Options:*\n• easy - Range 1-50\n• medium - Range 1-100\n• hard - Range 1-200\n• custom MIN:MAX - Custom range\n\n*Example:*\n.numguess easy",

  async execute(sock, sessionId, args, m) {
    try {
      // Register the game if not already registered
      if (!gameManager.gameTypes.has("numguess")) {
        gameManager.registerGame("numguess", NumberGuessingGame)
      }

      // Check if user wants to start the game
      if (args.length === 0) {
        const gameInfo = `🔢 *NUMBER GUESSING GAME* 🔢

📖 *How to Play:*
• Bot picks a secret number within a range
• Players try to guess the number
• Get "too high" or "too low" feedback
• Each player gets limited attempts
• First to guess correctly wins!

🎮 *Game Features:*
• 🎯 Customizable number ranges
• 💡 Progressive hints system
• 🎪 Multiple players can compete
• ⏰ Limited attempts per player
• 🏆 Score based on attempts used

🎲 *Difficulty Ranges:*
• 🟢 **Easy** - 1 to 50 (7 attempts)
• 🟡 **Medium** - 1 to 100 (5 attempts)
• 🔴 **Hard** - 1 to 200 (5 attempts)
• 🔥 **Custom** - Set your own range

💡 *Hint System:*
• 🎯 Immediate: High/Low feedback
• 💫 After 2 attempts: Odd/Even hint
• ✨ After 4 attempts: Additional mathematical hints
• 🔍 Progressive clues help narrow down

📝 *Commands During Game:*
• Type \`join\` to participate
• Type number guesses directly
• Host can end game with \`endgame\`

⚙️ *Start Options:*
• \`${m.prefix}numguess start\` - Medium (1-100)
• \`${m.prefix}numguess easy\` - Easy mode (1-50)
• \`${m.prefix}numguess hard\` - Hard mode (1-200)
• \`${m.prefix}numguess custom 1:500\` - Custom range
• \`${m.prefix}numguess start attempts:7\` - Custom attempts

Think you can crack the code? 🕵️‍♂️🔍

━━━━━━━━━━━━━━━━━━━━
> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

        await sock.sendMessage(m.chat, { text: gameInfo }, { quoted: m })
        return { success: true }
      }

      // Parse command arguments
      const command = args[0].toLowerCase()
      const options = {}

      // Handle difficulty/range selection
      if (command === 'easy') {
        options.min = 1
        options.max = 50
        options.maxAttempts = 7
      } else if (command === 'medium' || command === 'start') {
        options.min = 1
        options.max = 100
        options.maxAttempts = 5
      } else if (command === 'hard') {
        options.min = 1
        options.max = 200
        options.maxAttempts = 5
      } else if (command === 'custom') {
        // Handle custom range like "custom 1:500"
        if (args.length > 1) {
          const range = args[1].split(':')
          if (range.length === 2) {
            const min = parseInt(range[0])
            const max = parseInt(range[1])
            if (!isNaN(min) && !isNaN(max) && min < max) {
              options.min = min
              options.max = max
              options.maxAttempts = Math.min(Math.max(Math.ceil(Math.log2(max - min + 1)), 3), 10)
            }
          }
        }
      } else {
        await sock.sendMessage(m.chat, {
          text: `❌ Invalid option! Available options:\n🟢 easy (1-50)\n🟡 medium (1-100)\n🔴 hard (1-200)\n🎯 custom MIN:MAX\n\nUse: \`${m.prefix}numguess [option]\`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m })
        return { success: false }
      }

      // Parse additional options
      for (let i = 1; i < args.length; i++) {
        const arg = args[i].toLowerCase()
        if (arg.startsWith('attempts:')) {
          const attempts = parseInt(arg.split(':')[1])
          if (attempts >= 3 && attempts <= 15) {
            options.maxAttempts = attempts
          }
        }
      }

      // Start the game
      const result = await gameManager.startGame(
        sock, 
        m.chat, 
        "numguess", 
        m.sender, 
        options
      )

      if (result.success) {
        console.log(`[NumberGuess] Game started by ${m.sender} in ${m.chat}`)
      } else {
        await sock.sendMessage(m.chat, { 
          text: result.message 
        }, { quoted: m })
      }

      return result

    } catch (error) {
      console.error("[NumberGuess] Error:", error)
      await sock.sendMessage(m.chat, { 
        text: "❌ Error starting number guessing game. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }, { quoted: m })
      return { success: false, error: error.message }
    }
  },
}