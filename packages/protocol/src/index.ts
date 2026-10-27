export const packageName = "@discussion-room/protocol";

export * from "./messages.ts";
export * from "./codec.ts";
export {
  snapshotJson,
  PROTOCOL_LIMITS,
  type JsonValue,
  type JsonObject,
  type BoundaryError,
} from "./json.ts";
