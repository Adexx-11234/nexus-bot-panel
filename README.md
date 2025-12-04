<div align="center">

# 🌐 Nexus Bot Panel

### *Next-Generation WhatsApp & Telegram Automation Platform*

[![Node.js](https://img.shields.io/badge/Node.js-20.x+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://supabase.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Baileys-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![Telegram](https://img.shields.io/badge/Telegram-Bot_API-26A5E4?style=for-the-badge&logo=telegram&logoColor=white)](https://core.telegram.org/bots/api)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

**Enterprise-grade multi-platform bot framework with 80+ commands, AI integration, real-time game engines, and advanced media processing.**

[🚀 Quick Start](#-quick-start) • [📖 Documentation](#-documentation) • [✨ Features](#-features) • [🔌 Plugins](#-plugin-ecosystem) • [🤝 Contribute](#-contributing)

![GitHub stars](https://img.shields.io/github/stars/Adexx-11234/nexus-bot-panel?style=social)
![GitHub forks](https://img.shields.io/github/forks/Adexx-11234/nexus-bot-panel?style=social)
![GitHub issues](https://img.shields.io/github/issues/Adexx-11234/nexus-bot-panel)
![GitHub last commit](https://img.shields.io/github/last-commit/Adexx-11234/nexus-bot-panel)

</div>

---

## 📋 Table of Contents

- [🎯 Overview](#-overview)
- [✨ Key Features](#-key-features)
- [🚀 Quick Start](#-quick-start)
- [📁 Project Architecture](#-project-architecture)
- [🔌 Plugin Ecosystem](#-plugin-ecosystem)
- [🗄️ Database Architecture](#️-database-architecture)
- [🌐 API Reference](#-api-reference)
- [🎮 Game System](#-game-system)
- [🤖 AI Integration](#-ai-integration)
- [📚 Documentation](#-documentation)
- [🛠️ Development](#️-development)
- [🚢 Deployment](#-deployment)
- [🤝 Contributing](#-contributing)

---

## 🎯 Overview

**Nexus Bot Panel** is a production-ready, enterprise-scale automation platform that seamlessly bridges WhatsApp and Telegram into a unified command ecosystem. Built with modern web technologies and scalable architecture.

<table>
<tr>
<td width="50%">

### 🎯 What Makes Nexus Different?

- 🔄 **Unified Platform** - Single codebase, dual platform support
- ⚡ **Lightning Fast** - Optimized connection pooling & caching
- 🧩 **80+ Commands** - Comprehensive feature set out-of-the-box
- 🎨 **Modern UI** - Next.js 14 web dashboard with real-time updates
- 🔐 **Enterprise Security** - Role-based access, VIP system, multi-owner
- 📊 **Production Ready** - Supabase PostgreSQL + MongoDB Atlas
- 🚀 **Auto-Scaling** - Handles thousands of concurrent users
- 🛠️ **Developer Friendly** - Hot-reload, extensive docs, clean code

</td>
<td width="50%">

### 💡 Perfect For

- 📱 Community Management
- 🤖 Customer Support Automation
- 🎮 Interactive Gaming Bots
- 🎬 Media Processing Services
- 🤝 Group Administration
- 📊 Data Collection & Analytics
- 🎯 Marketing Automation
- 💬 AI-Powered Chatbots

</td>
</tr>
</table>

---

## ✨ Key Features

<div align="center">

| 🌐 Platform | 🎮 Games | 🤖 AI | 🎬 Media | 👥 Groups | 👑 Admin |
|:-----------:|:--------:|:-----:|:--------:|:---------:|:--------:|
| WhatsApp ✅ | 8 Games | 10+ Models | 15 Platforms | 40+ Tools | Multi-Owner |
| Telegram ✅ | Real-time | GPT-4, Claude | Converter | Auto-Mod | VIP System |
| Unified API | Multiplayer | Gemini, Llama | Compress | Anti-Spam | Permissions |

</div>

### 🔥 Core Capabilities

<table>
<tr>
<td width="50%">

#### 🌐 **Multi-Platform Mastery**
- WhatsApp Web (Baileys)
- Telegram Bot API
- Cross-platform commands
- Unified session management
- Auto-reconnection
- Message persistence
- Real-time sync

#### 🧩 **Plugin Architecture**
- 80+ pre-built commands
- Hot-reload capability
- Category organization
- Custom middleware
- Command aliases
- Permission layers
- Error boundaries

#### 🎬 **Media Processing Suite**
- YouTube, Instagram, TikTok
- Facebook, Twitter, Spotify
- Pinterest, SoundCloud
- Sticker ↔ Image ↔ Video
- Audio conversion & compression
- FFmpeg integration
- Quality optimization

</td>
<td width="50%">

#### 🤖 **AI Ecosystem**
- GPT-4o & GPT-4o Mini
- Claude Sonnet
- Gemini 1.5 Pro & Flash
- Llama 3.3-70B
- Meta AI
- Copilot (Think Mode)
- Bible AI, Gita AI, Muslim AI
- Flux & Magic Studio (Images)

#### 👥 **Group Management**
- Role-based permissions
- Auto-moderation (spam, links)
- Warning system (3-strike)
- Member approval workflow
- Welcome/Goodbye messages
- Anti-delete & anti-viewonce
- Tag system (all, admins, online)

#### 🔐 **Security & Access**
- Multi-owner system
- VIP membership tiers
- Admin verification
- Rate limiting
- Session encryption
- Database security
- API authentication

</td>
</tr>
</table>

---

## 🚀 Quick Start

### Prerequisites

```bash
✅ Node.js >= 18.x (20.x recommended)
✅ PostgreSQL (Supabase account)
✅ MongoDB (Atlas account)
✅ FFmpeg (for media processing)
✅ Git
```

### Installation

```bash
# 1️⃣ Clone the repository
git clone https://github.com/Adexx-11234/nexus-bot-panel.git
cd nexus-bot-panel

# 2️⃣ Install dependencies
npm install

# 3️⃣ Configure environment (see below)
cp .env.example .env
# Edit .env with your credentials

# 4️⃣ Run database migrations
npm run migrate

# 5️⃣ Start the bot
npm start

# 🔧 For development with hot-reload
npm run dev
```

### Environment Setup

Create a `.env` file in the root directory:

```env
# ==================== DATABASE ====================
# PostgreSQL (Supabase) - Primary data storage
DATABASE_URL=postgresql://postgres.xxxxx:password@aws-1-eu-north-1.pooler.supabase.com:6543/postgres

# MongoDB (Atlas) - Session & cache storage
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority

# ==================== SERVER ====================
PORT=3000
NODE_ENV=development
CACHE_TTL=3600
SESSION_TIMEOUT=86400000

# ==================== WHATSAPP ====================
WA_SESSION_TIMEOUT=300000
WA_RECONNECT_INTERVAL=5000
WHATSAPP_CHANNEL_JID=120363422827915475@newsletter
BAILEYS_LOG_LEVEL=silent
SUPPRESS_LIBRARY_LOGS=true
ENABLE_515_FLOW=true

# ==================== TELEGRAM ====================
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
DEFAULT_ADMIN_ID=your_telegram_id

# ==================== LOGGING ====================
LOG_FILE=logs/app.log
LOG_LEVEL=info

# ==================== ADMIN ====================
ADMIN_PASSWORD=admin123

# ==================== AI KEYS (Optional) ====================
# GEMINI_API_KEY=your_key
# OPENAI_API_KEY=your_key
# ANTHROPIC_API_KEY=your_key
```

> ⚠️ **Security Warning:** Never commit your `.env` file! Add it to `.gitignore` immediately.

### 🎉 Verify Installation

```bash
# Health check
curl http://localhost:3000/health

# Detailed status
curl http://localhost:3000/api/status
```

---

## 📁 Project Architecture

### Directory Structure

```
📦 nexus-bot-panel/
│
├── 🚀 index.js                      # Application Entry Point
├── 📋 package.json                  # Dependencies & Scripts
├── 🔐 .env                          # Environment Config
│
├── 📂 app/                          # Next.js Web Dashboard
│   ├── layout.tsx
│   ├── page.tsx
│   └── api/
│
├── 📂 components/                   # React Components
│   ├── ui/                          # shadcn/ui Components
│   └── theme-provider.tsx
│
├── 📂 database/                     # Database Layer
│   ├── connection.js
│   ├── db.js
│   ├── query.js
│   └── migrations/
│       ├── 001_init.sql
│       ├── 002_complete_schema.sql
│       └── run-migrations.js
│
├── 📂 lib/                          # Core Libraries
│   ├── ai/                          # AI Integration
│   ├── converters/                  # Media Conversion
│   ├── downloaders/                 # Platform Downloaders
│   ├── game managers/               # Game Engines
│   └── utils.ts
│
├── 📂 plugins/                      # Plugin System
│   ├── mainmenu/                    # Core Commands (8)
│   ├── groupmenu/                   # Group Admin (40+)
│   ├── downloadmenu/                # Downloads (15)
│   ├── convertmenu/                 # Conversions (10)
│   ├── gamemenu/                    # Games (8)
│   ├── aimenu/                      # AI Features
│   ├── ownermenu/                   # Owner Tools (15)
│   └── bugmenu/                     # System Utils (5)
│
├── 📂 whatsapp/                     # WhatsApp Module
│   ├── index.js
│   ├── session-manager.js
│   └── command-handler.js
│
├── 📂 telegram/                     # Telegram Module
│   ├── index.js
│   └── connection-handler.js
│
├── 📂 middleware/                   # Middleware
│   └── admin-check.js
│
├── 📂 utils/                        # Utilities
│   ├── logger.js
│   ├── menu-system.js
│   └── plugin-loader.js
│
├── 📂 config/                       # Configuration
│   └── database.js
│
├── 📂 web/                          # HTTP Server
│   └── index.js
│
└── 📂 logs/                         # Application Logs
    └── app.log
```

### Message Flow

```
User Message → Platform Handler → Session Manager → Message Parser
    ↓
Command Detector → Plugin Loader → Permission Check → Execute
    ↓
Response Builder → Platform Router → User Receives
```

---

## 🔌 Plugin Ecosystem

### Plugin Structure

```javascript
export default {
  name: "commandname",
  commands: ["cmd", "alias1"],
  description: "Command description",
  usage: ".cmd <args>",
  adminOnly: false,
  ownerOnly: false,
  
  async execute(sock, sessionId, args, m) {
    try {
      // Your logic here
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};
```

### Plugin Categories

| Category | Commands | Description | Docs |
|----------|----------|-------------|------|
| **Main Menu** | 8 | Core commands & info | [📖](./plugins/mainmenu/README.md) |
| **Group Menu** | 40+ | Group administration | [📖](./plugins/groupmenu/README.md) |
| **Download Menu** | 15 | Media downloads | [📖](./plugins/downloadmenu/README.md) |
| **Convert Menu** | 10 | Format conversion | [📖](./plugins/convertmenu/README.md) |
| **Game Menu** | 8 | Interactive games | [📖](./plugins/gamemenu/README.md) |
| **AI Menu** | 10+ | AI features | [📖](./plugins/aimenu/README.md) |
| **Owner Menu** | 15 | Owner tools | [📖](./plugins/ownermenu/README.md) |
| **Bug Menu** | 5 | System utilities | [📖](./plugins/bugmenu/README.md) |

### Quick Command Reference

```bash
# Main
.menu               # Show menu
.help               # Get help
.ping               # Check latency

# Group
.add @user          # Add member
.kick @user         # Remove member
.warn @user         # Warn user
.antilink on        # Enable anti-link

# Downloads
.ytdl <url>         # YouTube
.igdl <url>         # Instagram
.tiktokdl <url>     # TikTok

# Conversions
.sticker            # Create sticker
.toimage            # Convert to image
.toaudio            # Extract audio

# Games
.tictactoe @user    # Tic Tac Toe
.quiz               # Trivia
.rps                # Rock Paper Scissors

# AI
.gpt4 <prompt>      # GPT-4
.gemini <prompt>    # Gemini
.flux <prompt>      # AI image
```

---

## 🗄️ Database Architecture

### Schema Overview

Nexus uses hybrid database architecture:
- **PostgreSQL (Supabase)** - Structured data, relations
- **MongoDB (Atlas)** - Sessions, cache, temporary data

### Core Tables

#### **Users Table**
```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  first_name VARCHAR(255),
  username VARCHAR(255),
  is_admin BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### **WhatsApp Users Table**
```sql
CREATE TABLE whatsapp_users (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  jid VARCHAR(255),
  phone VARCHAR(50),
  name VARCHAR(255),
  bot_mode VARCHAR(20) DEFAULT 'public',
  custom_prefix VARCHAR(10) DEFAULT '.',
  vip_level INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### **Groups Table**
```sql
CREATE TABLE groups (
  id BIGSERIAL PRIMARY KEY,
  jid VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  antilink_enabled BOOLEAN DEFAULT FALSE,
  antispam_enabled BOOLEAN DEFAULT FALSE,
  autowelcome_enabled BOOLEAN DEFAULT FALSE,
  warning_limit INTEGER DEFAULT 4,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### **Messages Table**
```sql
CREATE TABLE messages (
  n_o BIGSERIAL PRIMARY KEY,
  id VARCHAR(255) NOT NULL,
  from_jid VARCHAR(255) NOT NULL,
  sender_jid VARCHAR(255) NOT NULL,
  content TEXT,
  timestamp BIGINT NOT NULL,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### **Warnings Table**
```sql
CREATE TABLE warnings (
  id BIGSERIAL PRIMARY KEY,
  user_jid VARCHAR(255) NOT NULL,
  group_jid VARCHAR(255) NOT NULL,
  warning_type VARCHAR(50) NOT NULL,
  warning_count INTEGER DEFAULT 1,
  last_warning_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### **Spam Tracking Table**
```sql
CREATE TABLE spam_tracking (
  id BIGSERIAL PRIMARY KEY,
  group_jid VARCHAR(255) NOT NULL,
  user_jid VARCHAR(255) NOT NULL,
  message_text TEXT,
  links JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Auto-Cleanup Features

- **Messages**: Auto-cleanup at 10k rows → keeps newest 5k
- **Spam Tracking**: Auto-cleanup after 2 hours
- **JID Transfer**: Automatic when phone number moves to new account

### Migration System

```bash
# Run migrations
npm run migrate

# Create new migration
npm run migrate:create feature_name

# Rollback
npm run migrate:rollback
```

---

## 🌐 API Reference

### REST Endpoints

#### **GET /health**
Platform health status

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "uptime": 86400,
  "version": "1.0.0"
}
```

#### **GET /api/status**
Detailed component status

```bash
curl http://localhost:3000/api/status
```

Response:
```json
{
  "database": "connected",
  "whatsapp": "active",
  "telegram": "active",
  "plugins": 82,
  "sessions": 5
}
```

#### **POST /api/send-message**
Send message via API

```bash
curl -X POST http://localhost:3000/api/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "whatsapp",
    "chatId": "1234567890@s.whatsapp.net",
    "message": "Hello from API!"
  }'
```

---

## 🎮 Game System

### Available Games

| Game | Players | Description |
|------|---------|-------------|
| **Tic Tac Toe** | 2 | Classic grid game |
| **Rock Paper Scissors** | 2+ | Hand game with variants |
| **Trivia Quiz** | 1+ | 10K+ questions |
| **Math Challenge** | 1+ | Speed math |
| **Word Guessing** | 1+ | Hangman style |
| **Number Guessing** | 1 | Guess 1-100 |
| **Reaction Speed** | 1+ | Test reflexes |
| **Memory Game** | 1+ | Remember sequence |

### Game Commands

```bash
.tictactoe @user    # Start game
.move 5             # Make move
.answer B           # Answer question
.endgame            # End game
.leaderboard        # View scores
```

---

## 🤖 AI Integration

### Supported Models

| Provider | Model | Command |
|----------|-------|---------|
| **OpenAI** | GPT-4o | `.gpt4` |
| **OpenAI** | GPT-4o Mini | `.gpt` |
| **Anthropic** | Claude Sonnet | `.claude` |
| **Google** | Gemini 1.5 Pro | `.gemini` |
| **Google** | Gemini Flash | `.geminilite` |
| **Meta** | Llama 3.3-70B | `.llama` |
| **Microsoft** | Copilot | `.copilot` |
| **Specialized** | Bible AI | `.bibleai` |
| **Specialized** | Gita AI | `.gitaai` |
| **Specialized** | Muslim AI | `.muslim` |

### Image Generation

```bash
.flux <prompt>           # Flux AI
.magicstudio <prompt>    # Magic Studio
```

---

## 📚 Documentation

Comprehensive module documentation:

- [📦 Database System](./database/README.md)
- [🛠️ Core Libraries](./lib/README.md)
- [🔌 Plugin System](./plugins/README.md)
- [👥 Group Management](./plugins/groupmenu/README.md)
- [⬇️ Downloads](./plugins/downloadmenu/README.md)
- [🔄 Conversions](./plugins/convertmenu/README.md)
- [🎮 Games](./plugins/gamemenu/README.md)
- [🤖 AI Integration](./plugins/aimenu/README.md)
- [👑 Owner Commands](./plugins/ownermenu/README.md)
- [💬 WhatsApp Module](./whatsapp/README.md)
- [✈️ Telegram Module](./telegram/README.md)

---

## 🛠️ Development

### Development Mode

```bash
npm run dev          # Hot-reload
npm test             # Run tests
npm run lint         # Check style
```

### Tech Stack

| Component | Technology |
|-----------|-----------|
| **Runtime** | Node.js 20+ |
| **WhatsApp** | Baileys |
| **Telegram** | node-telegram-bot-api |
| **Database** | PostgreSQL + MongoDB |
| **Web** | Next.js 14 + Express |
| **UI** | shadcn/ui |
| **Media** | FFmpeg, Sharp |
| **Logging** | Pino |

---

## 🚢 Deployment

### Production

```bash
npm start
```

### Docker

```bash
docker build -t nexus-bot .
docker run -p 3000:3000 nexus-bot
```

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open Pull Request

### Guidelines

- Add tests for new features
- Update documentation
- Follow existing code style
- Test on both platforms

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file

---

<div align="center">

### 📞 Support & Community

[![Issues](https://img.shields.io/badge/🐛-Report_Bug-red?style=for-the-badge)](https://github.com/Adexx-11234/nexus-bot-panel/issues)
[![Discussions](https://img.shields.io/badge/💬-Discussions-green?style=for-the-badge)](https://github.com/Adexx-11234/nexus-bot-panel/discussions)

**Made with ❤️ by the community**

⭐ Star this repo if you find it useful!

**Version:** 1.0.0 | **Status:** 🟢 Active Development

</div>