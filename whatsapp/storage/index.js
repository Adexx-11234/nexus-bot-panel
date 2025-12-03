// Storage module barrel export
export { SessionStorage } from './coordinator.js'
export { MongoDBStorage } from './mongodb.js'
export { PostgreSQLStorage } from './postgres.js'
export { FileManager } from './file.js'
export { 
  useMongoDBAuthState, 
  cleanupSessionAuthData, 
  hasValidAuthData
} from './auth-state.js'

// Re-export singleton functions
export { 
  getSessionStorage,
  initializeStorage 
} from './coordinator.js'