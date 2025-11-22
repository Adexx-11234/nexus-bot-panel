// Handlers module barrel export
export { handleMessagesUpsert, handleGroupParticipantsUpdate } from './upsert.js'
export { WhatsAppEventHandler } from './whatsapp-events.js'

// Re-export for backward compatibility
export { messageProcessor } from './upsert.js'