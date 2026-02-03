import { gameManager } from "../../lib/game managers/game-manager.js"
import ReactionSpeedGame from "../../lib/game managers/ReactionSpeedGame.js"

export default {
  name: "reaction",
  commands: ["reaction", "speed", "reflex"],
  description: "⚡ Start a reaction speed game - Test your lightning reflexes!",
  adminOnly: false,
  groupOnly: true,

  async execute(sock, sessionId, args, m) {
    try {
      // Register the game if not already registered
      if (!gameManager.gameTypes.has("reaction")) {
        gameManager.registerGame("reaction", ReactionSpeedGame)
      }

      // Check if user wants to start the game
      if (args.length === 0) {
        const gameInfo = `⚡ *REACTION SPEED GAME* ⚡

📖 *How to Play:*
• Wait for the 🟢 GO signal
• Type 'go' as fast as possible!
• Fastest reaction wins the round
• Multiple rounds = tournament style
• Points based on reaction speed

🎮 *Game Rules:*
• 🔴 Wait for countdown phase
• 🟢 React when signal appears
• ⚡ Type 'go' immediately
• 🏆 Fastest wins each round
• ❌ Early reactions = disqualification

⏱️ *Scoring System:*
• 🥇 Fastest reaction: 100+ points
• 🥈 Quick reactions: 50-99 points
• 🥉 Good reactions: 25-49 points
• 🐌 Slow reactions: 10-24 points
• 💨 Speed bonus for sub-500ms!

🧠 *Strategy Tips:*
• 👀 Focus completely on screen
• 🤏 Keep fingers ready
• 🚫 Don't anticipate too much
• ⚡ React, don't think!

📝 *Commands During Game:*
• Type \`join\` to participate
• Type \`go\` when signal appears
• Stay focused and be patient!

⚙️ *Start Options:*
• \`${m.prefix}reaction start\` - 5 rounds
• \`${m.prefix}reaction quick\` - 3 rounds
• \`${m.prefix}reaction marathon\` - 10 rounds
• \`${m.prefix}reaction start rounds:7\` - Custom rounds

Ready to test your reflexes? 🏃‍♂️💨

━━━━━━━━━━━━━━━━━━━━
> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

        await sock.sendMessage(m.chat, { text: gameInfo }, { quoted: m })
        return { success: true }
      }

      // Parse command arguments
      const command = args[0].toLowerCase()
      const options = {}

      // Handle game type
      if (command === 'quick') {
        options.rounds = 3
      } else if (command === 'marathon') {
        options.rounds = 10
      } else if (command !== 'start') {
        await sock.sendMessage(m.chat, {
          text: `❌ Invalid option! Available options:\n⚡ quick (3 rounds)\n🏆 start (5 rounds)\n🏃 marathon (10 rounds)\n\nUse: \`${m.prefix}reaction [option]\`\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        }, { quoted: m })
        return { success: false }
      }

      // Parse additional options
      for (let i = 1; i < args.length; i++) {
        const arg = args[i].toLowerCase()
        if (arg.startsWith('rounds:')) {
          const rounds = parseInt(arg.split(':')[1])
          if (rounds >= 1 && rounds <= 15) {
            options.rounds = rounds
          }
        }
      }

      // Start the game
      const result = await gameManager.startGame(
        sock, 
        m.chat, 
        "reaction", 
        m.sender, 
        options
      )

      if (result.success) {
        //console.log(`[Reaction] Game started by ${m.sender} in ${m.chat}`)
      } else {
        await sock.sendMessage(m.chat, { 
          text: result.message 
        }, { quoted: m })
      }

      return result

    } catch (error) {
      console.error("[Reaction] Error:", error)
      await sock.sendMessage(m.chat, { 
        text: "❌ Error starting reaction speed game. Please try again.\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙" 
      }, { quoted: m })
      return { success: false, error: error.message }
    }
  },
}