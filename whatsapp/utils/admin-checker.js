/**
 * Admin Checker Utility
 * Wrapper for group admin checking functions
 */

import { 
  isGroupAdmin, 
  isBotAdmin, 
  isGroupOwner,
  getGroupAdmins 
} from '../groups/index.js'

export default class AdminChecker {
  /**
   * Check if a user is a group admin
   */
  async isGroupAdmin(sock, groupJid, userJid) {
    return await isGroupAdmin(sock, groupJid, userJid)
  }

  /**
   * Check if the bot is a group admin
   */
  async isBotAdmin(sock, groupJid) {
    return await isBotAdmin(sock, groupJid)
  }

  /**
   * Check if a user is the group owner
   */
  async isGroupOwner(sock, groupJid, userJid) {
    return await isGroupOwner(sock, groupJid, userJid)
  }

  /**
   * Get all group admins
   */
  async getGroupAdmins(sock, groupJid) {
    return await getGroupAdmins(sock, groupJid)
  }
}