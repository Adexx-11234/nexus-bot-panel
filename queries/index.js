// Database Queries Index
// ==========================================
// CENTRALIZED QUERY EXPORTS
// ==========================================

import { logger } from "../utils/logger.js"

export class GroupQueries {
  constructor(pool) {
    this.pool = pool
  }

  async getGroupSettings(groupJid) {
    try {
      const result = await this.pool.query("SELECT * FROM group_settings WHERE group_jid = $1", [groupJid])
      return result.rows[0] || null
    } catch (error) {
      logger.error(`[GroupQueries] Error getting group settings: ${error.message}`)
      throw error
    }
  }

  async updateGroupSettings(groupJid, settings) {
    try {
      const result = await this.pool.query(
        `INSERT INTO group_settings (group_jid, settings, updated_at) 
         VALUES ($1, $2, NOW()) 
         ON CONFLICT (group_jid) 
         DO UPDATE SET settings = $2, updated_at = NOW() 
         RETURNING *`,
        [groupJid, JSON.stringify(settings)],
      )
      return result.rows[0]
    } catch (error) {
      logger.error(`[GroupQueries] Error updating group settings: ${error.message}`)
      throw error
    }
  }

  async getGroupMembers(groupJid) {
    try {
      const result = await this.pool.query("SELECT * FROM group_members WHERE group_jid = $1", [groupJid])
      return result.rows
    } catch (error) {
      logger.error(`[GroupQueries] Error getting group members: ${error.message}`)
      throw error
    }
  }

  async addGroupMember(groupJid, memberJid, role = "member") {
    try {
      const result = await this.pool.query(
        `INSERT INTO group_members (group_jid, member_jid, role, joined_at) 
         VALUES ($1, $2, $3, NOW()) 
         ON CONFLICT (group_jid, member_jid) 
         DO UPDATE SET role = $3, updated_at = NOW() 
         RETURNING *`,
        [groupJid, memberJid, role],
      )
      return result.rows[0]
    } catch (error) {
      logger.error(`[GroupQueries] Error adding group member: ${error.message}`)
      throw error
    }
  }

  async removeGroupMember(groupJid, memberJid) {
    try {
      const result = await this.pool.query(
        "DELETE FROM group_members WHERE group_jid = $1 AND member_jid = $2 RETURNING *",
        [groupJid, memberJid],
      )
      return result.rows[0]
    } catch (error) {
      logger.error(`[GroupQueries] Error removing group member: ${error.message}`)
      throw error
    }
  }

  async getGroupStats(groupJid) {
    try {
      const result = await this.pool.query(
        `SELECT 
           COUNT(*) as total_members,
           COUNT(CASE WHEN role = 'admin' THEN 1 END) as admin_count,
           COUNT(CASE WHEN role = 'superadmin' THEN 1 END) as superadmin_count
         FROM group_members 
         WHERE group_jid = $1`,
        [groupJid],
      )
      return result.rows[0]
    } catch (error) {
      logger.error(`[GroupQueries] Error getting group stats: ${error.message}`)
      throw error
    }
  }
}

// Export other query classes as they're created
// export { UserQueries } from './user-queries.js';
// export { MessageQueries } from './message-queries.js';
