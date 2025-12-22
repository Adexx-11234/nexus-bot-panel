import { BaseGame } from "./game-manager.js"

export default class NumberGuessingGame extends BaseGame {
  constructor(sock, groupJid, hostJid, options = {}) {
    super(sock, groupJid, hostJid, options)
    this.name = "Number Guessing"
    this.minNumber = options.min || 1
    this.maxNumber = options.max || 100
    this.secretNumber = null
    this.attempts = new Map() // userJid -> attempt count
    this.maxAttempts = options.maxAttempts || 5
    this.hints = []
    this.gameStarted = false
  }

  async start() {
    this.isActive = true
    this.secretNumber = Math.floor(Math.random() * (this.maxNumber - this.minNumber + 1)) + this.minNumber
    this.generateHints()

    await this.sendMessage(
      `🔢 *NUMBER GUESSING GAME STARTED!*\n\n` +
      `🎯 I'm thinking of a number between ${this.minNumber} and ${this.maxNumber}\n` +
      `👥 Host: @${this.hostJid.split('@')[0]}\n` +
      `🔢 Each player gets ${this.maxAttempts} attempts\n\n` +
      `Type 'join' to participate!\n` +
      `Game starts in 20 seconds...`
    )

    setTimeout(() => {
      if (this.isActive) {
        this.startGame()
      }
    }, 20000)

    return { success: true }
  }

  generateHints() {
    this.hints = []
    
    // Odd/Even hint
    this.hints.push(this.secretNumber % 2 === 0 ? "The number is even" : "The number is odd")
    
    // Divisibility hints
    if (this.secretNumber % 5 === 0) this.hints.push("The number is divisible by 5")
    if (this.secretNumber % 3 === 0) this.hints.push("The number is divisible by 3")
    
    // Range hints
    const mid = Math.floor((this.minNumber + this.maxNumber) / 2)
    if (this.secretNumber > mid) {
      this.hints.push(`The number is greater than ${mid}`)
    } else {
      this.hints.push(`The number is less than or equal to ${mid}`)
    }
    
    // Digit sum hint
    const digitSum = this.secretNumber.toString().split('').reduce((sum, digit) => sum + parseInt(digit), 0)
    this.hints.push(`The sum of its digits is ${digitSum}`)
  }

  async startGame() {
    if (this.players.size < 1) {
      await this.sendMessage("No players joined! Game cancelled.")
      return this.end()
    }

    this.gameStarted = true
    
    // Give first hint
    await this.sendMessage(
      `🎮 *GAME STARTED!*\n\n` +
      `💡 Hint: ${this.hints[0]}\n\n` +
      `Players: ${this.getPlayersList()}\n\n` +
      `Type your guess (${this.minNumber}-${this.maxNumber})!`
    )
  }

  async processMessage(userJid, message) {
    if (!this.isActive) return null

    if (!this.gameStarted && message.toLowerCase() === 'join') {
      return await this.handleJoin(userJid)
    }

    if (this.gameStarted && this.isPlayer(userJid)) {
      const guess = parseInt(message.trim())
      if (!isNaN(guess)) {
        return await this.handleGuess(userJid, guess)
      }
    }

    return null
  }

  async handleJoin(userJid) {
    if (this.isPlayer(userJid)) {
      return { success: false, message: "You're already in the game!" }
    }

    const joinResult = this.joinPlayer(userJid)
    if (joinResult.success) {
      this.attempts.set(userJid, 0)
      await this.sendMessage(`🎮 @${userJid.split('@')[0]} joined! (${this.players.size} players)`)
    }
    return joinResult
  }

  async handleGuess(userJid, guess) {
    this.updateActivity()
    
    if (guess < this.minNumber || guess > this.maxNumber) {
      return { success: false, message: `Guess must be between ${this.minNumber} and ${this.maxNumber}!` }
    }

    const currentAttempts = this.attempts.get(userJid) || 0
    
    if (currentAttempts >= this.maxAttempts) {
      return { success: false, message: "You've used all your attempts!" }
    }

    this.attempts.set(userJid, currentAttempts + 1)

    if (guess === this.secretNumber) {
      return await this.handleCorrectGuess(userJid, currentAttempts + 1)
    } else {
      return await this.handleIncorrectGuess(userJid, guess, currentAttempts + 1)
    }
  }

  async handleCorrectGuess(userJid, attemptsUsed) {
    const score = Math.max(100 - (attemptsUsed - 1) * 20, 20)
    
    await this.sendMentionMessage(
      `🎉 *CORRECT!*\n\n` +
      `🏆 Winner: @${userJid.split('@')[0]}\n` +
      `🔢 The number was: ${this.secretNumber}\n` +
      `🎯 Attempts used: ${attemptsUsed}/${this.maxAttempts}\n` +
      `⭐ Score: ${score} points\n\n` +
      `Congratulations! 🎊`,
      [userJid]
    )

    this.isActive = false
    return { success: true }
  }

  async handleIncorrectGuess(userJid, guess, attemptsUsed) {
    let response = `❌ @${userJid.split('@')[0]}: ${guess} is `
    
    if (guess < this.secretNumber) {
      response += "too low!"
    } else {
      response += "too high!"
    }
    
    response += `\n🎯 Attempts: ${attemptsUsed}/${this.maxAttempts}`

    // Give hints based on attempts
    if (attemptsUsed === 2 && this.hints.length > 1) {
      response += `\n💡 Hint: ${this.hints[1]}`
    } else if (attemptsUsed === 4 && this.hints.length > 2) {
      response += `\n💡 Hint: ${this.hints[2]}`
    }

    if (attemptsUsed >= this.maxAttempts) {
      response += "\n😢 You've used all your attempts!"
      
      // Check if all players are out of attempts
      const playersLeft = Array.from(this.players).filter(jid => 
        (this.attempts.get(jid) || 0) < this.maxAttempts
      )
      
      if (playersLeft.length === 0) {
        await this.sendMessage(response)
        return await this.handleGameOver()
      }
    }

    await this.sendMessage(response)
    return { success: true }
  }

  async handleGameOver() {
    await this.sendMentionMessage(
      `😭 *GAME OVER!*\n\n` +
      `🔢 The number was: ${this.secretNumber}\n` +
      `😢 Nobody guessed it correctly!\n\n` +
      `Better luck next time! 🍀`,
      Array.from(this.players)
    )

    this.isActive = false
    return { success: true }
  }
}