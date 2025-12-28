import { gameManager } from "../../lib/game managers/game-manager.js"
import TriviaGame from "../../lib/game managers/TriviaGame.js"

export default {
  name: "trivia",
  commands: ["trivia", "knowledge"],
  description: "🧠 Start a trivia quiz game - Test your knowledge across multiple categories!",
  adminOnly: false,
  groupOnly: true,

  async execute(sock, sessionId, args, m) {
    try {
      // Register the game if not already registered
      if (!gameManager.gameTypes.has("trivia")) {
        gameManager.registerGame("trivia", TriviaGame)
      }

      // Check if user wants to start the game
      if (args.length === 0) {
        const gameInfo = `🧠 *TRIVIA QUIZ GAME* 🧠

📖 *How to Play:*
• Answer multiple choice questions
• Choose A, B, C, or D for each question
• 30 seconds per question
• Earn points for correct answers
• Most points wins!

🎮 *Game Features:*
• 📚 Multiple categories available
• 🎯 Different difficulty levels
• ⏱️ Time-based gameplay
• 🏆 Progressive scoring system
• 🧠 Knowledge from various topics

📚 *Categories Available:*
• 🔬 **Science** - Physics, Chemistry, Biology
• 🏛️ **History** - World events and figures
• 🌍 **Geography** - Countries, capitals, landmarks
• 🎬 **Entertainment** - Movies, music, celebrities
• 🎲 **Mixed** - Questions from all categories

📊 *Difficulty Levels:*
• 🟢 **Easy** - Basic knowledge (10 points)
• 🟡 **Medium** - Moderate difficulty (15 points)
• 🔴 **Hard** - Expert level (25 points)
• 🌈 **Mixed** - All difficulty levels

📝 *Commands During Game:*
• Type \`join\` to participate
• Type \`A\`, \`B\`, \`C\`, or \`D\` to answer
• Quick answers = same points, no time bonus

⚙️ *Start Options:*
• \`${m.prefix}trivia start\` - Mixed categories, medium
• \`${m.prefix}trivia science\` - Science category
• \`${m.prefix}trivia history\` - History category
• \`${m.prefix}trivia geography\` - Geography category
• \`${m.prefix}trivia entertainment\` - Entertainment category
• \`${m.prefix}trivia easy\` - Easy difficulty, mixed
• \`${m.prefix}trivia hard\` - Hard difficulty, mixed
• \`${m.prefix}trivia start questions:15\` - Custom question count

Ready to challenge your mind? 🤔💡

━━━━━━━━━━━━━━━━━━━━
> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

        await sock.sendMessage(m.chat, { text: gameInfo }, { quoted: m })
        return { success: true }
      }

      // Parse command arguments
      const command = args[0].toLowerCase()
      const options = {}

      // Handle category or difficulty selection
      const validCategories = ['science', 'history', 'geography', 'entertainment', 'mixed']
      const validDifficulties = ['easy', 'medium', 'hard', 'mixed']

      if (validCategories.includes(command)) {
        options.category = command
      } else if (validDifficulties.includes(command)) {
        options.difficulty = command
      } else if (command !== 'start') {
        await sock.sendMessage(m.chat, {
          text: `❌ Invalid option! Available options:\n\n📚 **Categories:**\n🔬 science\n🏛️ history\n🌍 geography\n🎬 entertainment\n🎲 mixed\n\n📊 **Difficulties:**\n🟢 easy\n🟡 medium\n🔴 hard\n🌈 mixed\n\nUse: \`${m.prefix}trivia [category/difficulty]\`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
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
        "trivia", 
        m.sender, 
        options
      )

      if (result.success) {
        console.log(`[Trivia] Game started by ${m.sender} in ${m.chat}`)
      } else {
        await sock.sendMessage(m.chat, { 
          text: result.message 
        }, { quoted: m })
      }

      return result

    } catch (error) {
      console.error("[Trivia] Error:", error)
      await sock.sendMessage(m.chat, { 
        text: "❌ Error starting trivia quiz. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }, { quoted: m })
      return { success: false, error: error.message }
    }
  },
}