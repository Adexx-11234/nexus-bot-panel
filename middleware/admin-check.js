import { getGroupMetadata } from "../config/baileys.js"
import { logger } from "../utils/logger.js"

export default class AdminChecker {
  constructor() {
    this.cacheTimeout = 30 * 1000 // 30 seconds (kept for reference)
  }

  normalizeJid(jid) {
    if (!jid) return ""
    return jid.includes("@") ? jid : `${jid}@s.whatsapp.net`
  }

  async getGroupMetadata(sock, groupJid) {
    try {
      const metadata = await getGroupMetadata(sock, groupJid)
      return metadata
    } catch (error) {
      logger.error(`[AdminChecker] Error fetching group metadata for ${groupJid}: ${error.message}`)
      return null
    }
  }

  getGroupAdmins(participants) {
    if (!Array.isArray(participants)) return []

    return participants
      .filter((p) => p.admin === "admin" || p.admin === "superadmin")
      .map((p) => this.normalizeJid(p.jid))
      .filter((jid) => jid)
  }

  async isGroupAdmin(sock, groupJid, userJid) {
    try {
      const normalizedUserJid = this.normalizeJid(userJid)
      const groupMetadata = await this.getGroupMetadata(sock, groupJid)

      if (!groupMetadata || !groupMetadata.participants) {
        return false
      }

      const groupAdmins = this.getGroupAdmins(groupMetadata.participants)
      const isAdminByList = groupAdmins.includes(normalizedUserJid)

      const userParticipant = groupMetadata.participants.find((p) => {
        const participantJid = this.normalizeJid(p.jid)
        return participantJid === normalizedUserJid
      })

      const isReallyAdmin =
        userParticipant && (userParticipant.admin === "admin" || userParticipant.admin === "superadmin")

      const groupOwner = this.normalizeJid(groupMetadata.owner || "")
      const isGroupOwner = groupOwner ? groupOwner === normalizedUserJid : isAdminByList

      return isAdminByList || isReallyAdmin || isGroupOwner
    } catch (error) {
      logger.error(`[AdminChecker] Error checking admin status: ${error.message}`)
      return false
    }
  }

  async isBotAdmin(sock, groupJid) {
    try {
      const rawBotId = sock.user?.id || ""
      const botNumber = this.normalizeJid(rawBotId.split(":")[0])

      const groupMetadata = await this.getGroupMetadata(sock, groupJid)

      if (!groupMetadata || !groupMetadata.participants) {
        return false
      }

      const isBotAdmin = groupMetadata.participants.some((p) => {
        const participantJid = this.normalizeJid(p.jid)
        const botJid = this.normalizeJid(botNumber)
        return participantJid === botJid && (p.admin === "admin" || p.admin === "superadmin")
      })

      return isBotAdmin
    } catch (error) {
      logger.error(`[AdminChecker] Error checking bot admin status: ${error.message}`)
      return false
    }
  }

  async checkAdminPermissions(sock, groupJid, userJid) {
    const [isAdmin, isBotAdmin] = await Promise.all([
      this.isGroupAdmin(sock, groupJid, userJid),
      this.isBotAdmin(sock, groupJid),
    ])

    return { isAdmin, isBotAdmin }
  }

  async getGroupOwner(sock, groupJid) {
    try {
      const groupMetadata = await this.getGroupMetadata(sock, groupJid)
      return groupMetadata?.owner ? this.normalizeJid(groupMetadata.owner) : null
    } catch (error) {
      logger.error(`[AdminChecker] Error getting group owner: ${error.message}`)
      return null
    }
  }

  async isGroupOwner(sock, groupJid, userJid) {
    const owner = await this.getGroupOwner(sock, groupJid)
    if (!owner) return false
    return this.normalizeJid(userJid) === owner
  }
}
