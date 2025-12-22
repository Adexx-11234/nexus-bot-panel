# 📚 Library Module Documentation

Core utilities, AI integration, media processing, and game management.

---

## 📋 Table of Contents

- [Overview](#overview)
- [AI Integration](#ai-integration)
- [Media Converters](#media-converters)
- [Download Handlers](#download-handlers)
- [Game Managers](#game-managers)
- [Utility Functions](#utility-functions)

---

## 🎯 Overview

The `lib/` directory contains:

- **AI Services** - Multiple AI model integrations
- **Media Processing** - Convert, compress, extract media
- **Download Tools** - Support for 15+ platforms
- **Game Logic** - Interactive game managers
- **Helpers** - Shared utility functions

---

## 🤖 AI Integration

### **File:** `lib/ai/index.js`

Central hub for all AI API integrations with automatic fallback:

#### **Text AI Models**

\`\`\`javascript
// Gemini AI
const result = await geminiAI("What is AI?")
// Returns: { success: true, model: "Gemini AI", response: "...", timestamp: "..." }

// GPT-4o
const result = await gpt4oAI("Explain quantum computing")

// Claude AI
const result = await claudeAI("What is machine learning?")

// Copilot with Think Mode
const result = await copilotAI("Solve this problem: 2+2", useThink: true)

// Llama 3.3-70b
const result = await llamaAI("Tell me a joke")
\`\`\`

#### **Specialized AI**

\`\`\`javascript
// Bible AI
const result = await bibleAI("John 3:16", "NIV")

// Gita AI (Hindu philosophy)
const result = await gitaAI("What is dharma?")

// Muslim AI (Islamic knowledge)
const result = await muslimAI("What are the Five Pillars?")

// Felo AI (Search-based)
const result = await feloAI("Latest news about AI")
\`\`\`

#### **Image Generation**

\`\`\`javascript
// Flux AI
const result = await fluxAI("A sunset over mountains", {
  width: 1024,
  height: 1024,
  steps: 40
})

// Magic Studio AI
const result = await magicstudioAI("A futuristic city")

// Omega AI
const result = await omegaImageGen("Beautiful nature landscape", "1:1")
\`\`\`

**Error Handling:**
- Automatic API fallback
- Retry mechanism (3 attempts)
- Timeout protection (60 seconds)
- Graceful error responses

---

## 🎨 Media Converters

### **File:** `lib/converters/media-converter.js`

Handles media format conversions:

\`\`\`javascript
// Convert image to sticker
const sticker = await convertToSticker(imageBuffer)

// Convert video to audio
const audio = await convertToAudio(videoBuffer)

// Compress image
const compressed = await compressImage(imageBuffer, quality: 80)

// Extract frames
const frames = await extractFrames(videoBuffer, fps: 10)

// Convert to GIF
const gif = await convertToGIF(videoBuffer)
\`\`\`

**Supported Formats:**
- Images: PNG, JPG, WEBP, BMP
- Audio: MP3, OGG, M4A, WAV
- Video: MP4, MKV, AVI, MOV
- Stickers: WEBP (animated/static)

---

## 📥 Download Handlers

### **File:** `lib/downloaders/index.js`

Support for downloading from multiple platforms:

\`\`\`javascript
// YouTube
const video = await downloadYouTube(url, format: "mp4")

// Instagram
const media = await downloadInstagram(url)

// TikTok
const video = await downloadTikTok(url)

// Facebook
const video = await downloadFacebook(url)

// Spotify
const track = await downloadSpotify(url)

// Twitter/X
const media = await downloadTwitter(url)

// Pinterest
const image = await downloadPinterest(url)

// SoundCloud
const audio = await downloadSoundCloud(url)

// Capccut
const video = await downloadCapcut(url)

// Google Drive
const file = await downloadGoogleDrive(url)

// MediaFire
const file = await downloadMediaFire(url)

// Apple Music
const track = await downloadAppleMusic(url)
\`\`\`

**Process Flow:**
1. Validate URL
2. Extract metadata
3. Check format availability
4. Download stream
5. Convert if needed
6. Return buffer

---

## 🎮 Game Managers

### **File:** `lib/game managers/`

Interactive game implementations:

#### **Tic Tac Toe** (`tictactoe.js`)
\`\`\`javascript
const game = new TicTacToeGame(player1, player2)
game.makeMove(position)      // 0-8
game.getCurrentBoard()       // Visual board
game.checkWinner()           // Returns winner or null
\`\`\`

#### **Rock Paper Scissors** (`rock-paper-scissors.js`)
\`\`\`javascript
const game = new RockPaperScissorsGame(player)
game.playRound("rock")       // "rock", "paper", "scissors"
game.getScore()
game.endGame()
\`\`\`

#### **Trivia Quiz** (`TriviaGame.js`)
\`\`\`javascript
const quiz = new TriviaGame(players)
quiz.startGame()
quiz.submitAnswer(playerId, answer)
quiz.getLeaderboard()
\`\`\`

#### **Math Quiz** (`math-quiz-game.js`)
\`\`\`javascript
const mathGame = new MathQuizGame(players, difficulty: "hard")
mathGame.nextProblem()
mathGame.checkAnswer(playerId, answer)
\`\`\`

#### **Number Guessing** (`number-guessing-game.js`)
\`\`\`javascript
const guessing = new NumberGuessingGame(minNumber, maxNumber)
guessing.makeGuess(playerId, number)
guessing.getHint()
\`\`\`

#### **Word Guessing** (`word-guessing-game.js`)
\`\`\`javascript
const wordGame = new WordGuessingGame(words)
wordGame.guessLetter(playerId, letter)
wordGame.getWord()
\`\`\`

#### **Reaction Speed** (`ReactionSpeedGame.js`)
\`\`\`javascript
const reaction = new ReactionSpeedGame(players)
reaction.startChallenge()
reaction.recordReaction(playerId, reactionTime)
\`\`\`

#### **Game Manager** (`game-manager.js`)
\`\`\`javascript
// Central game management
const manager = new GameManager()
manager.createGame(gameType, players)
manager.getActiveGames()
manager.endGame(gameId)
manager.getGameState(gameId)
\`\`\`

---

## 🛠️ Utility Functions

### **File:** `lib/utils.ts`

Shared helper functions:

\`\`\`javascript
// Format bytes to readable size
formatBytes(1024)  // "1 KB"

// Validate URL
isValidUrl(url)    // true/false

// Parse command arguments
parseArgs(text)    // ["command", "arg1", "arg2"]

// Format time
formatTime(ms)     // "1h 23m 45s"

// Random selection
randomChoice(array)
\`\`\`

---

## 🔄 Data Flow

\`\`\`
User Input
    ↓
Media/Download Request
    ↓
lib/ Handler Selection
    ↓
Process (Convert/Download/Generate)
    ↓
Format Output
    ↓
Send to User
\`\`\`

---

## ⚙️ Configuration

**Performance Settings:**
\`\`\`javascript
// Conversion settings
CONVERT_TIMEOUT = 60000  // 60 seconds
CONVERT_MAX_SIZE = 500   // MB

// Download settings
DOWNLOAD_TIMEOUT = 120000 // 2 minutes
DOWNLOAD_MAX_RETRIES = 3

// AI settings
AI_REQUEST_TIMEOUT = 60000 // 60 seconds
AI_MAX_RETRIES = 3
\`\`\`

---

## 🚀 Performance

- **Streaming** - Large files processed in streams
- **Caching** - Temporary files in `/lib/temp/`
- **Parallel** - Multiple conversions simultaneously
- **Fallback** - Automatic API switching

---

## ⚠️ Important Notes

- `lib/buggers/bug.js` is intentionally not documented
- Temporary files auto-cleanup after 24 hours
- Media files have size limits per platform
- AI responses have rate limiting

---
