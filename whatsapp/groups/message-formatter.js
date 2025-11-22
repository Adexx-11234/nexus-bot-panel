import { createComponentLogger } from '../../utils/logger.js'
import { getGroupMetadataManager } from './metadata.js'

const logger = createComponentLogger('MESSAGE_FORMATTER')

export class MessageFormatter {
  constructor() {
    this.metadataManager = getGroupMetadataManager()
    this.themeEmoji = "🌟"
  }

  async formatParticipants(sock, groupJid, participants, action) {
    try {
      const formattedMessages = []
      const groupName = await this.metadataManager.getGroupName(sock, groupJid)
      const timestamp = Math.floor(Date.now() / 1000) + 3600

      for (const participantData of participants) {
        try {
          const { jid, displayName } = participantData
          
          const message = this.createActionMessage(action, displayName, groupName, timestamp)
          const fakeQuotedMessage = this.createFakeQuotedMessage(action, displayName, jid, groupJid)

          formattedMessages.push({
            participant: jid,
            message: message,
            fakeQuotedMessage: fakeQuotedMessage,
            displayName: displayName
          })
        } catch (error) {
          logger.error(`Failed to format participant:`, error)
        }
      }

      return formattedMessages
    } catch (error) {
      logger.error('Error formatting participants:', error)
      return []
    }
  }

  createActionMessage(action, displayName, groupName, timestamp) {
    const messageDate = new Date(timestamp * 1000)
    const currentTime = messageDate.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })
    const currentDate = messageDate.toLocaleDateString("en-US", { day: "2-digit", month: "2-digit", year: "numeric" })

    const messages = {
      add: `╚»˙·٠${this.themeEmoji}●♥ WELCOME ♥●${this.themeEmoji}٠·˙«╝\n\n✨ Welcome ${displayName}! ✨\n\nWelcome to ⚡${groupName}⚡! 🎉\n\n🕐 Joined at: ${currentTime}, ${currentDate}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
      remove: `╚»˙·٠${this.themeEmoji}●♥ GOODBYE ♥●${this.themeEmoji}٠·˙«╝\n\n✨ Goodbye ${displayName}! ✨\n\nYou'll be missed from ⚡${groupName}⚡! 🥲\n\n🕐 Left at: ${currentTime}, ${currentDate}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
      promote: `╚»˙·٠${this.themeEmoji}●♥ PROMOTION ♥●${this.themeEmoji}٠·˙«╝\n\n👑 Congratulations ${displayName}!\n\nYou have been promoted to admin in ⚡${groupName}⚡! 🎉\n\nPlease use your powers responsibly.\n\n🕐 Promoted at: ${currentTime}, ${currentDate}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`,
      demote: `╚»˙·٠${this.themeEmoji}●♥ DEMOTION ♥●${this.themeEmoji}٠·˙«╝\n\n📉 ${displayName} have been demoted from admin in ⚡${groupName}⚡.\n\nYou can still participate normally.\n\n🕐 Demoted at: ${currentTime}, ${currentDate}\n\n> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
    }

    return messages[action] || `Group ${action} notification for ${displayName} in ⚡${groupName}⚡`
  }

  createFakeQuotedMessage(action, displayName, participantJid, groupJid) {
    const actionMessages = {
      add: `${displayName} joined the group`,
      remove: `${displayName} left the group`, 
      promote: `${displayName} was promoted to admin`,
      demote: `${displayName} was demoted from admin`
    }

    return {
      key: {
        id: `FAKE_QUOTE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        remoteJid: groupJid,
        fromMe: false,
        participant: participantJid
      },
      message: {
        conversation: actionMessages[action] || `${action} event`
      },
      participant: participantJid
    }
  }
}

let formatterInstance = null

export function getMessageFormatter() {
  if (!formatterInstance) {
    formatterInstance = new MessageFormatter()
  }
  return formatterInstance
}