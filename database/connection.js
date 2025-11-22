import { pool as dbPool } from "../config/database.js"

export const pool = dbPool

class DatabaseConnection {
  constructor() {
    this.pool = dbPool
  }

  async query(text, params) {
    const start = Date.now()
    try {
      const res = await this.pool.query(text, params)
      const duration = Date.now() - start
      console.log("📊 Query executed", { text: text.substring(0, 50), duration, rows: res.rowCount })
      return res
    } catch (error) {
      console.error("❌ Database query error:", error)
      throw error
    }
  }

  async getClient() {
    return await this.pool.connect()
  }

  async transaction(callback) {
    const client = await this.getClient()
    try {
      await client.query("BEGIN")
      const result = await callback(client)
      await client.query("COMMIT")
      return result
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async close() {
    await this.pool.end()
  }
}

export default new DatabaseConnection()
