# 🔌 Plugins Module Documentation

The plugin system provides modular, extensible command handling across all categories.

---

## 📋 Table of Contents

- [Plugin Architecture](#plugin-architecture)
- [Plugin Structure](#plugin-structure)
- [Plugin Lifecycle](#plugin-lifecycle)
- [Command Categories](#command-categories)
- [Message Handling](#message-handling)

---

## 🏗️ Plugin Architecture

**File:** `/utils/plugin-loader.js`

The plugin system automatically:
1. Scans `/plugins` directory
2. Loads all `.js` files
3. Registers commands
4. Routes messages to correct handler
5. Handles errors gracefully

\`\`\`javascript
// Auto-load all plugins on startup
await pluginLoader.loadPlugins()

// Execute command
const result = await pluginLoader.executeCommand(
  commandName,
  sock,
  sessionId,
  args,
  message
)
\`\`\`

---

## 📦 Plugin Structure

Every plugin must export this default object:

\`\`\`javascript
export default {
  // Required
  name: "commandname",
  commands: ["cmd", "c", "alias"],  // First is primary
  description: "Short description",
  
  // Optional
  adminOnly: false,      // Requires admin permission
  ownerOnly: false,      // Requires owner permission
  groupOnly: true,       // Only works in groups
  dmOnly: false,         // Only works in DMs
  
  // Main execution
  async execute(sock, sessionId, args, m) {
    try {
      // Plugin logic here
      
      // Send reply
      await sock.sendMessage(m.chat, {
        text: "Response text"
      })
      
      return { success: true, data: someData }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }
}
\`\`\`

**Parameters:**
- `sock` - WhatsApp/Telegram socket connection
- `sessionId` - Current session identifier
- `args` - Command arguments array
- `m` - Message object (sender, chat, text, etc.)

---

## 🔄 Plugin Lifecycle

\`\`\`
Message Received
    ↓
Check if command (starts with . or /)
    ↓
Extract command name & args
    ↓
Find plugin in registry
    ↓
Check permissions (admin/owner)
    ↓
Execute plugin
    ↓
Handle response
    ↓
Send reply to user
    ↓
Log execution
\`\`\`

---

## 📂 Command Categories

### **1. Main Menu** (`/plugins/mainmenu/`)
- `menu` - Show all commands
- `ping` - Bot status
- `allcommands` - List all available commands
- `botlink` - Get bot installation link
- `channel` - Bot official channel
- `checkban` - Check ban status
- `pin` - Pin message
- `vv` - View view-once media

### **2. Group Menu** (`/plugins/groupmenu/`) - See [plugins/groupmenu/README.md]
40+ commands for group management

### **3. Download Menu** (`/plugins/downloadmenu/`) - See [plugins/downloadmenu/README.md]
15+ download platforms

### **4. Convert Menu** (`/plugins/convertmenu/`) - See [plugins/convertmenu/README.md]
10+ media conversion types

### **5. Game Menu** (`/plugins/gamemenu/`) - See [plugins/gamemenu/README.md]
8 interactive games

### **6. AI Menu** (`/plugins/aimenu/`) - See [plugins/aimenu/README.md]
AI model selection and usage

### **7. Owner Menu** (`/plugins/ownermenu/`) - See [plugins/ownermenu/README.md]
15+ owner-only commands

### **8. Bug Menu** (`/plugins/bugmenu/`)
System utilities and diagnostics

---

## 💬 Message Handling

### **Message Object Structure**

\`\`\`javascript
m = {
  key: { remoteJid, id, fromMe },
  messageTimestamp: 1234567890,
  pushName: "User Name",
  message: { conversation: "text" },
  sender: "1234567890@s.whatsapp.net",
  chat: "1234567890@g.us" or "1234567890@s.whatsapp.net",
  isGroup: true/false,
  isCreator: true/false,
  isAdmin: true/false,
  text: "command arguments",
  reply: async (text) => { ... },
  react: async (emoji) => { ... }
}
\`\`\`

### **Command Routing**

\`\`\`javascript
// In plugin-loader.js
const command = text.split(' ')[0].slice(1)  // Remove . or /
const args = text.split(' ').slice(1)

const plugin = plugins.find(p => p.commands.includes(command))
if (!plugin) return null

return await plugin.execute(sock, sessionId, args, m)
\`\`\`

---

## 🔐 Permission System

\`\`\`javascript
// Admin Check Middleware
async function checkAdmin(sock, m, isGroupAdmin = true) {
  if (m.isCreator) return true  // Group creator = admin
  
  if (isGroupAdmin) {
    // Check if user is group admin
    const groupMetadata = await sock.groupMetadata(m.chat)
    return groupMetadata.participants
      .find(p => p.id === m.sender)
      ?.admin
  }
  
  return false
}

// Owner Check
function checkOwner(m) {
  return OWNER_IDS.includes(m.sender)
}
\`\`\`

**Usage in Plugin:**
\`\`\`javascript
if (plugin.adminOnly && !await checkAdmin(sock, m)) {
  return { success: false, error: "Admin only" }
}

if (plugin.ownerOnly && !checkOwner(m)) {
  return { success: false, error: "Owner only" }
}
\`\`\`

---

## 📤 Sending Responses

### **Text Message**
\`\`\`javascript
await sock.sendMessage(m.chat, {
  text: "Hello world!"
}, { quoted: m })
\`\`\`

### **Image Message**
\`\`\`javascript
await sock.sendMessage(m.chat, {
  image: imageBuffer,
  caption: "Image caption"
}, { quoted: m })
\`\`\`

### **Video Message**
\`\`\`javascript
await sock.sendMessage(m.chat, {
  video: videoBuffer,
  caption: "Video caption",
  mimetype: "video/mp4"
}, { quoted: m })
\`\`\`

### **Document Message**
\`\`\`javascript
await sock.sendMessage(m.chat, {
  document: docBuffer,
  fileName: "filename.pdf",
  mimetype: "application/pdf"
}, { quoted: m })
\`\`\`

### **Reaction (Emoji)**
\`\`\`javascript
await sock.sendMessage(m.chat, {
  react: { text: "👍" }
}, { quoted: m })
\`\`\`

---

## 🚀 Creating a New Plugin

1. Create file: `/plugins/category/new-command.js`
2. Export default structure
3. Implement execute function
4. Test locally
5. Add to category README

**Example:**
\`\`\`javascript
// /plugins/mainmenu/hello.js
export default {
  name: "hello",
  commands: ["hello", "hi", "hey"],
  description: "Greet the user",
  
  async execute(sock, sessionId, args, m) {
    const userName = args[0] || m.pushName || "Friend"
    
    await sock.sendMessage(m.chat, {
      text: `Hello ${userName}! 👋`
    }, { quoted: m })
    
    return { success: true }
  }
}
\`\`\`

---

## 🔍 Menu System

### **File:** `/utils/menu-system.js`

Generates category menus dynamically:

\`\`\`javascript
// Generate group menu
const menuText = await menuSystem.generateCategoryMenu(
  "groupmenu",
  userInfo,
  isCreator
)

// Custom menu
const customMenu = await menuSystem.createMenu({
  title: "Custom Menu",
  items: [
    { title: "Option 1", description: "Do something" },
    { title: "Option 2", description: "Do something else" }
  ]
})
\`\`\`

---

## ⚙️ Configuration

**Environment Variables:**
\`\`\`
PLUGIN_DIR=./plugins
PLUGIN_TIMEOUT=30000         // 30 seconds per plugin
PLUGIN_ERROR_REPLY=true      # Send error messages
PLUGIN_RATE_LIMIT=5          # 5 commands per minute per user
\`\`\`

---
