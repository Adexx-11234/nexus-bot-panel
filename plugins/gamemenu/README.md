# 🎮 Game Menu Plugin Documentation

Interactive games with real-time player tracking and scoring systems.

---

## 🎯 Available Games

| Game | Command | Players | Duration | Difficulty |
|------|---------|---------|----------|-----------|
| **Tic Tac Toe** | `tictactoe` | 2 | 5-10 min | Easy |
| **Rock Paper Scissors** | `rockpaperscissors` | 2+ | 2-5 min | Easy |
| **Trivia Quiz** | `trivia` | 2+ | 10-20 min | Medium |
| **Math Quiz** | `quiz` | 2+ | 15-30 min | Hard |
| **Number Guessing** | `guess` | 1+ | 5 min | Easy |
| **Word Guessing** | `wordguess` | 2+ | 10 min | Medium |
| **Reaction Speed** | `reaction` | 2+ | 3 min | Hard |
| **Active Games** | `activegames` | - | - | - |

---

## 🔧 Game State Management

### **Game Lifecycle**

\`\`\`
Player initiates
    ↓
Game created & registered
    ↓
Wait for players to join
    ↓
Game starts
    ↓
Process player actions
    ↓
Update game state
    ↓
Check win/lose condition
    ↓
End game & calculate scores
    ↓
Display results
    ↓
Cleanup
\`\`\`

### **State Tracking**

\`\`\`javascript
{
  gameId: "game_1701624000_123",
  type: "tictactoe",
  status: "active",           // pending, active, ended
  players: [
    {
      id: "1234567890@s.whatsapp.net",
      name: "Player 1",
      symbol: "X",
      score: 0,
      joinedAt: 1701624000000
    },
    {
      id: "0987654321@s.whatsapp.net",
      name: "Player 2",
      symbol: "O",
      score: 0,
      joinedAt: 1701624005000
    }
  ],
  currentTurn: "1234567890@s.whatsapp.net",
  board: [0, 1, 2, 3, 4, 5, 6, 7, 8],  // Tic Tac Toe board
  startedAt: 1701624010000,
  endedAt: null,
  winner: null
}
\`\`\`

---

## 💬 Game Commands

### **Start Tic Tac Toe**
\`\`\`
.tictactoe @opponent
.tictactoe (reply to user)
\`\`\`

**Board Display:**
\`\`\`
 1 | 2 | 3
-----------
 4 | 5 | 6
-----------
 7 | 8 | 9

Your turn: Type position (1-9) or .move 5
\`\`\`

**Response:**
\`\`\`
✅ Tic Tac Toe Started
Player 1 (X): Ahmed
Player 2 (O): Ali

Ahmed's turn - Choose position 1-9
\`\`\`

### **Rock Paper Scissors**
\`\`\`
.rockpaperscissors @player1 @player2 ...
.rps (reply to user)
\`\`\`

**Scoring:**
\`\`\`
Round 1: Ahmed (rock) vs Ali (scissors) → Ahmed wins!
Round 2: Ahmed (paper) vs Ali (rock) → Ahmed wins!
Round 3: Ahmed (scissors) vs Ali (paper) → Ahmed wins!

🏆 Ahmed wins! (3 - 0)
\`\`\`

### **Trivia Quiz**
\`\`\`
.trivia @player1 @player2
.quiz (reply to message)
\`\`\`

**Question Format:**
\`\`\`
❓ Question 1/10
What is the capital of France?

A) London
B) Paris
C) Berlin
D) Madrid

Answer with: .answer B
Time left: 30s ⏱️
\`\`\`

**Results:**
\`\`\`
🏆 Quiz Results:
1st: Ahmed - 9/10 correct (90%)
2nd: Ali - 7/10 correct (70%)
3rd: Hassan - 5/10 correct (50%)
\`\`\`

### **Number Guessing**
\`\`\`
.guess min:1 max:100
.guess (1-1000)
\`\`\`

**Gameplay:**
\`\`\`
🎯 I'm thinking of a number between 1 and 100
Guess: .guess 50

Your guess: 50
Hint: Too high! ⬆️
Guess: .guess 25

Your guess: 25
Hint: Too low! ⬇️

Correct! It was 37
Attempts: 5
\`\`\`

### **Word Guessing**
\`\`\`
.wordguess category
.wordguess animals
\`\`\`

**Display:**
\`\`\`
_ _ _ _

Guessed: A, E
Wrong: X, Z (2 wrong)
Remaining: 8 tries

Guess letter: .guess E
\`\`\`

### **Reaction Speed**
\`\`\`
.reaction players:5
.reaction (challenge players)
\`\`\`

**Challenge:**
\`\`\`
🚀 REACTION TEST!
Click as fast as you can!

[REACTION TIME HERE]

Results:
1st: Ahmed - 245ms 🥇
2nd: Ali - 312ms 🥈
3rd: Hassan - 456ms 🥉
\`\`\`

### **View Active Games**
\`\`\`
.activegames
.games
\`\`\`

**Output:**
\`\`\`
🎮 Active Games:
1. Tic Tac Toe - Ahmed vs Ali
2. Trivia Quiz - 5 players - Q3/10
3. RPS - Hassan playing

Total: 3 games active
\`\`\`

### **End Game**
\`\`\`
.endgame [gameId]
.endgame (in active game)
\`\`\`

---

## 📊 Scoring System

**Tic Tac Toe:**
- Win: +10 points
- Draw: +1 point
- Loss: 0 points

**Rock Paper Scissors:**
- Win per round: +3 points
- Draw: +1 point
- Loss per round: 0 points

**Trivia:**
- Correct answer: +10 points
- Bonus: +5 points (fast answer)

**Number Guessing:**
- Solved: Points based on attempts (10 - attempts)

---

## 🔐 Game Rules

**General:**
- All players must be in same chat
- Games are group-specific
- Only 1 game per player at a time
- 30-minute timeout for inactive games
- Results logged to database

**Specific:**
- Tic Tac Toe: 2 players max
- RPS: 3-10 players
- Trivia: 2-20 players
- Reaction: Unlimited players

---

## 🔄 Database Storage

**Completed Games:**
\`\`\`sql
id | game_id | type | players | winner | scores | created_at | ended_at | duration
1  | game_1  | tic  | [1,2]   | 1      | [...]  | 2024-12-03 | ...      | 600000
\`\`\`

**Player Statistics:**
\`\`\`sql
user_id | total_games | wins | losses | draws | avg_score | best_score
123     | 45          | 28   | 12     | 5     | 8.2       | 100
\`\`\`

---

## ⚙️ Configuration

**Game Settings:**
\`\`\`javascript
{
  maxConcurrentGames: 10,
  gameTimeout: 30 * 60 * 1000,      // 30 minutes
  minPlayersRequired: 2,
  maxPlayersPerGame: 20,
  pointsPerWin: 10,
  enableRanking: true,
  enableReplay: true
}
\`\`\`

---
