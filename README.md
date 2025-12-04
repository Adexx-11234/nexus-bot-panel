<p align="center">
  <a href="https://github.com/Adexx-11234/nexus-bot-panel">
    <img alt="Nexus Bot" height="300" src="./Defaults/images/menu.png">
  </a>
</p>

<h1 align="center">NEXUS BOT</h1>
<h3 align="center">Multi-Device WhatsApp Bot with Telegram & Web Integration</h3>

<p align="center">
  <em>A powerful multi-session WhatsApp bot platform with Telegram control interface and web dashboard</em>
</p>

---

<p align="center">
  <a href="https://github.com/Adexx-11234/nexus-bot-panel">
    <img title="Author" src="https://img.shields.io/badge/Author-NEXUS TECH-purple?style=for-the-badge&logo=github">
  </a>
  <a href="https://whatsapp.com/channel/YOUR_CHANNEL">
    <img title="WhatsApp Channel" src="https://img.shields.io/badge/CHANNEL-25D366?style=for-the-badge&logo=whatsapp&logoColor=white">
  </a>
  <a href="https://t.me/YOUR_BOT">
    <img title="Telegram Bot" src="https://img.shields.io/badge/TELEGRAM BOT-0088cc?style=for-the-badge&logo=telegram&logoColor=white">
  </a>
</p>

<p align="center">
  <a href="https://github.com/Adexx-11234/nexus-bot-panel/stargazers">
    <img title="Stars" src="https://img.shields.io/github/stars/Adexx-11234/nexus-bot-panel?style=social">
  </a>
  <a href="https://github.com/Adexx-11234/nexus-bot-panel/network/members">
    <img title="Forks" src="https://img.shields.io/github/forks/Adexx-11234/nexus-bot-panel?style=social">
  </a>
  <a href="https://github.com/Adexx-11234/nexus-bot-panel/watchers">
    <img title="Watching" src="https://img.shields.io/github/watchers/Adexx-11234/nexus-bot-panel?label=Watchers&style=social">
  </a>
  <a href="https://github.com/Adexx-11234?tab=followers">
    <img title="Followers" src="https://img.shields.io/github/followers/Adexx-11234?label=Followers&style=social">
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white">
  <img src="https://img.shields.io/badge/PostgreSQL-14+-4169E1?style=flat-square&logo=postgresql&logoColor=white">
  <img src="https://img.shields.io/badge/MongoDB-6+-47A248?style=flat-square&logo=mongodb&logoColor=white">
  <img src="https://img.shields.io/badge/License-Private-red?style=flat-square">
  <img src="https://img.shields.io/badge/WhatsApp-Multi--Device-25D366?style=flat-square&logo=whatsapp&logoColor=white">
</p>

---

## GET YOUR SESSION

<p align="center">
  <a href="YOUR_WEB_SESSION_URL">
    <img title="Get Session via Web" src="https://img.shields.io/badge/GET SESSION (WEB)-purple?style=for-the-badge&logo=google-chrome&logoColor=white" width="220" height="40">
  </a>
  &nbsp;&nbsp;
  <a href="https://t.me/YOUR_BOT">
    <img title="Get Session via Telegram" src="https://img.shields.io/badge/GET SESSION (TELEGRAM)-0088cc?style=for-the-badge&logo=telegram&logoColor=white" width="250" height="40">
  </a>
</p>

---

## DEPLOYMENT OPTIONS

| Platform | Deploy |
|:--------:|:------:|
| **Heroku** | [![Deploy on Heroku](https://img.shields.io/badge/Deploy-Heroku-430098?style=for-the-badge&logo=heroku&logoColor=white)](https://dashboard.heroku.com/new?template=https://github.com/Adexx-11234/nexus-bot-panel) |
| **Render** | [![Deploy on Render](https://img.shields.io/badge/Deploy-Render-46E3B7?style=for-the-badge&logo=render&logoColor=white)](https://render.com/deploy?repo=https://github.com/Adexx-11234/nexus-bot-panel) |
| **Koyeb** | [![Deploy on Koyeb](https://img.shields.io/badge/Deploy-Koyeb-121212?style=for-the-badge&logo=koyeb&logoColor=white)](https://app.koyeb.com/deploy?type=git&repository=github.com/Adexx-11234/nexus-bot-panel) |
| **Railway** | [![Deploy on Railway](https://img.shields.io/badge/Deploy-Railway-0B0D0E?style=for-the-badge&logo=railway&logoColor=white)](https://railway.app/new/template?template=https://github.com/Adexx-11234/nexus-bot-panel) |
| **Replit** | [![Run on Replit](https://img.shields.io/badge/Run-Replit-F26207?style=for-the-badge&logo=replit&logoColor=white)](https://replit.com/github/Adexx-11234/nexus-bot-panel) |

---

## TABLE OF CONTENTS

- [Architecture](#-architecture)
- [Session Creation](#-session-creation)
- [Features](#-features)
- [Database Architecture](#-database-architecture)
- [Environment Variables](#-environment-variables)
- [Plugin System](#-plugin-system)
- [Folder Structure](#-folder-structure)
- [API Endpoints](#-api-endpoints)
- [Installation](#-installation)
- [Contributing](#-contributing)

---

## ARCHITECTURE

\`\`\`
┌─────────────────────────────────────────────────────────────────────────────┐
│                           NEXUS BOT PLATFORM                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐         │
│   │    TELEGRAM      │  │       WEB        │  │    WHATSAPP      │         │
│   │      BOT         │  │   INTERFACE      │  │    SESSIONS      │         │
│   │                  │  │                  │  │                  │         │
│   │  • /start        │  │  • Register      │  │  • Multi-Device  │         │
│   │  • /session      │  │  • Login         │  │  • Pairing Code  │         │
│   │  • Pairing Code  │  │  • Dashboard     │  │  • Auto-Reconnect│         │
│   └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘         │
│            │                     │                     │                    │
│            └─────────────────────┼─────────────────────┘                    │
│                                  │                                          │
│                     ┌────────────▼────────────┐                             │
│                     │    SESSION MANAGER      │                             │
│                     │  (Singleton Pattern)    │                             │
│                     │                         │                             │
│                     │  • Multi-Session        │                             │
│                     │  • State Management     │                             │
│                     │  • Auto-Reconnection    │                             │
│                     └────────────┬────────────┘                             │
│                                  │                                          │
│            ┌─────────────────────┼─────────────────────┐                    │
│            │                     │                     │                    │
│   ┌────────▼────────┐   ┌────────▼────────┐   ┌────────▼────────┐          │
│   │    MONGODB      │   │   POSTGRESQL    │   │     PLUGIN      │          │
│   │                 │   │                 │   │     SYSTEM      │          │
│   │  • Auth State   │   │  • Users        │   │                 │          │
│   │  • Pre-Keys     │   │  • Groups       │   │  • 130+ Plugins │          │
│   │  • Identity     │   │  • Messages     │   │  • Hot-Reload   │          │
│   │  • App Sync     │   │  • VIP Data     │   │  • Categories   │          │
│   └─────────────────┘   └─────────────────┘   └─────────────────┘          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
\`\`\`

---

## SESSION CREATION

Users can create WhatsApp sessions through **two methods**:

### Method 1: Via Telegram Bot

\`\`\`
┌────────────────────────────────────────────────────────────┐
│  1. Send /start to the Telegram bot                        │
│                         ↓                                  │
│  2. Click "Connect WhatsApp" button                        │
│                         ↓                                  │
│  3. Enter phone number (with country code: +234...)        │
│                         ↓                                  │
│  4. Receive 8-digit pairing code from bot                  │
│                         ↓                                  │
│  5. Open WhatsApp → Settings → Linked Devices              │
│     → Link a Device → Link with Phone Number               │
│                         ↓                                  │
│  6. Enter pairing code in WhatsApp                         │
│                         ↓                                  │
│  7. Session created! Stored as session_{telegram_id}       │
└────────────────────────────────────────────────────────────┘
\`\`\`

### Method 2: Via Web Dashboard

\`\`\`
┌────────────────────────────────────────────────────────────┐
│  1. Visit web dashboard: http://your-domain:3000           │
│                         ↓                                  │
│  2. Register/Login with phone number & password            │
│                         ↓                                  │
│  3. Click "Create New Session" from dashboard              │
│                         ↓                                  │
│  4. Receive pairing code on screen                         │
│                         ↓                                  │
│  5. Enter code in WhatsApp (same as Telegram method)       │
│                         ↓                                  │
│  6. Session created! Stored as session_{web_user_id}       │
└────────────────────────────────────────────────────────────┘
\`\`\`

---

## FEATURES

<table>
<tr>
<td width="50%">

### Bot Core Features
| Feature | Description |
|:--------|:------------|
| Multi-Device | Full WhatsApp Multi-Device support |
| Multi-Session | Handle multiple WhatsApp accounts |
| Auto-Reconnect | Automatic reconnection on disconnect |
| Session Persistence | Sessions stored in MongoDB |
| Hot-Reload Plugins | Update plugins without restart |
| Custom Prefix | Per-user command prefix |
| Bot Modes | Public or Self mode |

</td>
<td width="50%">

### Group Management
| Feature | Description |
|:--------|:------------|
| Anti-Link | Delete messages with links |
| Anti-Spam | Detect repeated messages |
| Anti-Bot | Prevent bots from joining |
| Anti-Promote | Reverse unauthorized promotions |
| Anti-Demote | Reverse unauthorized demotions |
| Anti-Delete | Log deleted messages |
| Anti-ViewOnce | Save view-once media |
| Scheduled Open/Close | Auto open/close groups |

</td>
</tr>
<tr>
<td width="50%">

### Media & Downloads
| Feature | Description |
|:--------|:------------|
| YouTube | Download videos & audio |
| TikTok | Download without watermark |
| Instagram | Reels, posts, stories |
| Spotify | Download tracks |
| Stickers | Create from image/video |
| Converters | Audio, video, document |

</td>
<td width="50%">

### VIP System
| Feature | Description |
|:--------|:------------|
| VIP Levels | 0 (normal) to 99 (admin) |
| Group Takeover | Control owned users' groups |
| Multi-Account | Manage multiple sessions |
| VIP Commands | Exclusive features |
| Activity Logging | Track VIP actions |

</td>
</tr>
</table>

---

## DATABASE ARCHITECTURE

### PostgreSQL (Primary Database)

| Table | Description |
|:------|:------------|
| `users` | Telegram users and web users |
| `web_users_auth` | Password hashes for web authentication |
| `whatsapp_users` | User settings, bot mode, prefix, anti-features |
| `groups` | Group settings and anti-features configuration |
| `messages` | Message history (auto-cleanup at 10k rows) |
| `warnings` | User warnings in groups |
| `violations` | Recorded anti-feature violations |
| `spam_tracking` | Real-time spam detection (auto-cleanup 2hrs) |
| `vip_owned_users` | VIP ownership relationships |
| `vip_activity_log` | VIP action history |

### MongoDB (Session Authentication)

| Collection | Description |
|:-----------|:------------|
| `sessions` | WhatsApp Baileys authentication state |
| `pre_keys` | Pre-keys for encryption |
| `identity_keys` | Identity keys |
| `app_state_sync` | App state synchronization data |

---

## ENVIRONMENT VARIABLES

\`\`\`env
# ═══════════════════════════════════════════════════════════
# SERVER CONFIGURATION
# ═══════════════════════════════════════════════════════════
PORT=3000
NODE_ENV=development

# ═══════════════════════════════════════════════════════════
# DATABASE CONFIGURATION
# ═══════════════════════════════════════════════════════════
DATABASE_URL=postgresql://user:password@host:5432/database
MONGODB_URI=mongodb://localhost:27017/whatsapp_bot

# ═══════════════════════════════════════════════════════════
# TELEGRAM BOT
# ═══════════════════════════════════════════════════════════
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
DEFAULT_ADMIN_ID=your_telegram_user_id
ADMIN_PASSWORD=your_admin_password

# ═══════════════════════════════════════════════════════════
# WEB INTERFACE
# ═══════════════════════════════════════════════════════════
JWT_SECRET=your-jwt-secret-key

# ═══════════════════════════════════════════════════════════
# WHATSAPP SETTINGS
# ═══════════════════════════════════════════════════════════
WHATSAPP_CHANNEL_JID=your_channel_jid
SESSION_ENCRYPTION_KEY=your-encryption-key
ENABLE_515_FLOW=false

# ═══════════════════════════════════════════════════════════
# OPTIONAL SETTINGS
# ═══════════════════════════════════════════════════════════
SUPPRESS_LIBRARY_LOGS=true
PLUGIN_AUTO_RELOAD=true
BAILEYS_LOG_LEVEL=silent
MONITORING_TELEGRAM_ID=your_telegram_id
\`\`\`

---

## PLUGIN SYSTEM

### Plugin Categories

| Category | Description | Example Commands |
|:---------|:------------|:-----------------|
| **mainmenu** | Core bot commands | `menu`, `ping`, `help`, `allmenu` |
| **groupmenu** | Group management | `antilink`, `kick`, `promote`, `warn`, `mute` |
| **downloadmenu** | Media downloaders | `ytdl`, `igdl`, `tiktokdl`, `spotify` |
| **gamemenu** | Interactive games | `trivia`, `quiz`, `tictactoe`, `wordguess` |
| **aimenu** | AI-powered features | `ai`, `chat`, `imagine` |
| **ownermenu** | Bot owner commands | `mode`, `setprefix`, `block`, `antidelete` |
| **convertmenu** | Media conversion | `sticker`, `toimage`, `tomp3`, `togif` |
| **bugmenu** | Testing tools | Various crash tests |
| **vipmenu** | VIP management | `viptakeover`, `viplist`, `vipadd` |

### Plugin Structure

\`\`\`javascript
export default {
    name: "commandname",
    description: "Command description",
    commands: ["cmd", "alias1", "alias2"],
    category: "category",
    adminOnly: false,    // Requires group admin
    ownerOnly: false,    // Requires bot owner
    groupOnly: false,    // Only works in groups
  
    async execute(sock, sessionId, args, m) {
        // Command logic here
        await sock.sendMessage(m.key.remoteJid, {
            text: "Hello from plugin!"
        });
    }
}
\`\`\`

### Auto Anti-Features Plugin

\`\`\`javascript
export default {
    name: "antilink",
    
    async processMessage(sock, sessionId, m, messageText) {
        // Automatically processes every message
        // Check for links, spam, etc.
    }
}
\`\`\`

---

## FOLDER STRUCTURE

\`\`\`
nexusbot/
│
├── 📄 index.js                      # Main entry point
├── 📄 package.json                  # Dependencies
├── 📄 README.md                     # Documentation
│
├── 📁 config/
│   ├── 📄 database.js               # PostgreSQL configuration
│   ├── 📄 telegram.js               # Telegram bot config
│   ├── 📄 baileys.js                # WhatsApp/Baileys config
│   └── 📄 constant.js               # App constants
│
├── 📁 database/
│   ├── 📄 index.js                  # Database connection
│   ├── 📄 query.js                  # Database queries
│   ├── 📄 groupscheduler.js         # Scheduled group actions
│   ├── 📄 vip.js                    # VIP subscription logic
│   └── 📁 migrations/
│       └── 📄 001_init.sql          # Initial schema
│
├── 📁 Defaults/
│   └── 📁 images/
│       └── 📄 menu.png              # Menu display image
│
├── 📁 telegram/
│   ├── 📄 index.js                  # Telegram bot entry
│   ├── 📁 core/                     # Bot initialization
│   ├── 📁 handlers/
│   │   ├── 📄 connection.js         # Session creation handler
│   │   └── 📄 commands.js           # Telegram commands
│   ├── 📁 middleware/
│   │   └── 📄 admin.js              # Auth middleware
│   └── 📁 ui/                       # Messages & keyboards
│
├── 📁 whatsapp/
│   ├── 📄 index.js                  # WhatsApp entry
│   ├── 📁 core/                     # Baileys socket
│   ├── 📁 sessions/
│   │   ├── 📄 index.js              # Session exports
│   │   ├── 📄 manager.js            # Session lifecycle
│   │   └── 📄 handlers.js           # Session handlers
│   ├── 📁 storage/
│   │   ├── 📄 index.js              # Storage exports
│   │   ├── 📄 mongodb.js            # MongoDB storage
│   │   └── 📄 coordinator.js        # Storage coordinator
│   ├── 📁 events/
│   │   ├── 📄 index.js              # Event router
│   │   ├── 📄 connection.js         # Connection events
│   │   └── 📄 messages.js           # Message handling
│   ├── 📁 groups/                   # Group management
│   ├── 📁 messages/                 # Message processing
│   └── 📁 utils/
│       └── 📄 vip-helper.js         # VIP utilities
│
├── 📁 web/
│   ├── 📄 index.js                  # Express server
│   ├── 📁 routes/
│   │   ├── 📄 auth.js               # Authentication routes
│   │   └── 📄 session.js            # Session management
│   ├── 📁 controllers/
│   │   └── 📄 session-controller.js # Request handlers
│   ├── 📁 services/                 # Business logic
│   ├── 📁 middleware/
│   │   └── 📄 auth.js               # JWT middleware
│   └── 📁 views/                    # HTML templates
│
├── 📁 plugins/                      # 130+ Bot plugins
│   ├── 📁 mainmenu/                 # Core commands
│   ├── 📁 groupmenu/                # Group management
│   ├── 📁 downloadmenu/             # Media downloaders
│   ├── 📁 gamemenu/                 # Games
│   ├── 📁 aimenu/                   # AI features
│   ├── 📁 ownermenu/                # Owner commands
│   ├── 📁 convertmenu/              # Converters
│   ├── 📁 bugmenu/                  # Testing tools
│   └── 📁 vipmenu/                  # VIP features
│
├── 📁 utils/
│   ├── 📄 plugin-loader.js          # Dynamic plugin loader
│   ├── 📄 menu-system.js            # Menu generation
│   ├── 📄 permission-system.js      # Permission management
│   └── 📄 logger.js                 # Logging utility
│
└── 📁 lib/
    ├── 📁 ai/                       # AI integrations
    ├── 📁 downloaders/              # Media download utilities
    ├── 📁 converters/               # Media conversion
    └── 📁 buggers/                  # Bug/Crash generators
\`\`\`

---

## API ENDPOINTS

### Health & Status

| Method | Endpoint | Description |
|:------:|:---------|:------------|
| `GET` | `/health` | Server health check |
| `GET` | `/api/status` | Platform status with session count |

### Authentication (Web)

| Method | Endpoint | Description |
|:------:|:---------|:------------|
| `POST` | `/auth/register` | Register new web user |
| `POST` | `/auth/login` | Login existing user |
| `POST` | `/auth/logout` | Logout |
| `GET` | `/auth/verify` | Verify JWT token |

### Sessions (Web - Authenticated)

| Method | Endpoint | Description |
|:------:|:---------|:------------|
| `GET` | `/api/sessions/status` | Get session status |
| `POST` | `/api/sessions/create` | Create new session |
| `GET` | `/api/sessions/pairing-code` | Get pairing code |
| `POST` | `/api/sessions/disconnect` | Disconnect session |
| `POST` | `/api/sessions/reconnect` | Reconnect session |
| `GET` | `/api/sessions/stats` | Get session statistics |

---

## INSTALLATION

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- MongoDB 6+
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))

### Quick Start

\`\`\`bash
# Clone the repository
git clone https://github.com/Adexx-11234/nexus-bot-panel.git

# Navigate to directory
cd nexus-bot-panel

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
# Edit .env with your values

# Run database migrations
npm run migrate

# Start the bot
npm start
\`\`\`

### Production (PM2)

\`\`\`bash
# Install PM2 globally
npm install -g pm2

# Start with PM2
pm2 start index.js --name nexusbot

# Auto-restart on reboot
pm2 startup
pm2 save

# View logs
pm2 logs nexusbot
\`\`\`

---

## INITIALIZATION SEQUENCE

\`\`\`
1. Database Connection     →  Connect to PostgreSQL with retry logic
         ↓
2. Migrations              →  Run database schema migrations
         ↓
3. Plugin Loading          →  Load all plugins with hot-reload support
         ↓
4. Telegram Bot            →  Initialize Telegram bot for user control
         ↓
5. WhatsApp Module         →  Initialize session manager and storage
         ↓
6. VIP Initialization      →  Set up default VIP from environment
         ↓
7. Group Scheduler         →  Start automated group open/close scheduler
         ↓
8. HTTP Server             →  Start Express server for web interface
\`\`\`

---

## SESSION STATES

| State | Description |
|:------|:------------|
| `initializing` | Session being created |
| `connecting` | Connecting to WhatsApp |
| `connected` | Active and ready |
| `disconnected` | Logged out or closed |
| `reconnecting` | Attempting to reconnect |

---

## BOT MODES

| Mode | Description | Command |
|:-----|:------------|:--------|
| `public` | Bot responds to everyone (default) | `.mode public` |
| `self` | Bot only responds to the owner | `.mode self` |

---

## CONTRIBUTING

We welcome contributions! Here's how:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **Commit** your changes: `git commit -m 'Add amazing feature'`
4. **Push** to branch: `git push origin feature/amazing-feature`
5. **Open** a Pull Request

---

## SUPPORT

<p align="center">
  <a href="https://whatsapp.com/channel/YOUR_CHANNEL">
    <img title="WhatsApp Channel" src="https://img.shields.io/badge/WhatsApp Channel-25D366?style=for-the-badge&logo=whatsapp&logoColor=white">
  </a>
  <a href="https://t.me/YOUR_SUPPORT_GROUP">
    <img title="Telegram Group" src="https://img.shields.io/badge/Telegram Support-0088cc?style=for-the-badge&logo=telegram&logoColor=white">
  </a>
  <a href="https://github.com/Adexx-11234/nexus-bot-panel/issues">
    <img title="GitHub Issues" src="https://img.shields.io/badge/GitHub Issues-181717?style=for-the-badge&logo=github&logoColor=white">
  </a>
</p>

---

## LICENSE

**Private** - All Rights Reserved

---

<p align="center">
  <img src="https://img.shields.io/badge/Made%20with-Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white">
  <img src="https://img.shields.io/badge/Powered%20by-Baileys-25D366?style=for-the-badge&logo=whatsapp&logoColor=white">
</p>

<p align="center">
  <strong>If you found this project helpful, please give it a star!</strong>
</p>

<p align="center">
  <sub>Built with passion by the Nexus Team</sub>
</p>
