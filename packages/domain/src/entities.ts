import * as v from "valibot";
import { IdSchema } from "./id.ts";
import { TimestampSchema } from "./timestamp.ts";

/** Optimistic concurrency version; independent of the document schemaVersion. */
export const EntityVersionSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(1));
export type EntityVersion = v.InferOutput<typeof EntityVersionSchema>;

const finiteNumberSchema = v.pipe(v.number(), v.finite());
const positiveNumberSchema = v.pipe(finiteNumberSchema, v.gtValue(0));
const nonBlankStringSchema = v.pipe(
  v.string(),
  v.check((input) => input.trim().length > 0, "Expected a non-blank string"),
);

/**
 * Structural envelope only. Preserve opaque contents, including provenance, verbatim.
 * Kind-specific payload and scientific validation belong to their own boundaries.
 */
export const OpaqueObjectSchema = v.pipe(
  v.custom<Record<string, unknown>>((input) => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
    const prototype: unknown = Object.getPrototypeOf(input);
    return prototype === Object.prototype || prototype === null;
  }, "Expected an opaque plain object"),
  v.readonly(),
);

export const ViewportSchema = v.pipe(
  v.strictObject({
    x: finiteNumberSchema,
    y: finiteNumberSchema,
    zoom: positiveNumberSchema,
  }),
  v.readonly(),
);
export type Viewport = v.InferOutput<typeof ViewportSchema>;

export const ProjectSchema = v.pipe(
  v.strictObject({
    id: IdSchema,
    title: nonBlankStringSchema,
    description: v.string(),
    createdAt: TimestampSchema,
    version: EntityVersionSchema,
  }),
  v.readonly(),
);
export type Project = v.InferOutput<typeof ProjectSchema>;

export const BoardSchema = v.pipe(
  v.strictObject({
    id: IdSchema,
    projectId: IdSchema,
    name: nonBlankStringSchema,
    viewport: ViewportSchema,
    version: EntityVersionSchema,
  }),
  v.readonly(),
);
export type Board = v.InferOutput<typeof BoardSchema>;

export const ArtifactSchema = v.pipe(
  v.strictObject({
    id: IdSchema,
    projectId: IdSchema,
    kind: nonBlankStringSchema,
    payload: OpaqueObjectSchema,
    revisionId: IdSchema,
    version: EntityVersionSchema,
  }),
  v.readonly(),
);
export type Artifact = v.InferOutput<typeof ArtifactSchema>;

export const ArtifactRevisionSchema = v.pipe(
  v.strictObject({
    id: IdSchema,
    artifactId: IdSchema,
    parentId: v.exactOptional(IdSchema),
    payload: OpaqueObjectSchema,
    author: nonBlankStringSchema,
    createdAt: TimestampSchema,
    version: EntityVersionSchema,
  }),
  v.readonly(),
);
export type ArtifactRevision = v.InferOutput<typeof ArtifactRevisionSchema>;

export const CanvasItemSchema = v.pipe(
  v.strictObject({
    id: IdSchema,
    boardId: IdSchema,
    artifactId: v.exactOptional(IdSchema),
    x: finiteNumberSchema,
    y: finiteNumberSchema,
    width: positiveNumberSchema,
    height: positiveNumberSchema,
    viewState: OpaqueObjectSchema,
    version: EntityVersionSchema,
  }),
  v.readonly(),
);
export type CanvasItem = v.InferOutput<typeof CanvasItemSchema>;

/** In-memory collection for reference checks, not a persisted document format. */
export const EntitySnapshotSchema = v.pipe(
  v.strictObject({
    projects: v.pipe(v.array(ProjectSchema), v.readonly()),
    boards: v.pipe(v.array(BoardSchema), v.readonly()),
    artifacts: v.pipe(v.array(ArtifactSchema), v.readonly()),
    revisions: v.pipe(v.array(ArtifactRevisionSchema), v.readonly()),
    canvasItems: v.pipe(v.array(CanvasItemSchema), v.readonly()),
  }),
  v.readonly(),
);
export type EntitySnapshot = v.InferOutput<typeof EntitySnapshotSchema>;
