// Messages module barrel export
export { MessageProcessor } from './processor.js'
export { MessageLogger } from './logger.js'
export { MessagePersistence } from './persistence.js'
export { MessageExtractor } from './extractor.js'
export { serializeMessage } from './serializer.js'

// Re-export commonly used functions
export {
  extractMessageText,
  extractMediaData,
  getMediaType
} from './extractor.js'