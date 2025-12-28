// Groups module barrel export
export { GroupMetadataManager, getGroupMetadataManager } from './metadata.js'
export { GroupParticipantsHandler, getGroupParticipantsHandler } from './participants.js'
export { GroupAdminChecker } from './admin.js'
export { GroupNotifier } from './notifier.js'
export { getMessageFormatter } from './message-formatter.js'
export { resolveLidToJid, resolveParticipants, resolveLidsToJids } from './lid-resolver.js'

// Re-export commonly used functions
export {
  isGroupAdmin,
  isBotAdmin,
  isGroupOwner,
  getGroupAdmins
} from './admin.js'