import * as v from "valibot";
import {
  GraphSnapshotSchema,
  IdSchema,
  ProvenanceSchema,
  SchemaVersionSchema,
  TimestampSchema,
  err,
  ok,
  validate,
  validateArtifactContent,
  validateGraphSnapshot,
  validateRevisionContent,
  type Result,
  type Project,
} from "@discussion-room/domain";
import { equalJson, isLosslessJson, JsonObjectSchema } from "./json.ts";
import { StoredBlobSchema, type StoredBlob, type BlobRegistration } from "./blob-model.ts";

const text = v.pipe(
  v.string(),
  v.check((value) => value.trim().length > 0),
);
export const SequenceSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const opaqueEntries = {
  id: IdSchema,
  projectId: IdSchema,
  schemaVersion: SchemaVersionSchema,
  validation: v.literal("opaque-unverified"),
  source: JsonObjectSchema,
  payload: JsonObjectSchema,
} as const;

/** Metadata only: no bytes, execution semantics, or snapshot restore are implemented here. */
export const OpaqueRecordSchema = v.pipe(v.strictObject(opaqueEntries), v.readonly());
export const ExecutionRecordSchema = v.pipe(
  v.strictObject({ ...opaqueEntries, artifactId: IdSchema }),
  v.readonly(),
);
export const SnapshotRecordSchema = v.pipe(
  v.strictObject({ ...opaqueEntries, boardId: v.exactOptional(IdSchema) }),
  v.readonly(),
);
export const ProjectProvenanceSchema = v.pipe(
  v.strictObject({ projectId: IdSchema, value: ProvenanceSchema }),
  v.readonly(),
);
const array = <T extends v.GenericSchema>(schema: T) => v.pipe(v.array(schema), v.readonly());
export const ProjectStateSchema = v.pipe(
  v.strictObject({
    schemaVersion: SchemaVersionSchema,
    graph: GraphSnapshotSchema,
    blobs: array(v.union([OpaqueRecordSchema, StoredBlobSchema])),
    executionRecords: array(ExecutionRecordSchema),
    provenance: array(ProjectProvenanceSchema),
    snapshots: array(SnapshotRecordSchema),
  }),
  v.readonly(),
);
export type ProjectState = v.InferOutput<typeof ProjectStateSchema>;

const eventEntries = {
  commandId: IdSchema,
  actor: text,
  createdAt: TimestampSchema,
  payload: JsonObjectSchema,
} as const;
export const EventInputSchema = v.pipe(v.strictObject(eventEntries), v.readonly());
export const AuditInputSchema = v.pipe(
  v.strictObject({ reason: text, payload: JsonObjectSchema }),
  v.readonly(),
);
export const CommitSchema = v.pipe(
  v.strictObject({
    projectId: IdSchema,
    expectedSeq: SequenceSchema,
    state: ProjectStateSchema,
    event: EventInputSchema,
    audit: AuditInputSchema,
  }),
  v.readonly(),
);
export type Commit = v.InferOutput<typeof CommitSchema>;
export const StoredEventSchema = v.pipe(
  v.strictObject({
    ...eventEntries,
    projectId: IdSchema,
    seq: v.pipe(SequenceSchema, v.minValue(1)),
  }),
  v.readonly(),
);
export type StoredEvent = v.InferOutput<typeof StoredEventSchema>;
export const StoredAuditSchema = v.pipe(
  v.strictObject({
    ...eventEntries,
    projectId: IdSchema,
    seq: v.pipe(SequenceSchema, v.minValue(1)),
    reason: text,
    auditPayload: JsonObjectSchema,
  }),
  v.readonly(),
);
export type StoredAudit = v.InferOutput<typeof StoredAuditSchema>;
export type RepositoryError =
  | { readonly code: "invalid_data"; readonly message: string }
  | { readonly code: "conflict"; readonly actualSeq: number }
  | { readonly code: "unsupported_database_version"; readonly version: number }
  | { readonly code: "storage_failure"; readonly message: string };

export const invalid = (message: string): Result<never, RepositoryError> =>
  err({ code: "invalid_data", message });

/** Structural integrity and known card content; this is never approval or scientific certification. */
export function validateProjectState(input: unknown): Result<ProjectState, RepositoryError> {
  if (!isLosslessJson(input)) return invalid("State is not lossless JSON");
  const parsed = validate(ProjectStateSchema, input);
  if (!parsed.ok) return invalid("Invalid project state schema");
  const state = parsed.value;
  const graph = validateGraphSnapshot(state.graph);
  if (!graph.ok) return invalid(`Invalid graph: ${graph.error.code}`);
  const project = state.graph.entities.projects[0];
  if (!project || state.graph.entities.projects.length !== 1)
    return invalid("Expected exactly one project");
  if (
    state.graph.entities.boards.some((board) => board.projectId !== project.id) ||
    state.graph.entities.artifacts.some((artifact) => artifact.projectId !== project.id)
  )
    return invalid("State contains another project");
  for (const artifact of state.graph.entities.artifacts) {
    if (!validateArtifactContent(artifact).ok) return invalid("Invalid artifact content");
    const current = state.graph.entities.revisions.find(
      (revision) => revision.id === artifact.revisionId,
    );
    if (!current || !equalJson(artifact.payload, current.payload))
      return invalid("Artifact cache differs from current revision");
    for (const revision of state.graph.entities.revisions.filter(
      (entry) => entry.artifactId === artifact.id,
    )) {
      if (!validateRevisionContent(artifact.kind, revision).ok)
        return invalid("Invalid revision content");
    }
  }
  const artifacts = new Set(state.graph.entities.artifacts.map((entry) => entry.id));
  const boards = new Set(state.graph.entities.boards.map((entry) => entry.id));
  for (const records of [state.blobs, state.executionRecords, state.snapshots]) {
    const ids = new Set<string>();
    for (const entry of records) {
      if (entry.projectId !== project.id || ids.has(entry.id))
        return invalid("Invalid opaque record ownership or duplicate id");
      ids.add(entry.id);
    }
  }
  if (state.executionRecords.some((record) => !artifacts.has(record.artifactId)))
    return invalid("Missing execution artifact");
  if (state.snapshots.some((record) => record.boardId !== undefined && !boards.has(record.boardId)))
    return invalid("Missing snapshot board");
  const provenanceIds = new Set<string>();
  for (const entry of state.provenance) {
    if (entry.projectId !== project.id || provenanceIds.has(entry.value.id))
      return invalid("Invalid provenance ownership or duplicate id");
    provenanceIds.add(entry.value.id);
  }
  return ok(state);
}

export interface Repository {
  /** Each operation owns a short synchronous transaction. Returned objects are detached. */
  readProject(
    projectId: unknown,
  ): Result<{ readonly seq: number; readonly state: ProjectState } | null, RepositoryError>;
  listProjects(): Result<readonly Project[], RepositoryError>;
  /** Caller must authorize the command/AI approval before calling. Atomically stores all three records. */
  commit(input: unknown): Result<{ readonly seq: number }, RepositoryError>;
  eventsAfter(
    projectId: unknown,
    afterSeq: unknown,
  ): Result<readonly StoredEvent[], RepositoryError>;
  readAudit(projectId: unknown): Result<readonly StoredAudit[], RepositoryError>;
  /** Trusted resource registry: no graph mutation or synthetic DomainEvent. */
  registerBlob(input: unknown): Result<BlobRegistration, RepositoryError>;
  readBlob(projectId: unknown, sha256: unknown): Result<StoredBlob | null, RepositoryError>;
  close(): void;
}
