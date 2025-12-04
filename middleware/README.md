# 🔐 Middleware Module Documentation

Permission checking and user verification.

---

## 📋 Middleware Functions

### **Admin Check** (`admin-check.js`)
\`\`\`javascript
async function checkAdmin(sock, m) {
  const groupMetadata = await sock.groupMetadata(m.chat)
  const participant = groupMetadata.participants.find(p => p.id === m.sender)
  return participant?.admin || m.isCreator
}
\`\`\`

### **Owner Check**
\`\`\`javascript
function checkOwner(m) {
  return OWNER_IDS.includes(m.sender)
}
\`\`\`

---
