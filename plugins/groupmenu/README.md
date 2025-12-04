# 👥 Group Menu Plugin Documentation

Comprehensive group management commands for administrative control and moderation.

---

## 📋 Group Commands Overview

### **Member Management**
- `add` - Add member to group
- `kick` - Remove member from group
- `kickall` - Remove all members except admin
- `promote` - Make user group admin
- `demote` - Remove admin privileges
- `promoteall` - Promote all members
- `demoteall` - Demote all members

### **Moderation**
- `warn` - Warn a user
- `unwarn` - Remove warnings
- `mute` - Mute user (hide messages)
- `unmute` - Unmute user
- `delete` - Delete bot messages
- `approve` / `disapprove` - Approve group join requests
- `approveall` / `disapproveall` - Bulk approve/disapprove

### **Anti-Features** (Auto-moderation)
- `antilink` - Remove/warn for links
- `antitag` - Prevent tagging
- `antitagadmin` - Prevent tagging admins
- `antispam` - Detect and warn spammers
- `antiimage` - Remove image messages
- `antikick` - Re-add removed members
- `antidemote` - Prevent admin demotion
- `antipromote` - Prevent admin promotion
- `antiadd` - Prevent members being added
- `antibot` - Prevent bot additions
- `antigroupmention` - Prevent group mentions
- `antivirtex` - Detect virtual text exploits

### **Communication**
- `tagall` - Tag all members
- `tagonline` - Tag online members
- `tagadmin` - Tag admin members
- `tagpoll` - Tag in poll responses
- `hidetag` - Send invisible tag
- `mediatag` - Tag with media

### **Group Settings**
- `opentime` - Set group open time
- `closetime` - Set group close time
- `grouponly` - Enable group-only mode
- `grouplink` - Get/set group link
- `welcome` - Set welcome message
- `goodbye` - Set goodbye message
- `left` - Bot leave group

---

## 🔧 How Group Commands Work

### **Permission System**

\`\`\`javascript
// Admin check
if (!m.isAdmin && !m.isCreator) {
  return "❌ Admin only command"
}

// Creator check
if (!m.isCreator) {
  return "❌ Group creator only"
}

// Group check
if (!m.isGroup) {
  return "❌ This command only works in groups"
}
\`\`\`

### **User Identification**

Commands use multiple methods to identify users:

\`\`\`javascript
// By mention
@1234567890

// By quote (reply)
.kick (reply to message)

// By user ID
.kick 1234567890

// By nickname (partial)
.kick ahmed
\`\`\`

---

## 📤 Response Format

All responses follow this format:

\`\`\`javascript
return {
  success: true,
  action: "user_kicked",
  target: "1234567890@s.whatsapp.net",
  message: "✅ User kicked from group",
  metadata: {
    timestamp: Date.now(),
    executedBy: m.sender,
    groupId: m.chat
  }
}
\`\`\`

---

## 🎯 Command Examples

### **Add Member**
\`\`\`
.add 1234567890
.add @1234567890
.add 1234567890 5555555555
\`\`\`

### **Warn User**
\`\`\`
.warn @user (reason)
.warn (reply to message) Spam
\`\`\`

### **Anti-Link Settings**
\`\`\`
.antilink on        # Enable
.antilink off       # Disable
.antilink kick      # Kick violators
\`\`\`

### **Tag Commands**
\`\`\`
.tagall Hello everyone!
.tagonline Get back!
.tagadmin Important message
.hidetag Hidden mention
\`\`\`

### **Auto-Response Messages**
\`\`\`
.welcome Welcome to our group!
.goodbye Goodbye {name}, thanks for being here!
\`\`\`

---

## 📊 Data Storage

### **Database Tables**

**Group Settings:**
\`\`\`sql
id | group_id | setting_name | setting_value | updated_at
1  | 123@g.us | antilink     | 1             | 2024-12-03
2  | 123@g.us | mute_users   | []            | 2024-12-03
\`\`\`

**Warnings:**
\`\`\`sql
id | user_id | group_id | reason | warned_by | count | created_at
1  | 123@s   | 456@g.us | Spam   | 789@s     | 2     | 2024-12-03
\`\`\`

**Scheduled Events:**
\`\`\`sql
id | group_id | event_type | event_data | scheduled_at | created_at
1  | 123@g.us | open_time  | 08:00:00   | 2024-12-04   | 2024-12-03
\`\`\`

---

## ⚙️ Configuration

**Per-Group Settings:**
\`\`\`javascript
{
  groupId: "123@g.us",
  antilink: true,
  antispam: true,
  antiimage: false,
  muted_users: [],
  warnings_threshold: 3,
  auto_warn_kick: true,
  welcome_message: "Welcome!",
  goodbye_message: "Bye!",
  open_time: "08:00",
  close_time: "22:00"
}
\`\`\`

---

## 🔄 Workflow Example: User Warning

\`\`\`
User sends link
    ↓
Bot detects antilink rule
    ↓
Check user's warning count (DB)
    ↓
Add warning (+1)
    ↓
Check threshold (default: 3)
    ↓
If count < 3: Send warning message
If count >= 3: Kick user + notify admins
    ↓
Log action to database
\`\`\`

---
