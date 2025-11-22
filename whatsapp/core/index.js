// Core module barrel export
export { WhatsAppClient } from './client.js'
export { ConnectionManager } from './connection.js'
export { baileysConfig, getBaileysSocket } from './config.js'
export { DecryptionHandler, getDecryptionHandler, resetDecryptionHandler } from './decryption-handler.js'
// Re-export commonly used utilities from config
export { 
  createBaileysSocket,
  setupSocketDefaults 
} from './config.js'