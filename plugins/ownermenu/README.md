# 👑 Owner Menu Plugin Documentation

Owner-only administrative commands for bot management and system control.

---

## 📋 Owner Commands Overview

### **Owner Management**
- `add-owner` - Add new owner
- `remove-owner` - Remove owner privileges
- `list-owners` - Show all owners
- `ownermenu` - Display owner commands menu

### **Session Management**
- `join` - Join WhatsApp group via link
- `leave` - Leave current group
- `listgc` - List all groups
- `listpc` - List private chats
- `creategc` - Create new group

### **Auto Features**
- `autotyping` - Enable/disable typing indicator
- `autorecording` - Enable/disable recording indicator
- `autoonline` - Keep online status
- `autostatusview` - Auto-view stories
- `autostatuslike` - Auto-like all stories
- `antiviewonce` - Save view-once messages
- `antidelete` - Save deleted messages

### **User Management**
- `block` - Block user
- `mode` - Set bot mode (public/private)
- `checkban` - Check if user is banned

---

## 🔐 Owner Permission System

### **Owner Verification**

\`\`\`javascript
// Owner check
const OWNER_IDS = [
  "1234567890@s.whatsapp.net",  // Owner 1
  "0987654321@s.whatsapp.net"   // Owner 2
]

function isOwner(userId) {
  return OWNER_IDS.includes(userId)
}
\`\`\`

**Owner Privileges:**
- Execute all commands
- Add/remove other owners
- Control bot globally
- Access system logs
- Manage all sessions
- Execute restricted functions

---

## 💬 Command Usage

### **Owner Management**

\`\`\`
.add-owner @user
.add-owner 1234567890

Response: ✅ User added as owner
\`\`\`

\`\`\`
.remove-owner @user
Response: ✅ Owner privileges removed
\`\`\`

\`\`\`
.list-owners
Response:
👑 Owner List:
1. Ahmed (1234567890@s.whatsapp.net) - Added: 2024-12-01
2. Ali (0987654321@s.whatsapp.net) - Added: 2024-12-01
3. Hassan (1111111111@s.whatsapp.net) - Added: 2024-12-02
\`\`\`

### **Group Management**

\`\`\`
.creategc Group Name @member1 @member2
Response: ✅ Group created with 2 members

.join https://chat.whatsapp.com/XXXXX
Response: ✅ Joined group

.leave
Response: ✅ Left group

.listgc
Response:
📋 Groups (5 total):
1. Bot Testing - 12 members
2. Tech Discussion - 45 members
3. Gaming - 8 members
...

.listpc
Response:
💬 Private Chats (15 total):
1. Ahmed
2. Ali
3. Hassan
...
\`\`\`

### **Auto Features**

\`\`\`
.autotyping on      # Show typing indicator
.autotyping off

.autorecording on   # Show recording indicator
.autorecording off

.autoonline on      # Stay online always
.autoonline off

.autostatusview on  # View all stories automatically
.autostatusview off

.autostatuslike on  # Like all stories
.autostatuslike off

.antiviewonce on    # Save view-once messages
.antiviewonce off

.antidelete on      # Save deleted messages
.antidelete off
\`\`\`

### **User Management**

\`\`\`
.block @user
Response: ✅ User blocked

.block 1234567890
Response: ✅ User ID blocked

.mode public        # Everyone can use bot
.mode private       # Only owner can use

.checkban 1234567890
Response: User status: Not banned (Active)
\`\`\`

---

## 📊 Owner Database

**Owners Table:**
\`\`\`sql
id | owner_id              | telegram_id | added_by      | added_date | permissions
1  | 1234567890@s...       | 123456789   | owner-created | 2024-12-01 | all
2  | 0987654321@s...       | 987654321   | 1234567890@s  | 2024-12-02 | limited
\`\`\`

**Auto Features Status:**
\`\`\`sql
id | setting        | status | owner_id           | enabled_at
1  | autotyping     | on     | 1234567890@s...    | 2024-12-03
2  | antiviewonce   | on     | 1234567890@s...    | 2024-12-03
3  | autostatuslike | on     | 1234567890@s...    | 2024-12-02
\`\`\`

**Blocked Users:**
\`\`\`sql
id | user_id               | blocked_by        | blocked_at
1  | 5555555555@s...       | 1234567890@s...   | 2024-12-03
2  | 6666666666@s...       | 1234567890@s...   | 2024-12-02
\`\`\`

---

## ⚙️ Configuration

**Owner Settings:**
\`\`\`javascript
{
  maxOwners: 10,                    # Maximum owners allowed
  maxBlockedUsers: 1000,
  sessionTimeout: 3600000,          # 1 hour
  autoFeatureCooldown: 60000,       # 1 minute
  enableOwnerNotifications: true,
  logAllOwnerActions: true,
  requireConfirmation: true         # For sensitive actions
}
\`\`\`

---

## 🔄 Owner Action Logging

All owner actions are logged:

\`\`\`javascript
{
  timestamp: "2024-12-03 15:30:45",
  owner: "1234567890@s.whatsapp.net",
  action: "add-owner",
  target: "0987654321@s.whatsapp.net",
  result: "success",
  details: { ... }
}
\`\`\`

---

## ⚠️ Important Notes

- Only add trusted users as owners
- Owner status is permanent until removed
- All actions are logged for security
- Removed owners lose all privileges
- Owner commands are logged to database

---
