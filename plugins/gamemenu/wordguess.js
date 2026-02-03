import { gameManager } from "../../lib/game managers/game-manager.js"
import WordGuessingGame from "../../lib/game managers/word-guessing-game.js"

export default {
  name: "wordguess",
  commands: ["wordguess", "wordgame", "guessword"],
  description: "🔤 Start a word guessing game - Players guess letters or words based on clues!",
  adminOnly: false,
  groupOnly: true,

  async execute(sock, sessionId, args, m) {
    try {
      // Register the game if not already registered
      if (!gameManager.gameTypes.has("wordguess")) {
        gameManager.registerGame("wordguess", WordGuessingGame)
      }

      // Check if user wants to start the game
      if (args.length === 0) {
        const gameInfo = `🎯 *WORD GUESSING GAME* 🎯

📖 *How to Play:*
• Host starts the game and chooses a category
• Players guess letters one by one (A-Z)
• Or guess the complete word if you know it
• Get points for correct letter guesses
• Bonus points for solving the whole word
• Play through multiple rounds to win!

🎮 *Game Features:*
• 📚 Multiple categories: Animals, Countries, Food, Movies
• 🏆 Score tracking and leaderboards  
• ⏰ Multiple rounds (default: 5 rounds)
• 💡 Helpful clues for each word

🎲 *Categories Available:*
• 🦁 **Animals** - Guess creatures from around the world
• 🌍 **Countries** - Name nations and places
• 🍕 **Food** - Delicious dishes and treats
• 🎬 **Movies** - Popular films and shows

📝 *Commands During Game:*
• Type \`join\` to participate
• Type single letters (A-Z) to guess
• Type full words to solve immediately
• Host can end game with \`endgame\`

⚙️ *Start Options:*
• \`${m.prefix}wordguess start\` - Random category
• \`${m.prefix}wordguess animals\` - Animals only
• \`${m.prefix}wordguess countries\` - Countries only  
• \`${m.prefix}wordguess food\` - Food only
• \`${m.prefix}wordguess movies\` - Movies only
• \`${m.prefix}wordguess start rounds:3\` - Custom round count

Ready to test your vocabulary? 🧠✨

━━━━━━━━━━━━━━━━━━━━
> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

        await sock.sendMessage(m.chat, { text: gameInfo }, { quoted: m })
        return { success: true }
      }

      // Parse command arguments
      const command = args[0].toLowerCase()
      const options = {}

      // Handle category selection
      const validCategories = ['animals', 'countries', 'food', 'movies']
      if (validCategories.includes(command)) {
        options.category = command
      } else if (command !== 'start') {
        await sock.sendMessage(m.chat, {
          text: `❌ Invalid category! Available categories:\n🦁 animals\n🌍 countries\n🍕 food\n🎬 movies\n\nUse: \`${m.prefix}wordguess [category]\` or \`${m.prefix}wordguess start\`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m })
        return { success: false }
      }

      // Parse additional options
      for (let i = 1; i < args.length; i++) {
        const arg = args[i].toLowerCase()
        if (arg.startsWith('rounds:')) {
          const rounds = parseInt(arg.split(':')[1])
          if (rounds >= 1 && rounds <= 10) {
            options.rounds = rounds
          }
        }
      }

      // Start the game
      const result = await gameManager.startGame(
        sock, 
        m.chat, 
        "wordguess", 
        m.sender, 
        options
      )

      if (result.success) {
        //console.log(`[WordGuess] Game started by ${m.sender} in ${m.chat}`)
      } else {
        await sock.sendMessage(m.chat, { 
          text: result.message 
        }, { quoted: m })
      }

      return result

    } catch (error) {
      console.error("[WordGuess] Error:", error)
      await sock.sendMessage(m.chat, { 
        text: "❌ Error starting word guessing game. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }, { quoted: m })
      return { success: false, error: error.message }
    }
  },
}