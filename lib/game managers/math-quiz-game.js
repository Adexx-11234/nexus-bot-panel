import { BaseGame } from "./game-manager.js"

export default class MathQuizGame extends BaseGame {
  constructor(sock, groupJid, hostJid, options = {}) {
    super(sock, groupJid, hostJid, options)
    this.name = "Math Quiz"
    this.difficulty = options.difficulty || 'medium'
    this.currentQuestion = null
    this.correctAnswer = null
    this.playerScores = new Map()
    this.questionNumber = 0
    this.maxQuestions = options.questions || 10
    this.questionTimeout = 30000 // 30 seconds
    this.questionTimer = null
  }

  async start() {
    this.isActive = true
    
    await this.sendMessage(
      `🧮 *MATH QUIZ GAME STARTED!*\n\n` +
      `📊 Difficulty: ${this.difficulty.toUpperCase()}\n` +
      `❓ Questions: ${this.maxQuestions}\n` +
      `⏱️ 30 seconds per question\n` +
      `👥 Host: @${this.hostJid.split('@')[0]}\n\n` +
      `Type 'join' to participate!\n` +
      `Starting first question in 15 seconds...`
    )

    setTimeout(() => {
      if (this.isActive) {
        this.nextQuestion()
      }
    }, 15000)

    return { success: true }
  }

  async nextQuestion() {
    if (this.questionNumber >= this.maxQuestions) {
      return await this.endGame()
    }

    this.questionNumber++
    this.generateQuestion()

    await this.sendMessage(
      `❓ *Question ${this.questionNumber}/${this.maxQuestions}*\n\n` +
      `${this.currentQuestion}\n\n` +
      `⏱️ 30 seconds to answer!`
    )

    this.questionTimer = setTimeout(() => {
      if (this.isActive) {
        this.handleTimeout()
      }
    }, this.questionTimeout)
  }

  generateQuestion() {
    const operations = ['+', '-', '×', '÷']
    const op = operations[Math.floor(Math.random() * operations.length)]
    
    let num1, num2, answer
    
    switch (this.difficulty) {
      case 'easy':
        num1 = Math.floor(Math.random() * 20) + 1
        num2 = Math.floor(Math.random() * 20) + 1
        break
      case 'medium':
        num1 = Math.floor(Math.random() * 50) + 1
        num2 = Math.floor(Math.random() * 50) + 1
        break
      case 'hard':
        num1 = Math.floor(Math.random() * 100) + 1
        num2 = Math.floor(Math.random() * 100) + 1
        break
    }

    switch (op) {
      case '+':
        answer = num1 + num2
        break
      case '-':
        answer = num1 - num2
        break
      case '×':
        answer = num1 * num2
        break
      case '÷':
        // Ensure clean division
        answer = Math.floor(Math.random() * 20) + 1
        num1 = answer * num2
        break
    }

    this.currentQuestion = `${num1} ${op} ${num2} = ?`
    this.correctAnswer = answer
  }

  async processMessage(userJid, message) {
    if (!this.isActive) return null
    
    this.updateActivity()

    if (message.toLowerCase() === 'join') {
      return await this.handleJoin(userJid)
    }

    if (this.currentQuestion) {
      const answer = parseInt(message.trim())
      if (!isNaN(answer)) {
        return await this.handleAnswer(userJid, answer)
      }
    }

    return null
  }

  async handleJoin(userJid) {
    if (this.isPlayer(userJid)) {
      return { success: false, message: "You're already in the quiz!" }
    }

    const joinResult = this.joinPlayer(userJid)
    if (joinResult.success) {
      this.playerScores.set(userJid, 0)
      await this.sendMessage(`🧮 @${userJid.split('@')[0]} joined the quiz! (${this.players.size} players)`)
    }
    return joinResult
  }

  async handleAnswer(userJid, answer) {
    if (!this.isPlayer(userJid)) {
      const joinResult = this.joinPlayer(userJid)
      if (joinResult.success) {
        this.playerScores.set(userJid, 0)
      }
    }

    if (answer === this.correctAnswer) {
      // Clear timeout
      if (this.questionTimer) {
        clearTimeout(this.questionTimer)
        this.questionTimer = null
      }

      // Award points based on speed and difficulty
      let points = 10
      switch (this.difficulty) {
        case 'medium': points = 15; break
        case 'hard': points = 20; break
      }

      const currentScore = this.playerScores.get(userJid) || 0
      this.playerScores.set(userJid, currentScore + points)

      await this.sendMessage(
        `✅ Correct! @${userJid.split('@')[0]} (+${points} points)\n\n` +
        `${this.currentQuestion.replace('?', this.correctAnswer)}\n\n` +
        `Next question in 3 seconds...`
      )

      this.currentQuestion = null
      setTimeout(() => {
        if (this.isActive) {
          this.nextQuestion()
        }
      }, 3000)

      return { success: true }
    }

    return { success: false, message: "Try again!" }
  }

  async handleTimeout() {
    await this.sendMessage(
      `⏰ Time's up!\n\n` +
      `The answer was: ${this.correctAnswer}\n` +
      `${this.currentQuestion.replace('?', this.correctAnswer)}\n\n` +
      `Next question in 3 seconds...`
    )

    this.currentQuestion = null
    setTimeout(() => {
      if (this.isActive) {
        this.nextQuestion()
      }
    }, 3000)
  }

  async endGame() {
    const winner = this.getWinner()
    const scoreboard = this.getScoreBoard()

    await this.sendMentionMessage(
      `🧮 *MATH QUIZ COMPLETED!*\n\n` +
      `🏆 Winner: @${winner.jid.split('@')[0]} with ${winner.score} points!\n\n` +
      `${scoreboard}\n\n` +
      `Thanks for playing! 🎉`,
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

  getScoreBoard() {
    const scores = Array.from(this.playerScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map((entry, index) => {
        const medal = ['🥇', '🥈', '🥉'][index] || '🏆'
        return `${medal} @${entry[0].split('@')[0]}: ${entry[1]} points`
      })
      .join('\n')

    return `🏆 *FINAL SCORES*\n${scores}`
  }
}