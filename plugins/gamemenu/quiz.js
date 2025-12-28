import { gameManager } from "../../lib/game managers/game-manager.js"
import MathQuizGame from "../../lib/game managers/math-quiz-game.js"

export default {
  name: "mathquiz",
  commands: ["mathquiz", "math", "quiz"],
  description: "🧮 Start a math quiz game - Test your calculation skills!",
  adminOnly: false,
  groupOnly: true,

  async execute(sock, sessionId, args, m) {
    try {
      // Register the game if not already registered
      if (!gameManager.gameTypes.has("mathquiz")) {
        gameManager.registerGame("mathquiz", MathQuizGame)
      }

      // Check if user wants to start the game
      if (args.length === 0) {
        const gameInfo = `🧮 *MATH QUIZ GAME* 🧮

📖 *How to Play:*
• Answer mathematical questions as fast as you can
• Each question has a 30-second time limit
• Earn points for correct answers
• Faster answers = higher scores!
• Compete through multiple rounds

🎮 *Game Features:*
• 🎯 Multiple difficulty levels (Easy, Medium, Hard)
• ⏱️ Time-based scoring system
• 🏆 Real-time leaderboard
• 🔢 Various operations (+, -, ×, ÷)
• 📊 Score tracking across questions

📊 *Difficulty Levels:*
• 🟢 **Easy** - Numbers 1-20 (10 pts per answer)
• 🟡 **Medium** - Numbers 1-50 (15 pts per answer)
• 🔴 **Hard** - Numbers 1-100 (20 pts per answer)

⚡ *Scoring System:*
• Correct answer = Base points based on difficulty
• Time bonus for quick answers
• No penalties for wrong answers
• Highest total score wins!

📝 *Commands During Game:*
• Type \`join\` to participate (can join anytime)
• Type number answers directly
• Host can end game with \`endgame\`

⚙️ *Start Options:*
• \`${m.prefix}mathquiz start\` - Medium difficulty
• \`${m.prefix}mathquiz easy\` - Easy mode
• \`${m.prefix}mathquiz medium\` - Medium mode
• \`${m.prefix}mathquiz hard\` - Hard mode
• \`${m.prefix}mathquiz start questions:15\` - Custom question count

Ready to exercise your brain? 🧠💪

━━━━━━━━━━━━━━━━━━━━
> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

        await sock.sendMessage(m.chat, { text: gameInfo }, { quoted: m })
        return { success: true }
      }

      // Parse command arguments
      const command = args[0].toLowerCase()
      const options = {}

      // Handle difficulty selection
      const validDifficulties = ['easy', 'medium', 'hard']
      if (validDifficulties.includes(command)) {
        options.difficulty = command
      } else if (command !== 'start') {
        await sock.sendMessage(m.chat, {
          text: `❌ Invalid difficulty! Available difficulties:\n🟢 easy\n🟡 medium\n🔴 hard\n\nUse: \`${m.prefix}mathquiz [difficulty]\` or \`${m.prefix}mathquiz start\`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m })
        return { success: false }
      }

      // Parse additional options
      for (let i = 1; i < args.length; i++) {
        const arg = args[i].toLowerCase()
        if (arg.startsWith('questions:')) {
          const questions = parseInt(arg.split(':')[1])
          if (questions >= 5 && questions <= 20) {
            options.questions = questions
          }
        }
      }

      // Start the game
      const result = await gameManager.startGame(
        sock, 
        m.chat, 
        "mathquiz", 
        m.sender, 
        options
      )

      if (result.success) {
        console.log(`[MathQuiz] Game started by ${m.sender} in ${m.chat}`)
      } else {
        await sock.sendMessage(m.chat, { 
          text: result.message 
        }, { quoted: m })
      }

      return result

    } catch (error) {
      console.error("[MathQuiz] Error:", error)
      await sock.sendMessage(m.chat, { 
        text: "❌ Error starting math quiz game. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }, { quoted: m })
      return { success: false, error: error.message }
    }
  },
}