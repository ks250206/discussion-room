import * as v from "valibot";

/** File-format version, independent of protocol versions and entity revisions. */
export const CURRENT_SCHEMA_VERSION = 1;

/** Include this required field in every persisted document's boundary schema. */
export const SchemaVersionSchema = v.literal(CURRENT_SCHEMA_VERSION);

export type SchemaVersion = v.InferOutput<typeof SchemaVersionSchema>;
