import { BaseGame } from "./game-manager.js"

export default class TicTacToeGame extends BaseGame {
  constructor(sock, groupJid, hostJid, options = {}) {
    super(sock, groupJid, hostJid, options)
    this.name = "TicTacToe"
    this.maxPlayers = 2
    this.minPlayers = options.vsBot ? 1 : 2
    this.board = Array(9).fill(null) // 0-8 positions
    this.currentPlayer = null
    this.playerX = null
    this.playerO = null
    this.gameStarted = false
    this.vsBot = options.vsBot || false
    this.botDifficulty = options.botDifficulty || 'medium' // easy, medium, hard
    this.botThinking = false
    this.lastMoveMessageId = null // Store the message ID to edit
  }

  async start() {
    this.isActive = true
    this.playerX = this.hostJid
    
    if (this.vsBot) {
      this.playerO = 'bot'
      this.currentPlayer = this.playerX
      this.gameStarted = true
      
      await this.sendMessage(
        `⭕ *TICTACTOE VS BOT STARTED!* ❌\n\n` +
        `🎮 Player: @${this.hostJid.split('@')[0]} (❌)\n` +
        `🤖 Opponent: PaulBot (⭕) - ${this.botDifficulty.toUpperCase()} difficulty\n\n` +
        `${this.displayBoard()}\n\n` +
        `Your turn! Type 1-9 to make your move!`
      )
    } else {
      await this.sendMessage(
        `⭕ *TICTACTOE GAME STARTED!* ❌\n\n` +
        `🎮 Host: @${this.hostJid.split('@')[0]} (❌)\n` +
        `👥 Waiting for opponent to join...\n\n` +
        `Type 'join' to play as ⭕!`
      )
    }

    return { success: true }
  }

  async processMessage(userJid, message) {
    if (!this.isActive) return null

    this.updateActivity()
    const input = message.toLowerCase().trim()

    // Handle joining (only for human vs human)
    if (input === 'join' && !this.vsBot && !this.gameStarted) {
      return await this.handleJoin(userJid)
    }

    // Handle moves (1-9)
    if (this.gameStarted && this.isCurrentPlayer(userJid)) {
      const move = parseInt(input)
      if (move >= 1 && move <= 9) {
        return await this.handleMove(userJid, move - 1)
      }
    }

    return null
  }

  async handleJoin(userJid) {
    if (userJid === this.hostJid) {
      return { success: false, message: "You're the host! Waiting for an opponent." }
    }

    if (this.players.has(userJid)) {
      return { success: false, message: "You're already in the game!" }
    }

    if (this.players.size >= 2) {
      return { success: false, message: "Game is full!" }
    }

    this.joinPlayer(userJid)
    this.playerO = userJid
    this.currentPlayer = this.playerX // X goes first
    this.gameStarted = true

    await this.sendMessage(
      `🎮 Game Ready!\n\n` +
      `❌ Player X: @${this.playerX.split('@')[0]}\n` +
      `⭕ Player O: @${this.playerO.split('@')[0]}\n\n` +
      `@${this.currentPlayer.split('@')[0]}'s turn!\n\n` +
      `${this.displayBoard()}\n\n` +
      `Type 1-9 to make your move!`
    )

    return { success: true }
  }

  isCurrentPlayer(userJid) {
    return userJid === this.currentPlayer
  }

  async handleMove(userJid, position) {
    if (this.board[position] !== null) {
      return { success: false, message: "That position is already taken!" }
    }

    // Make the move
    const symbol = userJid === this.playerX ? '❌' : '⭕'
    this.board[position] = symbol

    // Check for win
    const winner = this.checkWinner()
    if (winner) {
      return await this.handleWin(userJid, symbol)
    }

    // Check for draw
    if (this.board.every(cell => cell !== null)) {
      return await this.handleDraw()
    }

    // Switch turns
    this.currentPlayer = this.currentPlayer === this.playerX ? this.playerO : this.playerX

    // Send message with "Bot is thinking..." if it's bot's turn
    const messageText = `${symbol} @${userJid.split('@')[0]} played position ${position + 1}\n\n` +
      `${this.displayBoard()}\n\n` +
      `${this.vsBot && this.currentPlayer === 'bot' ? "🤖 Bot is thinking..." : `@${this.currentPlayer.split('@')[0]}'s turn!`}`

    const messageResult = await this.sendMessage(messageText)
    
    // Store the message ID if we need to edit it later
    if (this.vsBot && this.currentPlayer === 'bot') {
      this.lastMoveMessageId = messageResult?.messageId || messageResult?.id
      setTimeout(() => this.makeBotMove(), 2000) // 2 second delay for realism
    }

    return { success: true }
  }

  async makeBotMove() {
    if (!this.isActive || this.botThinking) return
    
    this.botThinking = true
    const botMove = this.getBotMove()
    
    if (botMove !== -1) {
      this.board[botMove] = '⭕'
      
      // Check for win
      const winner = this.checkWinner()
      if (winner) {
        await this.handleWin('bot', '⭕')
        this.botThinking = false
        return
      }

      // Check for draw
      if (this.board.every(cell => cell !== null)) {
        await this.handleDraw()
        this.botThinking = false
        return
      }

      // Switch back to player
      this.currentPlayer = this.playerX

      // Edit the previous message instead of sending a new one
      const updatedMessageText = `⭕ Bot played position ${botMove + 1}\n\n` +
        `${this.displayBoard()}\n\n` +
        `@${this.playerX.split('@')[0]}'s turn!`

      if (this.lastMoveMessageId && this.editMessage) {
        // Edit the message if editing is supported
        await this.editMessage(this.lastMoveMessageId, updatedMessageText)
      } else {
        // Fallback to sending new message if editing not supported
        await this.sendMessage(updatedMessageText)
      }
    }
    
    this.botThinking = false
  }

  getBotMove() {
    const availableMoves = this.board
      .map((cell, index) => cell === null ? index : null)
      .filter(index => index !== null)

    if (availableMoves.length === 0) return -1

    switch (this.botDifficulty) {
      case 'easy':
        // Random move
        return availableMoves[Math.floor(Math.random() * availableMoves.length)]
      
      case 'medium':
        // Try to win, block player, or random
        return this.getMediumBotMove(availableMoves)
      
      case 'hard':
        // Use minimax algorithm
        return this.getHardBotMove()
      
      default:
        return availableMoves[0]
    }
  }

  getMediumBotMove(availableMoves) {
    // 1. Try to win
    for (const move of availableMoves) {
      this.board[move] = '⭕'
      if (this.checkWinner() === '⭕') {
        this.board[move] = null
        return move
      }
      this.board[move] = null
    }

    // 2. Block player from winning
    for (const move of availableMoves) {
      this.board[move] = '❌'
      if (this.checkWinner() === '❌') {
        this.board[move] = null
        return move
      }
      this.board[move] = null
    }

    // 3. Take center if available
    if (availableMoves.includes(4)) return 4

    // 4. Take corners
    const corners = [0, 2, 6, 8].filter(pos => availableMoves.includes(pos))
    if (corners.length > 0) {
      return corners[Math.floor(Math.random() * corners.length)]
    }

    // 5. Random move
    return availableMoves[Math.floor(Math.random() * availableMoves.length)]
  }

  getHardBotMove() {
    // Minimax algorithm for perfect play
    let bestMove = -1
    let bestScore = -Infinity

    for (let i = 0; i < 9; i++) {
      if (this.board[i] === null) {
        this.board[i] = '⭕'
        const score = this.minimax(this.board, 0, false)
        this.board[i] = null
        
        if (score > bestScore) {
          bestScore = score
          bestMove = i
        }
      }
    }

    return bestMove
  }

  minimax(board, depth, isMaximizing) {
    const winner = this.checkWinner()
    
    if (winner === '⭕') return 1
    if (winner === '❌') return -1
    if (board.every(cell => cell !== null)) return 0

    if (isMaximizing) {
      let bestScore = -Infinity
      for (let i = 0; i < 9; i++) {
        if (board[i] === null) {
          board[i] = '⭕'
          const score = this.minimax(board, depth + 1, false)
          board[i] = null
          bestScore = Math.max(score, bestScore)
        }
      }
      return bestScore
    } else {
      let bestScore = Infinity
      for (let i = 0; i < 9; i++) {
        if (board[i] === null) {
          board[i] = '❌'
          const score = this.minimax(board, depth + 1, true)
          board[i] = null
          bestScore = Math.min(score, bestScore)
        }
      }
      return bestScore
    }
  }

  displayBoard() {
    const board = this.board.map((cell, index) => {
      return cell || `${index + 1}️⃣`
    })

    return `
╔═══╦═══╦═══╗
║ ${board[0]} ║ ${board[1]} ║ ${board[2]} ║
╠═══╬═══╬═══╣
║ ${board[3]} ║ ${board[4]} ║ ${board[5]} ║
╠═══╬═══╬═══╣
║ ${board[6]} ║ ${board[7]} ║ ${board[8]} ║
╚═══╩═══╩═══╝`
  }

  checkWinner() {
    const winPatterns = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
      [0, 4, 8], [2, 4, 6] // diagonals
    ]

    for (const pattern of winPatterns) {
      const [a, b, c] = pattern
      if (this.board[a] && this.board[a] === this.board[b] && this.board[a] === this.board[c]) {
        return this.board[a]
      }
    }

    return null
  }

  async handleWin(winnerJid, symbol) {
    const winnerName = winnerJid === 'bot' ? 'PaulBot' : `@${winnerJid.split('@')[0]}`
    const mentions = winnerJid === 'bot' ? [] : [winnerJid]
    
    if (!this.vsBot && this.currentPlayer !== winnerJid) {
      mentions.push(this.currentPlayer)
    }

    await this.sendMentionMessage(
      `🎉 *GAME OVER!*\n\n` +
      `🏆 Winner: ${winnerName} (${symbol})\n\n` +
      `${this.displayBoard()}\n\n` +
      `${winnerJid === 'bot' ? 'Better luck next time! 🤖' : 'Congratulations! 🎉'}`,
      mentions
    )

    this.isActive = false
    return { success: true }
  }

  async handleDraw() {
    const mentions = this.vsBot ? [this.playerX] : Array.from(this.players)
    
    await this.sendMentionMessage(
      `🤝 *GAME OVER - IT'S A DRAW!*\n\n` +
      `${this.displayBoard()}\n\n` +
      `${this.vsBot ? 'Great game against the bot!' : 'Good game!'} 👏`,
      mentions
    )

    this.isActive = false
    return { success: true }
  }
}