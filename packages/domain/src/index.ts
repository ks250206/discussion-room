export const packageName = "@discussion-room/domain";

export { createId, IdSchema, type Id, type IdGenerator } from "./id.ts";
export { err, ok, type Result } from "./result.ts";
export {
  CURRENT_SCHEMA_VERSION,
  SchemaVersionSchema,
  type SchemaVersion,
} from "./schema-version.ts";
export { TimestampSchema, type Timestamp } from "./timestamp.ts";
export { validate, type ValidationError } from "./validation.ts";
