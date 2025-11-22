import { BaseGame } from "./game-manager.js"

export default class WordGuessingGame extends BaseGame {
  constructor(sock, groupJid, hostJid, options = {}) {
    super(sock, groupJid, hostJid, options)
    this.name = "Word Guessing"
    this.category = options.category || this.getRandomCategory()
    this.currentWord = null
    this.clue = null
    this.guessedLetters = new Set()
    this.playerScores = new Map()
    this.round = 1
    this.maxRounds = options.rounds || 5
    this.wordsList = this.initializeWordsList()
  }

  initializeWordsList() {
    return {
      animals: [
        { word: "ELEPHANT", clue: "Large mammal with a trunk" },
        { word: "PENGUIN", clue: "Black and white bird that can't fly" },
        { word: "GIRAFFE", clue: "Tallest animal in the world" },
        { word: "DOLPHIN", clue: "Smart marine mammal" },
        { word: "BUTTERFLY", clue: "Colorful insect with wings" }
      ],
      countries: [
        { word: "BRAZIL", clue: "South American country famous for football" },
        { word: "JAPAN", clue: "Island nation in East Asia" },
        { word: "EGYPT", clue: "Country with pyramids" },
        { word: "CANADA", clue: "Northern neighbor of USA" },
        { word: "AUSTRALIA", clue: "Island continent" }
      ],
      food: [
        { word: "PIZZA", clue: "Italian dish with cheese and toppings" },
        { word: "SUSHI", clue: "Japanese rice and fish dish" },
        { word: "CHOCOLATE", clue: "Sweet brown treat" },
        { word: "HAMBURGER", clue: "Meat patty in a bun" },
        { word: "ICECREAM", clue: "Frozen sweet dessert" }
      ],
      movies: [
        { word: "TITANIC", clue: "Movie about a sinking ship" },
        { word: "AVATAR", clue: "Blue aliens on Pandora" },
        { word: "FROZEN", clue: "Disney movie with Elsa" },
        { word: "SPIDERMAN", clue: "Web-slinging superhero" },
        { word: "BATMAN", clue: "Dark knight of Gotham" }
      ]
    }
  }

  getRandomCategory() {
    const categories = Object.keys(this.wordsList)
    return categories[Math.floor(Math.random() * categories.length)]
  }

  async start() {
    this.isActive = true
    this.newRound()

    await this.sendMessage(
      `🎮 *WORD GUESSING GAME STARTED!*\n\n` +
      `🎯 Category: ${this.category.toUpperCase()}\n` +
      `👥 Host: @${this.hostJid.split('@')[0]}\n` +
      `🔢 Round: ${this.round}/${this.maxRounds}\n\n` +
      `Type 'join' to participate!\n` +
      `Game starts in 30 seconds...`
    )

    // Wait for players to join
    setTimeout(() => {
      if (this.isActive) {
        this.startRound()
      }
    }, 30000)

    return { success: true }
  }

  newRound() {
    const words = this.wordsList[this.category]
    const randomWord = words[Math.floor(Math.random() * words.length)]
    this.currentWord = randomWord.word
    this.clue = randomWord.clue
    this.guessedLetters.clear()
  }

  async startRound() {
    if (this.players.size < this.minPlayers) {
      await this.sendMessage(`❌ Not enough players! Need at least ${this.minPlayers} players.`)
      return this.end()
    }

    const hiddenWord = this.getHiddenWord()
    
    await this.sendMessage(
      `🎯 *ROUND ${this.round}*\n\n` +
      `💡 Clue: ${this.clue}\n` +
      `📝 Word: ${hiddenWord}\n` +
      `🔤 Letters: ${this.currentWord.length} letters\n\n` +
      `Guess letters one by one or the full word!`
    )
  }

  getHiddenWord() {
    return this.currentWord
      .split('')
      .map(letter => this.guessedLetters.has(letter) ? letter : '•')
      .join(' ')
  }

  async processMessage(userJid, message) {
    if (!this.isActive || !this.isPlayer(userJid)) {
      if (message.toLowerCase() === 'join') {
        return this.handleJoin(userJid)
      }
      return null
    }

    this.updateActivity()
    const input = message.toUpperCase().trim()

    // Handle single letter guess
    if (input.length === 1 && /[A-Z]/.test(input)) {
      return await this.handleLetterGuess(userJid, input)
    }

    // Handle full word guess
    if (input.length > 1) {
      return await this.handleWordGuess(userJid, input)
    }

    return null
  }

  async handleJoin(userJid) {
    if (this.isPlayer(userJid)) {
      return { success: false, message: "You're already in the game!" }
    }

    const joinResult = this.joinPlayer(userJid)
    if (joinResult.success) {
      await this.sendMessage(`🎮 @${userJid.split('@')[0]} joined the game! (${this.players.size} players)`)
      this.playerScores.set(userJid, 0)
    }
    return joinResult
  }

  async handleLetterGuess(userJid, letter) {
    if (this.guessedLetters.has(letter)) {
      return { success: false, message: `Letter ${letter} already guessed!` }
    }

    this.guessedLetters.add(letter)

    if (this.currentWord.includes(letter)) {
      const score = this.currentWord.split('').filter(l => l === letter).length
      this.addScore(userJid, score)
      
      const hiddenWord = this.getHiddenWord()
      
      // Check if word is complete
      if (!hiddenWord.includes('•')) {
        return await this.handleWordComplete(userJid)
      }

      await this.sendMessage(
        `✅ Good guess @${userJid.split('@')[0]}! (+${score} points)\n\n` +
        `📝 ${hiddenWord}\n` +
        `🔤 Guessed: ${Array.from(this.guessedLetters).join(', ')}`
      )
    } else {
      await this.sendMessage(
        `❌ Letter '${letter}' not found!\n\n` +
        `📝 ${this.getHiddenWord()}\n` +
        `🔤 Guessed: ${Array.from(this.guessedLetters).join(', ')}`
      )
    }

    return { success: true }
  }

  async handleWordGuess(userJid, guess) {
    if (guess === this.currentWord) {
      const bonus = Math.max(10 - this.guessedLetters.size, 5)
      this.addScore(userJid, bonus)
      return await this.handleWordComplete(userJid)
    } else {
      await this.sendMessage(`❌ '${guess}' is not the word! Try again.`)
      return { success: true }
    }
  }

  async handleWordComplete(userJid) {
    await this.sendMessage(
      `🎉 Congratulations @${userJid.split('@')[0]}!\n` +
      `The word was: *${this.currentWord}*\n\n` +
      `${this.getScoreBoard()}`
    )

    this.round++
    if (this.round > this.maxRounds) {
      return await this.endGame()
    }

    // Start next round after delay
    setTimeout(() => {
      if (this.isActive) {
        this.newRound()
        this.startRound()
      }
    }, 5000)

    return { success: true }
  }

  addScore(userJid, points) {
    const currentScore = this.playerScores.get(userJid) || 0
    this.playerScores.set(userJid, currentScore + points)
  }

  getScoreBoard() {
    const scores = Array.from(this.playerScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map((entry, index) => {
        const medal = ['🥇', '🥈', '🥉'][index] || '🏆'
        return `${medal} @${entry[0].split('@')[0]}: ${entry[1]} points`
      })
      .join('\n')

    return `🏆 *SCOREBOARD*\n${scores}`
  }

  async endGame() {
    const winner = this.getWinner()
    
    await this.sendMentionMessage(
      `🎮 *WORD GUESSING GAME ENDED!*\n\n` +
      `🏆 Winner: @${winner.jid.split('@')[0]} with ${winner.score} points!\n\n` +
      `${this.getScoreBoard()}\n\n` +
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
}