# 🛠️ Utilities Module Documentation

Shared helper functions, logging, menu system, and plugin loading.

---

## 📋 Components

### **Logger** (`logger.js`)
\`\`\`javascript
const logger = createComponentLogger("COMPONENT_NAME")

logger.info("Message")
logger.warn("Warning")
logger.error("Error")
logger.debug("Debug info")
\`\`\`

### **Menu System** (`menu-system.js`)
\`\`\`javascript
const menuText = await menuSystem.generateCategoryMenu(
  "groupmenu",
  userInfo,
  isCreator
)
\`\`\`

### **Plugin Loader** (`plugin-loader.js`)
\`\`\`javascript
await pluginLoader.loadPlugins()
const result = await pluginLoader.executeCommand(
  command,
  sock,
  sessionId,
  args,
  message
)
\`\`\`

---
