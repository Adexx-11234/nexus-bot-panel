import { BaseGame } from "./game-manager.js"

export default class TriviaGame extends BaseGame {
  constructor(sock, groupJid, hostJid, options = {}) {
    super(sock, groupJid, hostJid, options)
    this.name = "Trivia Quiz"
    this.category = options.category || 'mixed'
    this.difficulty = options.difficulty || 'medium'
    this.questions = options.questions || 10
    this.currentQuestion = 0
    this.currentQuestionData = null
    this.playerScores = new Map()
    this.questionTimer = null
    this.questionDuration = 30000 // 30 seconds
    this.answered = new Set()
    this.questionBank = this.initializeQuestions()
  }

  initializeQuestions() {
    return {
      science: [
        { question: "What is the chemical symbol for gold?", answer: "AU", options: ["AU", "GO", "GD", "AG"], difficulty: "easy" },
        { question: "What planet is known as the Red Planet?", answer: "MARS", options: ["VENUS", "MARS", "JUPITER", "SATURN"], difficulty: "easy" },
        { question: "What is the speed of light in vacuum?", answer: "299792458", options: ["299792458", "300000000", "299800000", "299700000"], difficulty: "hard" },
        { question: "What is the most abundant gas in Earth's atmosphere?", answer: "NITROGEN", options: ["OXYGEN", "NITROGEN", "CARBON DIOXIDE", "ARGON"], difficulty: "medium" },
      ],
      history: [
        { question: "In which year did World War II end?", answer: "1945", options: ["1944", "1945", "1946", "1947"], difficulty: "easy" },
        { question: "Who was the first President of the United States?", answer: "GEORGE WASHINGTON", options: ["GEORGE WASHINGTON", "JOHN ADAMS", "THOMAS JEFFERSON", "BENJAMIN FRANKLIN"], difficulty: "easy" },
        { question: "Which ancient wonder was located in Alexandria?", answer: "LIGHTHOUSE", options: ["LIGHTHOUSE", "PYRAMID", "STATUE", "TEMPLE"], difficulty: "medium" },
        { question: "What year did the Berlin Wall fall?", answer: "1989", options: ["1987", "1988", "1989", "1990"], difficulty: "medium" },
      ],
      geography: [
        { question: "What is the capital of Australia?", answer: "CANBERRA", options: ["SYDNEY", "MELBOURNE", "CANBERRA", "PERTH"], difficulty: "medium" },
        { question: "Which is the longest river in the world?", answer: "NILE", options: ["AMAZON", "NILE", "MISSISSIPPI", "YANGTZE"], difficulty: "easy" },
        { question: "What is the smallest country in the world?", answer: "VATICAN CITY", options: ["MONACO", "VATICAN CITY", "SAN MARINO", "LIECHTENSTEIN"], difficulty: "medium" },
        { question: "Which mountain range contains Mount Everest?", answer: "HIMALAYAS", options: ["HIMALAYAS", "ANDES", "ROCKIES", "ALPS"], difficulty: "easy" },
      ],
      entertainment: [
        { question: "Who directed the movie 'Titanic'?", answer: "JAMES CAMERON", options: ["JAMES CAMERON", "STEVEN SPIELBERG", "CHRISTOPHER NOLAN", "MARTIN SCORSESE"], difficulty: "medium" },
        { question: "Which band released 'Bohemian Rhapsody'?", answer: "QUEEN", options: ["THE BEATLES", "QUEEN", "LED ZEPPELIN", "PINK FLOYD"], difficulty: "easy" },
        { question: "What is the highest-grossing film of all time?", answer: "AVATAR", options: ["TITANIC", "AVENGERS ENDGAME", "AVATAR", "STAR WARS"], difficulty: "medium" },
        { question: "Who wrote 'Romeo and Juliet'?", answer: "SHAKESPEARE", options: ["SHAKESPEARE", "DICKENS", "HEMINGWAY", "TOLKIEN"], difficulty: "easy" },
      ]
    }
  }

  async start() {
    this.isActive = true
    
    const categoryText = this.category === 'mixed' ? 'Mixed Categories' : this.category.toUpperCase()
    
    await this.sendMessage(
      `🧠 *TRIVIA QUIZ STARTED!* 🧠\n\n` +
      `📚 Category: ${categoryText}\n` +
      `📊 Difficulty: ${this.difficulty.toUpperCase()}\n` +
      `❓ Questions: ${this.questions}\n` +
      `⏱️ 30 seconds per question\n` +
      `👥 Host: @${this.hostJid.split('@')[0]}\n\n` +
      `Type 'join' to participate!\n` +
      `Quiz starts in 20 seconds...`
    )

    setTimeout(() => {
      if (this.isActive) {
        this.nextQuestion()
      }
    }, 20000)

    return { success: true }
  }

  async nextQuestion() {
    if (this.currentQuestion >= this.questions) {
      return await this.endGame()
    }

    this.currentQuestion++
    this.answered.clear()
    this.generateQuestion()

    await this.sendMessage(
      `❓ *Question ${this.currentQuestion}/${this.questions}* ❓\n\n` +
      `${this.currentQuestionData.question}\n\n` +
      `🔤 *Options:*\n` +
      `A) ${this.currentQuestionData.options[0]}\n` +
      `B) ${this.currentQuestionData.options[1]}\n` +
      `C) ${this.currentQuestionData.options[2]}\n` +
      `D) ${this.currentQuestionData.options[3]}\n\n` +
      `⏰ Answer with A, B, C, or D - 30 seconds!`
    )

    this.questionTimer = setTimeout(() => {
      if (this.isActive) {
        this.revealAnswer()
      }
    }, this.questionDuration)
  }

  generateQuestion() {
    let availableQuestions = []
    
    if (this.category === 'mixed') {
      // Mix all categories
      Object.values(this.questionBank).forEach(categoryQuestions => {
        availableQuestions.push(...categoryQuestions)
      })
    } else {
      availableQuestions = this.questionBank[this.category] || this.questionBank.science
    }

    // Filter by difficulty if not mixed
    if (this.difficulty !== 'mixed') {
      availableQuestions = availableQuestions.filter(q => q.difficulty === this.difficulty)
    }

    // Select random question
    const randomIndex = Math.floor(Math.random() * availableQuestions.length)
    this.currentQuestionData = availableQuestions[randomIndex]
  }

  async processMessage(userJid, message) {
    if (!this.isActive) return null

    this.updateActivity()
    const input = message.toUpperCase().trim()

    if (input === 'JOIN') {
      return await this.handleJoin(userJid)
    }

    if (this.currentQuestionData && this.isPlayer(userJid) && !this.answered.has(userJid)) {
      if (['A', 'B', 'C', 'D'].includes(input)) {
        return await this.handleAnswer(userJid, input)
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
      await this.sendMessage(`🧠 @${userJid.split('@')[0]} joined the quiz! (${this.players.size} players)`)
    }
    return joinResult
  }

  async handleAnswer(userJid, answer) {
    this.answered.add(userJid)
    
    const optionIndex = ['A', 'B', 'C', 'D'].indexOf(answer)
    const selectedAnswer = this.currentQuestionData.options[optionIndex]
    const isCorrect = selectedAnswer.toUpperCase() === this.currentQuestionData.answer.toUpperCase()

    if (isCorrect) {
      // Award points based on difficulty and speed
      let points = 10
      switch (this.currentQuestionData.difficulty) {
        case 'easy': points = 10; break
        case 'medium': points = 15; break
        case 'hard': points = 25; break
      }

      const currentScore = this.playerScores.get(userJid) || 0
      this.playerScores.set(userJid, currentScore + points)
      
      await this.sendMessage(`✅ @${userJid.split('@')[0]} got it right! (+${points} points)`)
      
      // If everyone answered, move to next question faster
      if (this.answered.size === this.players.size) {
        clearTimeout(this.questionTimer)
        setTimeout(() => this.revealAnswer(), 2000)
      }
    }

    return { success: true }
  }

  async revealAnswer() {
    const correctOption = this.currentQuestionData.options.findIndex(
      opt => opt.toUpperCase() === this.currentQuestionData.answer.toUpperCase()
    )
    const correctLetter = ['A', 'B', 'C', 'D'][correctOption]

    await this.sendMessage(
      `📝 *Answer Revealed!* 📝\n\n` +
      `✅ Correct Answer: ${correctLetter}) ${this.currentQuestionData.answer}\n\n` +
      `${this.getScoreBoard()}\n\n` +
      `Next question in 5 seconds...`
    )

    setTimeout(() => {
      if (this.isActive) {
        this.nextQuestion()
      }
    }, 5000)
  }

  getScoreBoard() {
    const scores = Array.from(this.playerScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5) // Top 5
      .map((entry, index) => {
        const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][index]
        return `${medal} @${entry[0].split('@')[0]}: ${entry[1]} points`
      })
      .join('\n')

    return `🏆 *CURRENT STANDINGS*\n${scores}`
  }

  async endGame() {
    const winner = this.getWinner()
    const finalScoreboard = this.getFinalScoreBoard()

    await this.sendMentionMessage(
      `🧠 *TRIVIA QUIZ COMPLETED!* 🧠\n\n` +
      `🏆 Quiz Master: @${winner.jid.split('@')[0]} with ${winner.score} points!\n\n` +
      `${finalScoreboard}\n\n` +
      `Thanks for playing! Knowledge is power! 📚✨`,
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

  getFinalScoreBoard() {
    const scores = Array.from(this.playerScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map((entry, index) => {
        const medal = ['🥇', '🥈', '🥉'][index] || '🏆'
        return `${medal} @${entry[0].split('@')[0]}: ${entry[1]} points`
      })
      .join('\n')

    return `🏆 *FINAL RESULTS*\n${scores}`
  }

  async end(reason = "Game ended") {
    this.isActive = false
    if (this.questionTimer) clearTimeout(this.questionTimer)
    await this.sendMessage(`🎮 ${reason}`)
  }
}