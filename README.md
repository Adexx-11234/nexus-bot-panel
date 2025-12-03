# WhatsApp-Telegram Bot Platform

A comprehensive multi-user bot platform supporting both WhatsApp and Telegram with an extensive plugin system, game modes, media conversion, and advanced group management features.

---

## 📋 Table of Contents

- [Project Overview](#project-overview)
- [Key Features](#key-features)
- [Folder Structure](#folder-structure)
- [Technology Stack](#technology-stack)
- [Installation & Setup](#installation--setup)
- [Environment Variables](#environment-variables)
- [Running the Platform](#running-the-platform)
- [Platform Architecture](#platform-architecture)
- [Plugin System](#plugin-system)
- [Database Schema](#database-schema)
- [API Endpoints](#api-endpoints)
- [Game System](#game-system)
- [Troubleshooting](#troubleshooting)

---

## 🎯 Project Overview

This is a **multi-user WhatsApp and Telegram Bot Platform** that integrates both messaging services into a single unified system. The platform features:

- **Dual-platform support** (WhatsApp via Baileys, Telegram via node-telegram-bot-api)
- **Plugin-based architecture** for extensible functionality
- **Interactive games** (Tic-Tac-Toe, Rock-Paper-Scissors, Trivia, Quiz, etc.)
- **Media conversion** (image to sticker, video to audio, etc.)
- **Content downloading** (YouTube, TikTok, Instagram, Spotify, etc.)
- **Group management tools** (anti-spam, anti-link, kick/promote, etc.)
- **VIP system** for special user privileges
- **PostgreSQL database** for persistent storage
- **Web interface** for admin management
- **Scheduled group actions** (open/close times, messages)

---

## ✨ Key Features

### Messaging & Communication
- Send/receive messages on WhatsApp and Telegram
- Group management and user permissions
- Message reactions and forwarding
- Hidden tag (mention without notification)
- Broadcast to multiple users

### Games
- **Tic-Tac-Toe** - Classic strategy game with multiplayer support
- **Rock-Paper-Scissors** - Interactive game
- **Number Guessing** - Guess the random number
- **Math Quiz** - Solve mathematical problems
- **Reaction Speed** - Test your reflexes
- **Trivia** - General knowledge questions
- **Word Guessing** - Hangman-style game
- Active games tracking per user

### Media & Downloads
- **Image Conversion** - Convert to stickers, GIFs
- **Video Conversion** - To audio, MP3, GIF, etc.
- **Download from platforms** - YouTube, TikTok, Instagram, Facebook, Spotify, SoundCloud, Pinterest, MediaFire, Google Drive, CapCut, Apple Music
- **Link preview** - Show metadata for shared links
- **Media URL export** - Convert media to shareable URLs

### Group Management
- **Anti-features** - Anti-spam, anti-link, anti-image, anti-mention, anti-tag, anti-bot, anti-kick, anti-demote, anti-promote, anti-virtex, anti-viewonce
- **Admin controls** - Promote, demote, kick, warn, mute
- **Welcome/Goodbye** - Custom messages for member join/leave
- **Group link** - Generate and share group invite link
- **Scheduled times** - Auto-open/close groups at specific times
- **All member operations** - Bulk promote/demote/kick
- **Tag operations** - Tag admin, online, all members, polls

### Owner Controls
- **Session management** - Create groups, join/leave groups
- **Auto features** - Auto-online, auto-recording, auto-typing, auto-status view, auto-status like, auto-antidelete
- **Block/unblock** - User management
- **VIP system** - Grant special privileges to users
- **Bot settings** - Enable/disable public mode, group-only mode

### Bug/Crash Features
- Device crash messages (iPhone, Android, iOS)
- Mixed crash notifications
- Group crash features

---

## 📁 Folder Structure

\`\`\`
project-root/
├── index.js                           # Main entry point - Platform initialization
├── package.json                       # Dependencies and scripts
├── config/                            # Configuration files
│   ├── constant.js                   # Platform constants and settings
│   ├── database.js                   # PostgreSQL connection setup
│   ├── baileys.js                    # WhatsApp (Baileys) configuration
│   └── telegram.js                   # Telegram bot configuration
├── database/                          # Database management
│   ├── connection.js                 # Connection initialization
│   ├── db.js                         # Database queries
│   ├── query.js                      # SQL query helpers
│   ├── groupscheduler.js             # Scheduled group actions
│   └── migrations/                   # Database migrations
│       ├── 001_init.sql              # Initial schema
│       └── run-migrations.js         # Migration runner
├── lib/                              # Core libraries and utilities
│   ├── game managers/                # Game implementations
│   │   ├── game-manager.js          # Base game manager
│   │   ├── tictactoe.js             # Tic-Tac-Toe game
│   │   ├── rock-paper-scissors.js   # RPS game
│   │   ├── number-guessing-game.js  # Number guessing game
│   │   ├── math-quiz-game.js        # Math quiz game
│   │   ├── ReactionSpeedGame.js     # Reaction test game
│   │   ├── TriviaGame.js            # Trivia questions
│   │   └── word-guessing-game.js    # Word guessing game
│   ├── converters/                  # Media conversion
│   │   └── media-converter.js       # Convert media formats
│   ├── downloaders/                 # Download handlers
│   │   └── index.js                 # Main downloader logic
│   └── buggers/                     # Crash/bug features
│       └── bug.js                   # Bug message generation
├── plugins/                          # Extensible plugin system
│   ├── mainmenu/                    # Main commands
│   │   ├── menu.js                  # Main menu display
│   │   ├── allcommands.js           # List all commands
│   │   ├── ping.js                  # Bot latency test
│   │   ├── vv.js                    # View once messages
│   │   ├── botlink.js               # Bot invite link
│   │   ├── channel.js               # Channel info
│   │   ├── checkban.js              # Check ban status
│   │   └── pin.js                   # Pin messages
│   ├── groupmenu/                   # Group management (50+ commands)
│   │   ├── groupmenu.js             # Group menu display
│   │   ├── kick.js, kickall.js      # Kick members
│   │   ├── promote.js, demote.js    # Change admin status
│   │   ├── warn.js, unwarn.js       # Warning system
│   │   ├── mute.js, unmute.js       # Mute members
│   │   ├── antilink.js              # Anti-link enforcement
│   │   ├── antispam.js              # Anti-spam enforcement
│   │   ├── add.js                   # Add members to group
│   │   ├── welcome.js, goodbye.js   # Join/leave messages
│   │   ├── tagall.js, tagadmin.js   # Mention operations
│   │   └── [30+ more files]         # Additional group features
│   ├── downloadmenu/                # Download capabilities (20+ sources)
│   │   ├── downloadmenu.js          # Download menu
│   │   ├── ytdl.js                  # YouTube downloader
│   │   ├── tiktokdl.js              # TikTok downloader
│   │   ├── igdl.js                  # Instagram downloader
│   │   ├── fbdl.js                  # Facebook downloader
│   │   ├── spotifydl.js             # Spotify downloader
│   │   ├── play.js                  # Spotify music player
│   │   ├── ytsearch.js              # YouTube search
│   │   ├── twitterdl.js             # Twitter downloader
│   │   ├── pinterest.js             # Pinterest image scraper
│   │   ├── applemusicdl.js          # Apple Music downloader
│   │   ├── gdrive.js                # Google Drive downloader
│   │   ├── mediafire.js             # MediaFire downloader
│   │   └── [more downloaders]       # Additional sources
│   ├── convertmenu/                 # Media conversion (10+ formats)
│   │   ├── convertmenu.js           # Conversion menu
│   │   ├── sticker.js               # Image to sticker
│   │   ├── togif.js                 # Video to GIF
│   │   ├── toimage.js               # Sticker to image
│   │   ├── toaudio.js               # Video to audio
│   │   ├── tomp3.js                 # Audio extraction
│   │   ├── tovideo.js               # Image to video
│   │   ├── tovn.js                  # Audio to voice note
│   │   ├── tourl.js                 # Upload and get URL
│   │   ├── telesticker.js           # Telegram sticker format
│   │   ├── take.js                  # Sticker metadata
│   │   └── smeme.js                 # Create meme stickers
│   ├── gamemenu/                    # Game commands
│   │   ├── gamemenu.js              # Game menu display
│   │   ├── tictactoe.js             # Tic-Tac-Toe launcher
│   │   ├── rockpaperscissors.js     # RPS launcher
│   │   ├── guess.js                 # Number guessing
│   │   ├── quiz.js                  # Math quiz
│   │   ├── reaction.js              # Reaction speed test
│   │   ├── trivia.js                # Trivia game
│   │   ├── wordguess.js             # Word guessing
│   │   ├── activegames.js           # List active games
│   │   └── endgame.js               # Stop a game
│   ├── ownermenu/                   # Owner-only commands
│   │   ├── creategc.js              # Create new group
│   │   ├── join.js, leave.js        # Join/leave group
│   │   ├── listgc.js, listpc.js     # List groups/chats
│   │   ├── block.js                 # Block users
│   │   ├── autorecording.js         # Auto-recording mode
│   │   ├── autotyping.js            # Auto-typing indicator
│   │   ├── autoonline.js            # Auto-online status
│   │   ├── autostatusview.js        # Auto-view status
│   │   ├── autostatuslike.js        # Auto-like status
│   │   └── [more owner features]    # Additional controls
│   ├── bugmenu/                     # Bug/crash features
│   │   ├── bugmenu.js               # Bug menu
│   │   ├── androidcrash.js          # Android crash
│   │   ├── iphonecrash.js           # iPhone crash
│   │   ├── gccrash.js               # Group crash
│   │   └── mixedcrash.js            # Mixed crash
│   ├── convertmenu/                 # Media conversion menu
│   └── aimenu/                      # AI-related features
├── middleware/                       # Express middleware
│   └── admin-check.js               # Admin authentication check
├── utils/                            # Utility functions
│   ├── logger.js                    # Logging system
│   ├── plugin-loader.js             # Plugin loading system
│   └── [other utilities]            # Helper functions
├── web/                             # Web interface
│   └── index.js                     # Web interface setup
├── whatsapp/                        # WhatsApp integration
│   └── index.js                     # WhatsApp session manager
├── telegram/                        # Telegram integration
│   └── index.js                     # Telegram bot setup
├── public/                          # Static files for web
├── .env.example                     # Environment variables template
├── .gitignore                       # Git ignore rules
├── package-lock.json                # Dependency lock file
└── announcement.txt                 # Latest announcements
\`\`\`

---

## 🛠️ Technology Stack

### Backend
- **Node.js** - JavaScript runtime
- **Express.js** - Web framework
- **PostgreSQL** - Relational database
- **MongoDB** (optional) - NoSQL storage for sessions

### WhatsApp Integration
- **@whiskeysockets/baileys** - WhatsApp Web API client (Elaina fork)

### Telegram Integration
- **node-telegram-bot-api** - Telegram Bot API wrapper

### Media Processing
- **FFmpeg/fluent-ffmpeg** - Video/audio processing
- **Sharp** - Image processing and manipulation
- **Jimp** - JavaScript image manipulation
- **file-type** - File format detection

### Utilities
- **axios** - HTTP client
- **cheerio** - HTML parsing (web scraping)
- **bcryptjs** - Password hashing
- **jsonwebtoken** - JWT authentication
- **node-cron** - Task scheduling
- **moment/moment-timezone** - Date/time handling
- **lru-cache** - Memory caching
- **node-cache** - In-memory caching

---

## 📦 Installation & Setup

### Prerequisites
- Node.js v18+ 
- npm or yarn
- PostgreSQL 12+
- FFmpeg installed on system
- .env file with configuration

### Step 1: Clone and Install Dependencies
\`\`\`bash
git clone <repository-url>
cd whatsapp-telegram-bot-platform
npm install
\`\`\`

### Step 2: Set Up Environment Variables
Create `.env` file in root directory:
\`\`\`bash
cp .env.example .env
# Edit .env with your configuration
\`\`\`

### Step 3: Database Setup
\`\`\`bash
# Run migrations
npm run migrate
\`\`\`

### Step 4: Configure Integrations
- **WhatsApp**: Get Pairing Code from WhatsApp app
- **Telegram**: Get bot token from @BotFather on Telegram

### Step 5: Start the Platform
\`\`\`bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
\`\`\`

The platform will initialize in this order:
1. Connect to PostgreSQL database
2. Run database migrations
3. Load plugins
4. Initialize Telegram bot
5. Initialize WhatsApp sessions
6. Set up VIP system
7. Start group scheduler
8. Start HTTP server on port 3000

---

## 🔐 Environment Variables

### Database Configuration
\`\`\`env
DATABASE_URL=postgresql://user:password@localhost:5432/botdb
\`\`\`

### WhatsApp Configuration
\`\`\`env
WA_RECONNECT_INTERVAL=5000          # Reconnection delay (ms)
SESSION_TIMEOUT=86400000            # Session timeout (24 hours)
SUPPRESS_LIBRARY_LOGS=true          # Suppress debug logs
\`\`\`

### Telegram Configuration
\`\`\`env
TELEGRAM_BOT_TOKEN=your_bot_token_here
DEFAULT_VIP_TELEGRAM_ID=123456789   # VIP user Telegram ID
\`\`\`

### Server Configuration
\`\`\`env
PORT=3000                           # HTTP server port
NODE_ENV=development                # Environment (development/production)
\`\`\`

### Optional Services
\`\`\`env
MONGODB_URL=mongodb://localhost     # For optional MongoDB storage
API_KEY_YOUTUBE=your_api_key        # YouTube API key (if needed)
\`\`\`

---

## 🚀 Running the Platform

### Development Mode
\`\`\`bash
npm run dev
\`\`\`
Auto-restarts on file changes using nodemon.

### Production Mode
\`\`\`bash
npm start
\`\`\`

### Health Checks
\`\`\`bash
# Check platform health
curl http://localhost:3000/health

# Get detailed status
curl http://localhost:3000/api/status
\`\`\`

### Graceful Shutdown
- Send SIGINT (Ctrl+C) or SIGTERM
- Platform will gracefully close all connections
- Sessions are saved before shutdown

---

## 🏗️ Platform Architecture

### Initialization Flow
\`\`\`
initializePlatform()
├── 1. Connect PostgreSQL
├── 2. Run Migrations
├── 3. Load Plugins
├── 4. Init Telegram Bot
├── 5. Init WhatsApp Sessions
├── 6. Init VIP System
├── 7. Start Group Scheduler
├── 8. Verify Database
└── 9. Start HTTP Server
\`\`\`

### Request Processing
\`\`\`
User Message (WhatsApp/Telegram)
├── Plugin Loader
├── Check Permissions
├── Validate Command
├── Execute Plugin
└── Send Response
\`\`\`

### Component Interaction
\`\`\`
Express App (HTTP Server)
├── Web Interface Router
├── API Endpoints
└── Health Checks

Session Manager (WhatsApp)
├── Connection Handler
├── Message Handler
├── Plugin Executor
└── Storage Manager

Telegram Bot
├── Message Listener
├── Command Parser
├── Plugin Executor
└── Response Sender

Database
├── User Management
├── Group Settings
├── Session Storage
└── Log Storage
\`\`\`

---

## 🔌 Plugin System

### Plugin Structure
Each plugin is a standalone module with this structure:

\`\`\`javascript
// plugins/category/command-name.js
export default {
  name: "command-name",
  command: /^!cmdname$/i,
  category: "category",
  description: "What this command does",
  async execute(context) {
    const { message, sender, group, args, reply } = context
    // Command logic here
    await reply("Response message")
  }
}
\`\`\`

### Plugin Loading
- Plugins auto-load from `plugins/*/` directories
- Each subdirectory is a category (mainmenu, groupmenu, etc.)
- Plugins are indexed and matched against incoming messages

### Available Plugin Categories
- **mainmenu/** - Main bot commands
- **groupmenu/** - Group management (50+ commands)
- **downloadmenu/** - Media downloaders (20+ sources)
- **convertmenu/** - Media converters (10+ formats)
- **gamemenu/** - Interactive games (8 games)
- **ownermenu/** - Owner-only operations
- **bugmenu/** - Crash features
- **aimenu/** - AI features (if integrated)

---

## 💾 Database Schema

### Main Tables

**users**
\`\`\`sql
- id (PRIMARY KEY)
- telegram_id / whatsapp_id
- username
- created_at
- is_vip
- permissions
\`\`\`

**groups**
\`\`\`sql
- id (PRIMARY KEY)
- group_id
- group_name
- owner_id
- settings (JSON)
- created_at
\`\`\`

**group_settings**
\`\`\`sql
- id (PRIMARY KEY)
- group_id (FK)
- antilink_enabled
- antispam_enabled
- welcome_message
- goodbye_message
- open_time / close_time
\`\`\`

**warnings**
\`\`\`sql
- id (PRIMARY KEY)
- user_id (FK)
- group_id (FK)
- count
- reason
- timestamp
\`\`\`

**active_games**
\`\`\`sql
- id (PRIMARY KEY)
- game_type
- players (JSON)
- game_data (JSON)
- created_at
\`\`\`

**vip_users**
\`\`\`sql
- id (PRIMARY KEY)
- user_id (FK)
- vip_level
- expires_at
- features (JSON)
\`\`\`

---

## 🌐 API Endpoints

### Health & Status
- `GET /health` - Platform health check
- `GET /api/status` - Detailed system status

### Web Interface
- `GET /` - Web dashboard
- `POST /api/login` - Admin authentication
- `GET /api/sessions` - Active sessions
- `POST /api/command` - Execute command (admin only)

---

## 🎮 Game System

### Game Manager Architecture
\`\`\`
GameManager (base class)
├── initializeGame()
├── processMove()
├── getState()
├── checkWin()
└── endGame()
\`\`\`

### Available Games

1. **Tic-Tac-Toe**
   - 2 players, 3x3 grid
   - Commands: place move, view board, end game

2. **Rock-Paper-Scissors**
   - 1v1 competitive
   - Win tracking, best of 3

3. **Number Guessing**
   - Guess random number 1-100
   - Limited attempts, hints provided

4. **Math Quiz**
   - Random arithmetic problems
   - Score tracking, difficulty levels

5. **Reaction Speed**
   - Click/respond as fast as possible
   - Leaderboard ranking

6. **Trivia**
   - General knowledge questions
   - Category selection, multi-choice

7. **Word Guessing**
   - Hangman-style game
   - Letter guessing, attempts tracking

### Game State Management
- Games stored in `lib/game managers/`
- Active games tracked in database
- Player data persisted per session
- Automatic cleanup after game end

---

## 🔧 Troubleshooting

### Common Issues

**1. Database Connection Failed**
\`\`\`
Solution: Check DATABASE_URL in .env, ensure PostgreSQL is running
\`\`\`

**2. WhatsApp Session Expired**
\`\`\`
Solution: Re-generate pairing code, delete old session files, re-pair
\`\`\`

**3. Telegram Bot Not Responding**
\`\`\`
Solution: Check TELEGRAM_BOT_TOKEN, verify bot is running, check internet
\`\`\`

**4. Media Conversion Fails**
\`\`\`
Solution: Ensure FFmpeg is installed, check file permissions, verify disk space
\`\`\`

**5. Plugin Not Loading**
\`\`\`
Solution: Check plugin syntax, verify file in correct directory, check plugin-loader logs
\`\`\`

**6. High Memory Usage**
\`\`\`
Solution: Check cache settings, clean old sessions, monitor game creation rate
\`\`\`

### Debug Mode
Enable debug logging:
\`\`\`bash
DEBUG=* npm start
\`\`\`

Suppress library logs:
\`\`\`env
SUPPRESS_LIBRARY_LOGS=true
\`\`\`

### Log Files
- Main logs: Console output with timestamps
- Database logs: PostgreSQL query logs
- Error logs: Saved in database error_logs table

---

## 📝 Development Guidelines

### Adding a New Command
1. Create file in appropriate plugin category
2. Export default object with required properties
3. Implement `execute()` async function
4. Plugin auto-loads on next restart

### Adding a New Game
1. Create file in `lib/game managers/`
2. Extend GameManager class
3. Implement required methods
4. Create plugin in `plugins/gamemenu/` to trigger it

### Adding Database Migration
1. Create new SQL file in `database/migrations/`
2. Follow naming convention: `XXX_description.sql`
3. Run migrations with `npm run migrate`

---

## 📞 Support & Contribution

For issues, feature requests, or contributions:
1. Check existing documentation
2. Review troubleshooting section
3. Check GitHub issues
4. Create detailed bug report with logs

---

## 📄 License

MIT License - See LICENSE file for details

---

**Last Updated**: December 2024
**Platform Version**: 1.0.0
**Maintained By**: WhatsApp-Telegram Bot Platform Team
