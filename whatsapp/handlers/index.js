// Handlers module barrel export
export { 
  handleMessagesUpsert, 
  handleGroupParticipantsUpdate,
  getMessageProcessor  // ✅ ADD THIS EXPORT
} from './upsert.js'

export { WhatsAppEventHandler } from './whatsapp-events.js'

// Re-export for backward compatibility
export { messageProcessor } from './upsert.js'