import { BaseGame } from "./game-manager.js"

export default class ReactionSpeedGame extends BaseGame {
  constructor(sock, groupJid, hostJid, options = {}) {
    super(sock, groupJid, hostJid, options)
    this.name = "Reaction Speed"
    this.rounds = options.rounds || 5
    this.currentRound = 1
    this.gamePhase = 'waiting' // waiting, countdown, active, results
    this.startTime = null
    this.reactionTimes = new Map()
    this.playerScores = new Map()
    this.winnerFound = false
    this.countdownTimer = null
    this.gameTimer = null
  }

  async start() {
    this.isActive = true
    
    await this.sendMessage(
      `⚡ *REACTION SPEED GAME!* ⚡\n\n` +
      `🎯 Rounds: ${this.rounds}\n` +
      `👥 Host: @${this.hostJid.split('@')[0]}\n\n` +
      `📋 *How to Play:*\n` +
      `• Wait for the GO signal 🟢\n` +
      `• Type 'go' as fast as possible!\n` +
      `• Fastest reaction wins the round\n` +
      `• Points based on reaction speed\n\n` +
      `⚠️ *Warning: DON'T type 'go' early!*\n` +
      `Early typing = disqualification!\n\n` +
      `Type 'join' to participate!\n` +
      `Game starts in 15 seconds...`
    )

    setTimeout(() => {
      if (this.isActive) {
        this.startRound()
      }
    }, 15000)

    return { success: true }
  }

  async startRound() {
    if (this.players.size < 2) {
      await this.sendMessage(`❌ Need at least 2 players for reaction game!`)
      return this.end()
    }

    this.gamePhase = 'countdown'
    this.reactionTimes.clear()
    this.winnerFound = false

    await this.sendMessage(
      `🔄 *ROUND ${this.currentRound}/${this.rounds}* 🔄\n\n` +
      `Players: ${this.getPlayersList()}\n\n` +
      `🔴 GET READY...\n` +
      `⚠️ Wait for the green signal!\n` +
      `❌ Don't type anything yet!`
    )

    // Random delay between 3-8 seconds
    const delay = Math.random() * 5000 + 3000

    this.countdownTimer = setTimeout(async () => {
      if (this.isActive) {
        this.gamePhase = 'active'
        this.startTime = Date.now()
        
        await this.sendMessage(
          `🟢 *GO GO GO!* 🟢\n\n` +
          `⚡ TYPE 'go' NOW! ⚡`
        )

        // End round after 5 seconds if no one reacts
        this.gameTimer = setTimeout(() => {
          if (this.isActive && !this.winnerFound) {
            this.processRound()
          }
        }, 5000)
      }
    }, delay)
  }

  async processMessage(userJid, message) {
    if (!this.isActive) return null

    this.updateActivity()
    const input = message.toLowerCase().trim()

    if (this.gamePhase === 'waiting' && input === 'join') {
      return await this.handleJoin(userJid)
    }

    if (this.gamePhase === 'countdown' && input === 'go') {
      // Early reaction - disqualify
      await this.sendMessage(`❌ @${userJid.split('@')[0]} reacted too early! Wait for the green signal!`)
      return { success: false, message: "Too early!" }
    }

    if (this.gamePhase === 'active' && input === 'go' && this.isPlayer(userJid)) {
      return await this.handleReaction(userJid)
    }

    return null
  }

  async handleJoin(userJid) {
    if (this.isPlayer(userJid)) {
      return { success: false, message: "You're already in the game!" }
    }

    const joinResult = this.joinPlayer(userJid)
    if (joinResult.success) {
      this.playerScores.set(userJid, 0)
      await this.sendMessage(`⚡ @${userJid.split('@')[0]} joined the speed test! (${this.players.size} players)`)
    }
    return joinResult
  }

  async handleReaction(userJid) {
    if (this.reactionTimes.has(userJid)) {
      return { success: false, message: "You already reacted!" }
    }

    const reactionTime = Date.now() - this.startTime
    this.reactionTimes.set(userJid, reactionTime)

    // First to react wins immediately
    if (!this.winnerFound) {
      this.winnerFound = true
      clearTimeout(this.gameTimer)
      
      // Award points based on reaction time
      const points = Math.max(100 - Math.floor(reactionTime / 50), 10)
      const currentScore = this.playerScores.get(userJid) || 0
      this.playerScores.set(userJid, currentScore + points)

      await this.sendMessage(`🏆 @${userJid.split('@')[0]} wins! ⚡\nReaction time: ${reactionTime}ms (+${points} points)`)
      
      setTimeout(() => this.processRound(), 2000)
    }

    return { success: true }
  }

  async processRound() {
    this.gamePhase = 'results'

    let resultText = `📊 *ROUND ${this.currentRound} RESULTS* 📊\n\n`

    if (this.reactionTimes.size === 0) {
      resultText += `😴 Nobody reacted in time!\n\n`
    } else {
      const sortedReactions = Array.from(this.reactionTimes.entries())
        .sort((a, b) => a[1] - b[1])

      sortedReactions.forEach(([jid, time], index) => {
        const medal = ['🥇', '🥈', '🥉'][index] || '⚡'
        resultText += `${medal} @${jid.split('@')[0]}: ${time}ms\n`
      })
    }

    resultText += `\n${this.getScoreBoard()}`
    await this.sendMessage(resultText)

    // Next round or end game
    this.currentRound++
    if (this.currentRound > this.rounds) {
      setTimeout(() => this.endGame(), 3000)
    } else {
      setTimeout(() => {
        if (this.isActive) {
          this.startRound()
        }
      }, 4000)
    }
  }

  getScoreBoard() {
    const scores = Array.from(this.playerScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map((entry, index) => {
        const medal = ['🥇', '🥈', '🥉'][index] || '⚡'
        return `${medal} @${entry[0].split('@')[0]}: ${entry[1]} points`
      })
      .join('\n')

    return `🏆 *LEADERBOARD*\n${scores}`
  }

  async endGame() {
    const winner = this.getWinner()
    
    await this.sendMentionMessage(
      `⚡ *SPEED TEST COMPLETE!* ⚡\n\n` +
      `🏆 Fastest Reactor: @${winner.jid.split('@')[0]} with ${winner.score} points!\n\n` +
      `${this.getScoreBoard()}\n\n` +
      `Lightning-fast reflexes! ⚡🧠`,
      Array.from(this.players)
    )

    this.isActive = false
    return { success: true }
  }

  getWinner() {
    let maxScore = -1
    let winner = null

    for (const [jid, score] of this.playerScores.entries()) {
      if (score > maxScore) {
        maxScore = score
        winner = { jid, score }
      }
    }

    return winner || { jid: this.hostJid, score: 0 }
  }

  async end(reason = "Game ended") {
    this.isActive = false
    if (this.countdownTimer) clearTimeout(this.countdownTimer)
    if (this.gameTimer) clearTimeout(this.gameTimer)
    await this.sendMessage(`🎮 ${reason}`)
  }
}