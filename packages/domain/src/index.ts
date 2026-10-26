export const packageName = "@discussion-room/domain";

export {
  ArtifactRevisionSchema,
  ArtifactSchema,
  BoardSchema,
  CanvasItemSchema,
  EntitySnapshotSchema,
  EntityVersionSchema,
  OpaqueObjectSchema,
  ProjectSchema,
  ViewportSchema,
  type Artifact,
  type ArtifactRevision,
  type Board,
  type CanvasItem,
  type EntitySnapshot,
  type EntityVersion,
  type Project,
  type Viewport,
} from "./entities.ts";
export {
  removeCanvasItem,
  validateEntitySnapshot,
  type CanvasItemNotFoundError,
  type EntityReferenceError,
  type EntityReferenceIssue,
} from "./entity-snapshot.ts";
export { createId, IdSchema, type Id, type IdGenerator } from "./id.ts";
export { err, ok, type Result } from "./result.ts";
export {
  CURRENT_SCHEMA_VERSION,
  SchemaVersionSchema,
  type SchemaVersion,
} from "./schema-version.ts";
export { TimestampSchema, type Timestamp } from "./timestamp.ts";
export { validate, type ValidationError } from "./validation.ts";
