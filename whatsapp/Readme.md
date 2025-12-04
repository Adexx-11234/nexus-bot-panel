# 💬 WhatsApp Module Documentation

Baileys-based WhatsApp Web automation and message handling.

---

## 📋 Overview

The WhatsApp module provides:
- Multi-session management
- Message receiving and sending
- Group management
- User identification
- Media handling
- Connection lifecycle

---

## 🔌 Core Components

**File:** `/whatsapp/index.js`
- Main module initialization
- Quick setup function
- Session management

**File:** `/whatsapp/session-manager.js`
- Active socket management
- Session persistence
- Connection pooling

**File:** `/whatsapp/command-handler.js`
- Message parsing
- Command routing
- Plugin execution

---

## 🔄 Message Flow

\`\`\`
WhatsApp Message
    ↓
Baileys receives
    ↓
Session Manager processes
    ↓
Message Parser extracts data
    ↓
Command Detector identifies command
    ↓
Plugin system executes
    ↓
Response formatter
    ↓
Send reply via Baileys
\`\`\`

---

## 📱 Session Management

\`\`\`javascript
// Get active sessions
const sessions = sessionManager.activeSockets

// Create new session
const sock = await sessionManager.addSession(sessionId)

// Remove session
await sessionManager.removeSession(sessionId)

// Get session info
const info = sessionManager.getSessionInfo(sessionId)
\`\`\`

---

## 📝 See Complete Sections

See individual folder READMEs for:
- [Telegram Integration](./telegram/README.md)
- [Database Operations](./database/README.md)
- [Utilities](./utils/README.md)
- [Configuration](./config/README.md)

---
