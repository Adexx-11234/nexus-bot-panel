// Storage module barrel export
export { SessionStorage, getSessionStorage, initializeStorage } from "./coordinator.js"
export { MongoDBStorage } from "./mongodb.js"
export { PostgreSQLStorage } from "./postgres.js"
export { FileManager } from "./file.js"
export {
  useMongoDBAuthState,
  cleanupSessionAuthData,
  hasValidAuthData,
  getAuthCacheStats,
} from "./auth-state.js"

export {
  FileBasedStore,
  createFileStore,
  getFileStore,
  deleteFileStore,
  getStoreStats,
} from "./file-store.js"

export {
  getSocketsStore,
  createSocketsStore,
} from "./sockets-store.js"

// Re-export singleton functions
// (already exported from coordinator.js above)
