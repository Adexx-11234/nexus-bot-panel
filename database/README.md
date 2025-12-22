# 📊 Database Module Documentation

Handles all database operations, migrations, and data persistence for the bot platform.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Connection Management](#connection-management)
- [Migrations System](#migrations-system)
- [Query Operations](#query-operations)
- [Group Scheduler](#group-scheduler)
- [Schema Definition](#schema-definition)

---

## 🎯 Overview

The database module provides:

- **PostgreSQL Connection Pooling** - Efficient resource management
- **Transaction Support** - ACID-compliant operations
- **Auto-migrations** - Schema version control
- **Query Caching** - Improved performance
- **Group Scheduling** - Automated tasks

---

## 🔌 Connection Management

### **File:** `connection.js`

Wrapper around PostgreSQL connection pool with query execution:

\`\`\`javascript
// Query execution with logging
const result = await db.query(
  "SELECT * FROM users WHERE id = $1",
  [userId]
)

// Transaction support
await db.transaction(async (client) => {
  await client.query("UPDATE users SET active = true WHERE id = $1", [userId])
  await client.query("UPDATE statistics SET update_time = NOW()")
})

// Close connection
await db.close()
\`\`\`

**Key Methods:**
- `query(text, params)` - Execute SQL query
- `getClient()` - Get dedicated connection client
- `transaction(callback)` - Execute within transaction
- `close()` - Gracefully shutdown pool

---

## 🔄 Migrations System

### **File:** `migrations/run-migrations.js`

Automated migration system:

\`\`\`bash
# Run migrations
npm run migrate
\`\`\`

**Process:**
1. Check migrations table
2. Find pending migrations
3. Execute in order
4. Log completion

### **File:** `migrations/001_init.sql`

Initial schema setup:

\`\`\`sql
-- Users table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  permissions TEXT[],
  created_at TIMESTAMP DEFAULT NOW()
)

-- Messages table
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  sender_id VARCHAR(255),
  chat_id VARCHAR(255),
  message_text TEXT,
  created_at TIMESTAMP DEFAULT NOW()
)

-- Warnings table
CREATE TABLE warnings (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255),
  group_id VARCHAR(255),
  reason TEXT,
  warned_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
)

-- Groups table
CREATE TABLE groups (
  id SERIAL PRIMARY KEY,
  group_id VARCHAR(255) UNIQUE,
  name VARCHAR(255),
  members_count INT,
  created_at TIMESTAMP DEFAULT NOW()
)

-- Scheduled tasks
CREATE TABLE scheduled_tasks (
  id SERIAL PRIMARY KEY,
  group_id VARCHAR(255),
  task_type VARCHAR(100),
  task_data JSONB,
  run_time TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
)

-- VIP Users
CREATE TABLE vip_users (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) UNIQUE,
  telegram_id VARCHAR(255),
  vip_level INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW()
)

-- Owner list
CREATE TABLE owners (
  id SERIAL PRIMARY KEY,
  owner_id VARCHAR(255) UNIQUE,
  telegram_id VARCHAR(255),
  added_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
)

-- Game sessions
CREATE TABLE game_sessions (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(255) UNIQUE,
  game_type VARCHAR(100),
  players JSONB,
  state JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP
)
\`\`\`

---

## 📝 Query Operations

### **File:** `query.js`

Common database queries used throughout the platform:

\`\`\`javascript
// Get user
const user = await db.query(
  "SELECT * FROM users WHERE user_id = $1",
  [userId]
)

// Create user
await db.query(
  "INSERT INTO users (user_id, name, permissions) VALUES ($1, $2, $3)",
  [userId, name, JSON.stringify(perms)]
)

// Update group
await db.query(
  "UPDATE groups SET members_count = $1 WHERE group_id = $2",
  [count, groupId]
)

// Get warnings
const warnings = await db.query(
  "SELECT * FROM warnings WHERE user_id = $1 AND group_id = $2",
  [userId, groupId]
)
\`\`\`

---

## ⏰ Group Scheduler

### **File:** `groupscheduler.js`

Manages automated group tasks:

\`\`\`javascript
// Initialize scheduler
const scheduler = new GroupScheduler(sessionManager)
scheduler.start()

// Available tasks:
// - Auto-welcome messages
// - Auto-goodbye messages
// - Periodic announcements
// - Auto-role assignment
// - Activity tracking
\`\`\`

**Key Methods:**
- `start()` - Begin scheduled tasks
- `stop()` - Stop scheduler
- `addTask(groupId, taskType, taskData)` - Add new task
- `removeTask(taskId)` - Remove task

---

## 🗄️ Database Configuration

### **File:** `database.js` (via config/database.js)

\`\`\`javascript
// Connection pool initialization
import { Pool } from 'pg'

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  max: 20,                    // Maximum connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
})

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err)
})

export async function testConnection() {
  const client = await pool.connect()
  const result = await client.query('SELECT NOW()')
  client.release()
  return result.rows[0]
}

export async function closePool() {
  await pool.end()
}
\`\`\`

---

## 🔍 Data Flow

\`\`\`
App Request
    ↓
Database Module
    ↓
Connection Pool
    ↓
PostgreSQL
    ↓
Return Result
    ↓
Cache Update
    ↓
Response to App
\`\`\`

---

## ⚙️ Configuration

**Environment Variables:**
\`\`\`
DATABASE_URL=postgresql://user:pass@localhost:5432/botdb
DB_USER=postgres
DB_PASSWORD=secure_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=botdb
\`\`\`

---

## 🚀 Performance Tips

1. **Use Pooling** - Connections are reused
2. **Batch Operations** - Group queries when possible
3. **Add Indexes** - On frequently queried columns
4. **Cache Results** - Use Redis for hot data
5. **Monitor Connections** - Check pool status regularly

---

## 🐛 Troubleshooting

**Connection Failed:**
\`\`\`bash
# Check PostgreSQL status
psql -U postgres -c "SELECT version();"

# Verify credentials
echo $DATABASE_URL
\`\`\`

**Migration Issues:**
\`\`\`bash
# Run migrations again
npm run migrate

# Check migration status
psql -d botdb -c "SELECT * FROM migrations;"
\`\`\`

---
