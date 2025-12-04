# 🤖 WhatsApp-Telegram Bot Platform

A powerful multi-user bot platform supporting both WhatsApp and Telegram with an extensive plugin system, media conversion, game management, and AI integrations.

---

## 📋 Table of Contents

<details>
<summary><strong>📚 Expand All Sections</strong></summary>

- [Overview](#overview)
- [Setup Instructions](#setup-instructions)
- [Project Structure](#project-structure)
- [Core Features](#core-features)
- [Plugin System](#plugin-system)
- [Folder Documentation](#folder-documentation)
- [Database Schema](#database-schema)
- [API Endpoints](#api-endpoints)
- [Contributing](#contributing)

</details>

---

## 🎯 Overview

The **WhatsApp-Telegram Bot Platform** is a comprehensive automation solution that allows you to:

- **Multi-Platform Support**: Operate simultaneously on WhatsApp and Telegram
- **Plugin Architecture**: Easily extend functionality with custom plugins
- **AI Integration**: Leverage multiple AI models (GPT-4, Claude, Gemini, etc.)
- **Media Processing**: Convert, download, and manipulate media files
- **Game Management**: Run interactive games with real-time engagement
- **Group Management**: Powerful group administration tools
- **User Authentication**: VIP system and owner privileges
- **Database Persistence**: PostgreSQL with MongoDB support
- **Scheduled Tasks**: Automated group scheduling and management

---

## ⚙️ Setup Instructions

### **Setup 1: Environment Configuration**

Before running the bot, create a `.env` file in the root directory:

\`\`\`env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/botdb
MONGODB_URI=mongodb://localhost:27017/bot

# WhatsApp
WHATSAPP_SESSION_PATH=./sessions
WHATSAPP_PROFILE=./profile.json

# Telegram
TELEGRAM_TOKEN=your_telegram_bot_token_here
DEFAULT_VIP_TELEGRAM_ID=your_telegram_id

# Server
PORT=3000
NODE_ENV=development

# AI API Keys (Optional)
GEMINI_API_KEY=your_key
OPENAI_API_KEY=your_key

# Logging
SUPPRESS_LIBRARY_LOGS=true
LOG_LEVEL=info
\`\`\`

### **Setup 2: Installation & Initialization**

\`\`\`bash
# 1. Install dependencies
npm install

# 2. Run database migrations
npm run migrate

# 3. Start the bot
npm start

# Or for development with auto-reload
npm run dev
\`\`\`

The bot will automatically:
1. Connect to PostgreSQL database
2. Run all pending migrations
3. Load all plugins
4. Initialize Telegram bot
5. Initialize WhatsApp module
6. Start group scheduler
7. Launch HTTP server on port 3000

**Health Check URLs:**
- `http://localhost:3000/health` - Platform health status
- `http://localhost:3000/api/status` - Detailed component status

---

## 📁 Project Structure

\`\`\`
whatsapp-telegram-bot-platform/
│
├── 📄 index.js                    # Main entry point & platform initialization
├── 📄 package.json                # Dependencies & scripts
├── 📄 .env                        # Environment configuration (create this)
│
├── 📂 app/                        # Web interface (Next.js)
│   ├── layout.tsx
│   ├── globals.css
│   └── page.tsx
│
├── 📂 components/                 # UI Components
│   ├── ui/                        # shadcn UI components
│   └── theme-provider.tsx
│
├── 📂 database/                   # 📖 [See database/README.md]
│   ├── connection.js
│   ├── db.js
│   ├── query.js
│   ├── groupscheduler.js
│   └── migrations/
│       ├── 001_init.sql
│       └── run-migrations.js
│
├── 📂 lib/                        # 📖 [See lib/README.md]
│   ├── ai/
│   │   └── index.js               # AI API integration (Gemini, GPT-4, Claude, etc.)
│   ├── converters/
│   │   └── media-converter.js
│   ├── downloaders/
│   │   └── index.js
│   ├── game managers/             # Game logic handlers
│   │   ├── game-manager.js
│   │   ├── ReactionSpeedGame.js
│   │   ├── TriviaGame.js
│   │   └── [other games].js
│   ├── buggers/
│   │   └── bug.js                 # ⚠️ SKIP - Not documented
│   ├── utils.ts
│   └── temp/                      # Temporary files
│
├── 📂 middleware/                 # 📖 [See middleware/README.md]
│   └── admin-check.js
│
├── 📂 plugins/                    # 📖 [See plugins/README.md]
│   ├── mainmenu/
│   │   ├── README.md
│   │   ├── menu.js
│   │   ├── ping.js
│   │   └── [other commands].js
│   │
│   ├── groupmenu/                 # 📖 [See plugins/groupmenu/README.md]
│   │   ├── README.md
│   │   ├── groupmenu.js
│   │   ├── add.js, kick.js, promote.js
│   │   ├── warn.js, mute.js, delete.js
│   │   └── [40+ group management commands]
│   │
│   ├── downloadmenu/              # 📖 [See plugins/downloadmenu/README.md]
│   │   ├── README.md
│   │   ├── downloadmenu.js
│   │   ├── ytdl.js, igdl.js, fbdl.js
│   │   ├── spotifydl.js, tiktokdl.js
│   │   └── [15+ download commands]
│   │
│   ├── convertmenu/               # 📖 [See plugins/convertmenu/README.md]
│   │   ├── README.md
│   │   ├── convertmenu.js
│   │   ├── sticker.js, toimage.js, toaudio.js
│   │   └── [10+ conversion commands]
│   │
│   ├── gamemenu/                  # 📖 [See plugins/gamemenu/README.md]
│   │   ├── README.md
│   │   ├── gamemenu.js
│   │   ├── tictactoe.js, rockpaperscissors.js
│   │   └── [8+ interactive games]
│   │
│   ├── bugmenu/                   # 📖 [See plugins/bugmenu/README.md]
│   │   ├── README.md
│   │   ├── bugmenu.js
│   │   └── [crash/bug commands]
│   │
│   ├── aimenu/                    # 📖 [See plugins/aimenu/README.md]
│   │   ├── README.md
│   │   └── aimenu.js
│   │
│   ├── ownermenu/                 # 📖 [See plugins/ownermenu/README.md]
│   │   ├── README.md
│   │   ├── ownermenu.js
│   │   ├── add-owner.js, list-owners.js
│   │   └── [15+ owner-only commands]
│   │
│   ├── auto-antidelete.js
│   └── auto-antiviewonce.js
│
├── 📂 whatsapp/                   # 📖 [See whatsapp/README.md]
│   ├── index.js
│   ├── session-manager.js
│   ├── command-handler.js
│   └── [WhatsApp integration]
│
├── 📂 telegram/                   # 📖 [See telegram/README.md]
│   ├── index.js
│   ├── connection-handler.js
│   └── [Telegram integration]
│
├── 📂 connections/                # 📖 [See connections/README.md]
│   └── [Connection handlers]
│
├── 📂 utils/                      # 📖 [See utils/README.md]
│   ├── logger.js
│   ├── menu-system.js
│   ├── plugin-loader.js
│   └── [helper utilities]
│
├── 📂 config/                     # 📖 [See config/README.md]
│   └── database.js
│
├── 📂 web/                        # 📖 [See web/README.md]
│   └── index.js
│
├── 📂 public/                     # Static files
│
└── 📂 Defaults/                   # Default assets
    └── images/
        └── menu.png
\`\`\`

---

## 🎯 Core Features

### **1. Multi-Platform Support**
- **WhatsApp**: Full Baileys integration for web automation
- **Telegram**: Bot API with webhook support
- **Dual Command Processing**: Same commands work across both platforms

### **2. Plugin System**
- Modular command architecture
- Auto-loading from `/plugins` directory
- Category-based organization (menu, group, download, etc.)
- Support for admin-only and owner-only commands

### **3. Media Processing**
- **Conversion**: Sticker, Image, Audio, Video, GIF, MP3
- **Compression**: Audio and video compression
- **Extraction**: URL extraction from media
- **Download**: Support for 15+ platforms

### **4. Game Management**
- Tic Tac Toe
- Rock Paper Scissors
- Trivia Quiz
- Math Quiz
- Number Guessing
- Word Guessing
- Reaction Speed Challenge

### **5. AI Integration**
- Gemini AI (Primary & Lite)
- GPT-4o & GPT-4o Mini
- Claude AI
- Llama 3.3-70b
- Meta AI
- Copilot (with Think Mode)
- Bible AI, Gita AI, Muslim AI
- Image Generation (Flux, Magic Studio)

### **6. Group Management**
- User roles (Admin, Member)
- Automated warnings & kicks
- Anti-spam, anti-link, anti-mention
- Member approval & disapproval
- Auto-welcome & goodbye messages
- Group link management
- Tag management (all, admin, online, poll)

### **7. Owner Features**
- Multi-owner system
- Auto-status viewing/liking
- Auto-typing & recording indicators
- Block/unblock users
- Group creation & management
- Session management

---

## 🔌 Plugin System

Each plugin follows this structure:

\`\`\`javascript
export default {
  name: "commandname",
  commands: ["cmd", "alias1", "alias2"],
  description: "What this command does",
  adminOnly: false,
  ownerOnly: false,
  
  async execute(sock, sessionId, args, m) {
    try {
      // Plugin logic here
      return { success: true, data: ... }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }
}
\`\`\`

### **Plugin Categories**

| Category | Purpose | Count |
|----------|---------|-------|
| **mainmenu** | Main bot commands & info | 8 commands |
| **groupmenu** | Group administration | 40+ commands |
| **downloadmenu** | Media downloads | 15 commands |
| **convertmenu** | Media conversion | 10 commands |
| **gamemenu** | Interactive games | 8 games |
| **aimenu** | AI features | Multiple AI models |
| **ownermenu** | Owner-only features | 15 commands |
| **bugmenu** | System utilities | 5 commands |
| **auto-*** | Auto features | Anti-delete, Anti-viewonce |

---

## 📖 Folder Documentation

Each major folder has its own detailed README:

### **[📄 database/README.md](./database/README.md)**
- Database connection management
- Query execution & pooling
- Migration system
- Group scheduler
- Schema overview

### **[📄 lib/README.md](./lib/README.md)**
- AI API integration
- Media conversion pipeline
- Download handlers
- Game managers
- Utility functions

### **[📄 plugins/README.md](./plugins/README.md)**
- Plugin architecture overview
- Plugin lifecycle
- Command handling
- Menu system

### **[📄 plugins/groupmenu/README.md](./plugins/groupmenu/README.md)**
- Group management commands
- User role system
- Anti-spam features
- Member management

### **[📄 plugins/downloadmenu/README.md](./plugins/downloadmenu/README.md)**
- Supported download platforms
- Media format handling
- Queue management
- Error handling

### **[📄 plugins/convertmenu/README.md](./plugins/convertmenu/README.md)**
- Media conversion types
- Format support
- Compression options
- Quality settings

### **[📄 plugins/gamemenu/README.md](./plugins/gamemenu/README.md)**
- Game state management
- Player tracking
- Score calculation
- Game events

### **[📄 plugins/aimenu/README.md](./plugins/aimenu/README.md)**
- Available AI models
- Model selection
- Response handling
- Error fallbacks

### **[📄 plugins/ownermenu/README.md](./plugins/ownermenu/README.md)**
- Owner privileges
- Multi-owner system
- Owner commands
- Authority levels

### **[📄 whatsapp/README.md](./whatsapp/README.md)**
- Session management
- Message handling
- Connection lifecycle
- Baileys integration

### **[📄 telegram/README.md](./telegram/README.md)**
- Bot API integration
- Update handling
- Message processing
- Connection management

### **[📄 utils/README.md](./utils/README.md)**
- Logger implementation
- Menu system
- Plugin loader
- Helper utilities

### **[📄 middleware/README.md](./middleware/README.md)**
- Permission checking
- Admin verification
- Owner verification

### **[📄 config/README.md](./config/README.md)**
- Database configuration
- Connection pooling
- Environment setup

---

## 🗄️ Database Schema

**PostgreSQL Tables:**
- `users` - User profiles and permissions
- `groups` - Group metadata
- `messages` - Message history
- `warnings` - User warning system
- `scheduled_tasks` - Group automation
- `vip_users` - VIP member tracking
- `owner_list` - Bot owners
- `game_sessions` - Active game instances

See [database/README.md](./database/README.md) for detailed schema.

---

## 🌐 API Endpoints

\`\`\`
GET  /health                    # Platform health status
GET  /api/status                # Detailed component status
GET  /api/sessions              # Active sessions
POST /api/send-message          # Send message via API
POST /api/command               # Execute command
\`\`\`

---

## 🔄 Message Flow

\`\`\`
WhatsApp/Telegram Message
        ↓
Session Manager / Connection Handler
        ↓
Message Parser
        ↓
Command Detector
        ↓
Plugin Loader
        ↓
Plugin Execution
        ↓
Response Handler
        ↓
Send Reply
\`\`\`

---

## 🛠️ Technology Stack

| Component | Technology |
|-----------|-----------|
| **Core** | Node.js (ES Modules) |
| **WhatsApp** | Baileys (@whiskeysockets) |
| **Telegram** | node-telegram-bot-api |
| **Database** | PostgreSQL + MongoDB |
| **Web** | Express.js |
| **Media** | FFmpeg, Sharp, Jimp |
| **AI** | Multiple public APIs |
| **Scheduling** | node-cron |
| **Logging** | Pino, Chalk |

---

## 📝 Usage Examples

### **Send a message via WhatsApp**
\`\`\`javascript
const msg = await sock.sendMessage(chatId, { text: "Hello!" })
\`\`\`

### **Send a Telegram message**
\`\`\`javascript
await bot.sendMessage(chatId, "Hello!")
\`\`\`

### **Execute a command**
\`\`\`bash
whatsapp: .menu              # Show main menu
telegram: /menu             # Show main menu
whatsapp: .ytdl <url>      # Download from YouTube
telegram: /ytdl <url>      # Download from YouTube
\`\`\`

### **Game commands**
\`\`\`bash
.tictactoe              # Start tic tac toe
.quiz                   # Start trivia quiz
.rockpaperscissors      # Play rock paper scissors
\`\`\`

---

## 🚀 Deployment

### **Local Development**
\`\`\`bash
npm run dev
\`\`\`

### **Production**
\`\`\`bash
npm start
\`\`\`

### **Docker (Optional)**
\`\`\`bash
docker build -t bot .
docker run -p 3000:3000 bot
\`\`\`

---

## ⚠️ Important Notes

- **lib/buggers/bug.js** is intentionally excluded from documentation
- Keep `.env` file secure and never commit to git
- Database backups are recommended
- Monitor `lib/temp/` directory for cleanup
- Session files are automatically managed in `./sessions`

---

## 🤝 Contributing

1. Create a new plugin in `/plugins/[category]/[command].js`
2. Follow the plugin structure format
3. Add README documentation
4. Test on both platforms
5. Submit PR with description

---

## 📞 Support

For issues:
1. Check the specific folder README
2. Review plugin documentation
3. Check database logs
4. Review error messages in console

---

## 📜 License

MIT License - Feel free to use and modify

---

**Last Updated:** December 2024  
**Platform Version:** 1.0.0  
**Status:** Active Development ✅
