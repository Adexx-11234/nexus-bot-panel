import { BaseGame } from "./game-manager.js"

export default class RockPaperScissorsGame extends BaseGame {
  constructor(sock, groupJid, hostJid, options = {}) {
    super(sock, groupJid, hostJid, options)
    this.name = "Rock Paper Scissors Tournament"
    this.rounds = options.rounds || 5
    this.currentRound = 1
    this.playerChoices = new Map()
    this.playerScores = new Map()
    this.roundTimer = null
    this.roundDuration = 15000 // 15 seconds per round
    this.gamePhase = 'waiting' // waiting, playing, results
  }

  async start() {
    this.isActive = true
    
    await this.sendMessage(
      `✂️ *ROCK PAPER SCISSORS TOURNAMENT!* 🪨\n\n` +
      `🏆 Tournament Rounds: ${this.rounds}\n` +
      `⏱️ 15 seconds per round\n` +
      `👥 Host: @${this.hostJid.split('@')[0]}\n\n` +
      `📜 *Rules:*\n` +
      `🪨 Rock beats Scissors\n` +
      `📄 Paper beats Rock\n` +
      `✂️ Scissors beats Paper\n\n` +
      `Type 'join' to participate!\n` +
      `Tournament starts in 20 seconds...`
    )

    setTimeout(() => {
      if (this.isActive) {
        this.startRound()
      }
    }, 20000)

    return { success: true }
  }

  async startRound() {
    if (this.players.size < 2) {
      await this.sendMessage(`❌ Need at least 2 players for tournament!`)
      return this.end()
    }

    this.gamePhase = 'playing'
    this.playerChoices.clear()

    await this.sendMessage(
      `🔥 *ROUND ${this.currentRound}/${this.rounds}* 🔥\n\n` +
      `Players: ${this.getPlayersList()}\n\n` +
      `Choose your weapon:\n` +
      `🪨 Type: rock or r\n` +
      `📄 Type: paper or p\n` +
      `✂️ Type: scissors or s\n\n` +
      `⏰ You have 15 seconds!`
    )

    this.roundTimer = setTimeout(() => {
      if (this.isActive) {
        this.processRound()
      }
    }, this.roundDuration)
  }

  async processMessage(userJid, message) {
    if (!this.isActive) return null

    this.updateActivity()
    const input = message.toLowerCase().trim()

    if (this.gamePhase === 'waiting' && input === 'join') {
      return await this.handleJoin(userJid)
    }

    if (this.gamePhase === 'playing' && this.isPlayer(userJid)) {
      return await this.handleChoice(userJid, input)
    }

    return null
  }

  async handleJoin(userJid) {
    if (this.isPlayer(userJid)) {
      return { success: false, message: "You're already in the tournament!" }
    }

    const joinResult = this.joinPlayer(userJid)
    if (joinResult.success) {
      this.playerScores.set(userJid, 0)
      await this.sendMessage(`🥊 @${userJid.split('@')[0]} joined the tournament! (${this.players.size} players)`)
    }
    return joinResult
  }

  async handleChoice(userJid, input) {
    if (this.playerChoices.has(userJid)) {
      return { success: false, message: "You already made your choice!" }
    }

    let choice = null
    if (input === 'rock' || input === 'r') choice = 'rock'
    else if (input === 'paper' || input === 'p') choice = 'paper'
    else if (input === 'scissors' || input === 's') choice = 'scissors'

    if (!choice) {
      return { success: false, message: "Invalid choice! Use: rock/r, paper/p, scissors/s" }
    }

    this.playerChoices.set(userJid, choice)
    
    // Check if all players made choices
    if (this.playerChoices.size === this.players.size) {
      clearTimeout(this.roundTimer)
      this.processRound()
    }

    return { success: true, message: "Choice recorded! ✅" }
  }

  async processRound() {
    this.gamePhase = 'results'

    // Get results
    const results = this.calculateRoundResults()
    const winners = results.winners
    
    // Award points
    winners.forEach(jid => {
      const currentScore = this.playerScores.get(jid) || 0
      this.playerScores.set(jid, currentScore + 1)
    })

    // Display results
    let resultText = `📊 *ROUND ${this.currentRound} RESULTS* 📊\n\n`
    
    for (const [jid, choice] of this.playerChoices) {
      const emoji = this.getChoiceEmoji(choice)
      const status = winners.includes(jid) ? '🏆' : '❌'
      resultText += `${status} @${jid.split('@')[0]}: ${emoji} ${choice}\n`
    }

    if (winners.length === 0) {
      resultText += `\n🤝 It's a tie! Nobody wins this round.`
    } else if (winners.length === 1) {
      resultText += `\n🎉 Winner: @${winners[0].split('@')[0]}!`
    } else {
      resultText += `\n🎊 Multiple winners this round!`
    }

    resultText += `\n\n${this.getScoreBoard()}`

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
      }, 5000)
    }
  }

  calculateRoundResults() {
    const choices = Array.from(this.playerChoices.entries())
    const rockPlayers = choices.filter(([_, choice]) => choice === 'rock').map(([jid]) => jid)
    const paperPlayers = choices.filter(([_, choice]) => choice === 'paper').map(([jid]) => jid)
    const scissorsPlayers = choices.filter(([_, choice]) => choice === 'scissors').map(([jid]) => jid)

    const winners = []

    // Rock beats Scissors
    if (rockPlayers.length > 0 && scissorsPlayers.length > 0 && paperPlayers.length === 0) {
      winners.push(...rockPlayers)
    }
    // Paper beats Rock
    else if (paperPlayers.length > 0 && rockPlayers.length > 0 && scissorsPlayers.length === 0) {
      winners.push(...paperPlayers)
    }
    // Scissors beats Paper
    else if (scissorsPlayers.length > 0 && paperPlayers.length > 0 && rockPlayers.length === 0) {
      winners.push(...scissorsPlayers)
    }
    // No winners (tie or all same choice)

    return { winners }
  }

  getChoiceEmoji(choice) {
    switch (choice) {
      case 'rock': return '🪨'
      case 'paper': return '📄'
      case 'scissors': return '✂️'
      default: return '❓'
    }
  }

  getScoreBoard() {
    const scores = Array.from(this.playerScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map((entry, index) => {
        const medal = ['🥇', '🥈', '🥉'][index] || '🏆'
        return `${medal} @${entry[0].split('@')[0]}: ${entry[1]} points`
      })
      .join('\n')

    return `🏆 *TOURNAMENT STANDINGS*\n${scores}`
  }

  async endGame() {
    const winner = this.getWinner()
    
    await this.sendMentionMessage(
      `🏁 *TOURNAMENT FINISHED!* 🏁\n\n` +
      `🏆 Champion: @${winner.jid.split('@')[0]} with ${winner.score} wins!\n\n` +
      `${this.getScoreBoard()}\n\n` +
      `Thanks for the epic battles! ⚔️`,
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
}

