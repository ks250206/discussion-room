export const packageName = "@discussion-room/protocol";

export * from "./messages.ts";
export * from "./codec.ts";
export {
  PRESENCE_THROTTLE_MS,
  PRESENCE_TTL_MS,
  applyPresence,
  editAccess,
  expirePresence,
  flushPresence,
  notePresence,
  releaseClient,
  type EditAccess,
  type PresenceEdit,
  type PresenceEmit,
  type PresenceError,
  type PresenceRecord,
  type PresenceThrottle,
  type PresenceUpdate,
} from "./presence.ts";
export {
  snapshotJson,
  PROTOCOL_LIMITS,
  type JsonValue,
  type JsonObject,
  type BoundaryError,
} from "./json.ts";
