import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import * as v from "valibot";
import {
  IdSchema,
  ProjectSchema,
  err,
  ok,
  validate,
  type Project,
  type Result,
} from "@discussion-room/domain";
import { equalJson, isLosslessJson } from "./json.ts";
import { migrateDatabase } from "./migrations.ts";
import {
  StoredBlobSchema,
  Sha256Schema,
  type StoredBlob,
  type BlobRegistration,
} from "./blob-model.ts";
import {
  CommitSchema,
  SequenceSchema,
  StoredAuditSchema,
  StoredEventSchema,
  invalid,
  validateProjectState,
  type ProjectState,
  type Repository,
  type RepositoryError,
  type StoredAudit,
  type StoredEvent,
} from "./models.ts";

type TableSpec = {
  readonly table: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly data: (state: ProjectState) => readonly unknown[];
};
// Only this application-owned inventory supplies SQL identifiers.
const tables = [
  { table: "projects", fields: { id: "id" }, data: (s) => s.graph.entities.projects },
  {
    table: "boards",
    fields: { id: "id", project_id: "projectId" },
    data: (s) => s.graph.entities.boards,
  },
  {
    table: "artifacts",
    fields: { id: "id", project_id: "projectId", revision_id: "revisionId" },
    data: (s) => s.graph.entities.artifacts,
  },
  {
    table: "artifact_revisions",
    fields: { id: "id", project_id: "$project", artifact_id: "artifactId", parent_id: "parentId" },
    data: (s) => s.graph.entities.revisions,
  },
  {
    table: "canvas_items",
    fields: { id: "id", project_id: "$project", board_id: "boardId", artifact_id: "artifactId" },
    data: (s) => s.graph.entities.canvasItems,
  },
  {
    table: "item_ports",
    fields: { id: "itemId", project_id: "$project" },
    data: (s) => s.graph.itemPorts,
  },
  {
    table: "semantic_relations",
    fields: { id: "id", project_id: "$project", from_id: "fromArtifactId", to_id: "toArtifactId" },
    data: (s) => s.graph.semanticRelations,
  },
  {
    table: "dataflow_edges",
    fields: { id: "id", project_id: "$project", from_id: "fromItemId", to_id: "toItemId" },
    data: (s) => s.graph.dataflowEdges,
  },
  {
    table: "visual_connectors",
    fields: {
      id: "id",
      project_id: "$project",
      board_id: "boardId",
      from_id: "source",
      to_id: "target",
    },
    data: (s) => s.graph.visualConnectors,
  },
  { table: "blobs", fields: { id: "id", project_id: "projectId" }, data: (s) => s.blobs },
  {
    table: "execution_records",
    fields: { id: "id", project_id: "projectId", artifact_id: "artifactId" },
    data: (s) => s.executionRecords,
  },
  {
    table: "provenance",
    fields: { id: "$provenance", project_id: "projectId" },
    data: (s) => s.provenance,
  },
  {
    table: "snapshots",
    fields: { id: "id", project_id: "projectId", board_id: "boardId" },
    data: (s) => s.snapshots,
  },
] as const satisfies readonly TableSpec[];

const recordSchema = v.record(v.string(), v.unknown());
const rowSchema = v.record(v.string(), v.nullable(v.string()));
const documentSchema = v.strictObject({ schemaVersion: v.literal(1), value: v.unknown() });
const sequenceRowSchema = v.strictObject({ seq: SequenceSchema, count: SequenceSchema });
const logRowSchema = v.strictObject({
  project_id: IdSchema,
  seq: v.pipe(SequenceSchema, v.minValue(1)),
  command_id: IdSchema,
  document: v.string(),
});
const auditRowSchema = v.strictObject({
  project_id: IdSchema,
  seq: v.pipe(SequenceSchema, v.minValue(1)),
  document: v.string(),
});

function storageError(error: unknown): Result<never, RepositoryError> {
  return err({
    code: "storage_failure",
    message: error instanceof Error ? error.message : "SQLite operation failed",
  });
}

function decodeDocument(text: string): Result<unknown, RepositoryError> {
  try {
    const input: unknown = JSON.parse(text);
    if (!isLosslessJson(input)) return invalid("Stored document is not lossless JSON");
    const parsed = validate(documentSchema, input);
    return parsed.ok ? ok(parsed.value.value) : invalid("Invalid stored document envelope");
  } catch {
    return invalid("Invalid stored JSON");
  }
}
function encodeDocument(value: unknown): string {
  return JSON.stringify({ schemaVersion: 1, value });
}
function indexValues(
  spec: TableSpec,
  value: unknown,
  projectId: string,
): Result<readonly SQLInputValue[], RepositoryError> {
  const parsed = validate(recordSchema, value);
  if (!parsed.ok) return invalid("Invalid stored entity object");
  const values: SQLInputValue[] = [];
  for (const field of Object.values(spec.fields)) {
    let input: unknown = field === "$project" ? projectId : parsed.value[field];
    if (field === "$provenance") {
      const provenance = validate(recordSchema, parsed.value.value);
      if (!provenance.ok) return invalid("Invalid provenance envelope");
      input = provenance.value.id;
    }
    if (
      input === undefined &&
      (field === "parentId" || field === "artifactId" || field === "boardId")
    )
      values.push(null);
    else if (typeof input === "string") values.push(input);
    else return invalid("Invalid stored entity index");
  }
  return ok(values);
}

/** Provenance, runs and metadata manifests are historical facts, never mutable caches. */
function retainHistory<T>(
  collection: string,
  previous: readonly T[],
  next: readonly T[],
  identify: (value: T) => string,
): Result<void, RepositoryError> {
  const byId = new Map(next.map((value) => [identify(value), value]));
  for (const value of previous) {
    const current = byId.get(identify(value));
    if (current === undefined) return invalid(`Historical ${collection} records must be retained`);
    if (!equalJson(value, current))
      return invalid(`Historical ${collection} records are immutable`);
  }
  return ok(undefined);
}

function checkVersions(previous: ProjectState, next: ProjectState): Result<void, RepositoryError> {
  const historyChecks = [
    retainHistory("provenance", previous.provenance, next.provenance, (entry) => entry.value.id),
    retainHistory(
      "execution",
      previous.executionRecords,
      next.executionRecords,
      (entry) => entry.id,
    ),
    retainHistory("blob metadata", previous.blobs, next.blobs, (entry) => entry.id),
    retainHistory("snapshot", previous.snapshots, next.snapshots, (entry) => entry.id),
  ];
  for (const check of historyChecks) if (!check.ok) return check;
  const versioned = [
    "projects",
    "boards",
    "artifacts",
    "artifact_revisions",
    "canvas_items",
    "semantic_relations",
    "dataflow_edges",
    "visual_connectors",
  ];
  for (const spec of tables) {
    if (!versioned.includes(spec.table)) continue;
    const old = new Map<string, unknown>();
    for (const value of spec.data(previous)) {
      const record = validate(recordSchema, value);
      if (!record.ok || typeof record.value.id !== "string")
        return invalid("Invalid previous entity");
      old.set(record.value.id, value);
    }
    const nextIds = new Set<string>();
    for (const value of spec.data(next)) {
      const record = validate(recordSchema, value);
      if (
        !record.ok ||
        typeof record.value.id !== "string" ||
        typeof record.value.version !== "number"
      )
        return invalid("Invalid next entity");
      const id = record.value.id;
      nextIds.add(id);
      const before = old.get(id);
      if (before === undefined) {
        if (record.value.version !== 1) return invalid("New entities must start at version 1");
      } else if (!equalJson(before, value)) {
        if (spec.table === "artifact_revisions")
          return invalid("Historical revisions are immutable");
        const oldRecord = validate(recordSchema, before);
        if (
          !oldRecord.ok ||
          typeof oldRecord.value.version !== "number" ||
          record.value.version !== oldRecord.value.version + 1
        )
          return invalid("Changed entity must increment version exactly once");
      }
    }
    if (spec.table === "artifact_revisions" && [...old.keys()].some((id) => !nextIds.has(id)))
      return invalid("Historical revisions must be retained");
  }
  return ok(undefined);
}

/** Opens only the explicitly supplied path; does not choose/create DATA_DIR or expose SQL. */
export function openSqliteRepository(path: string): Result<Repository, RepositoryError> {
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      timeout: 1000,
    });
  } catch (error) {
    return storageError(error);
  }
  try {
    const migration = migrateDatabase(database);
    if (!migration.ok) {
      database.close();
      return migration;
    }
    database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL");
    const foreignKeys = database.prepare("PRAGMA foreign_keys").get();
    if (!v.is(v.object({ foreign_keys: v.literal(1) }), foreignKeys)) {
      database.close();
      return storageError(new Error("Foreign keys are disabled"));
    }
  } catch (error) {
    database.close();
    return storageError(error);
  }
  let closed = false;

  const transaction = <T>(
    write: boolean,
    operation: () => Result<T, RepositoryError>,
  ): Result<T, RepositoryError> => {
    if (closed) return storageError(new Error("Repository is closed"));
    let started = false;
    try {
      database.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
      started = true;
      const result = operation();
      database.exec(result.ok ? "COMMIT" : "ROLLBACK");
      started = false;
      return result;
    } catch (error) {
      if (started) {
        try {
          database.exec("ROLLBACK");
        } catch (rollbackError) {
          return storageError(rollbackError);
        }
      }
      return storageError(error);
    }
  };
  const currentSeq = (projectId: string): Result<number, RepositoryError> => {
    const result = validate(
      sequenceRowSchema,
      database
        .prepare(
          "SELECT COALESCE(MAX(seq), 0) AS seq, COUNT(*) AS count FROM event_log WHERE project_id = ?",
        )
        .get(projectId),
    );
    return result.ok && result.value.seq === result.value.count
      ? ok(result.value.seq)
      : invalid("Invalid stored event sequence");
  };
  const readState = (projectId: string): Result<ProjectState | null, RepositoryError> => {
    const contents: Record<string, readonly unknown[]> = {};
    for (const spec of tables) {
      const columns = [...Object.keys(spec.fields), "document"];
      const rows: unknown[] = database
        .prepare(
          `SELECT ${columns.join(", ")} FROM ${spec.table} WHERE ${spec.table === "projects" ? "id" : "project_id"} = ? ORDER BY id`,
        )
        .all(projectId);
      const entries: unknown[] = [];
      for (const row of rows) {
        const parsed = validate(rowSchema, row);
        if (!parsed.ok || typeof parsed.value.document !== "string")
          return invalid("Invalid SQLite entity row");
        const decoded = decodeDocument(parsed.value.document);
        if (!decoded.ok) return decoded;
        const indices = indexValues(spec, decoded.value, projectId);
        if (!indices.ok) return indices;
        if (
          Object.keys(spec.fields).some(
            (column, index) => parsed.value[column] !== indices.value[index],
          )
        )
          return invalid("Stored index/document mismatch");
        entries.push(decoded.value);
      }
      contents[spec.table] = entries;
    }
    if (contents.projects?.length === 0) {
      const logs = validate(
        v.strictObject({ count: SequenceSchema }),
        database
          .prepare(
            "SELECT (SELECT COUNT(*) FROM event_log WHERE project_id = ?) + (SELECT COUNT(*) FROM audit_log WHERE project_id = ?) AS count",
          )
          .get(projectId, projectId),
      );
      if (!logs.ok) return invalid("Invalid orphan log check");
      return logs.value.count > 0 || Object.values(contents).some((entries) => entries.length > 0)
        ? invalid("Orphaned project records")
        : ok(null);
    }
    return validateProjectState({
      schemaVersion: 1,
      graph: {
        entities: {
          projects: contents.projects,
          boards: contents.boards,
          artifacts: contents.artifacts,
          revisions: contents.artifact_revisions,
          canvasItems: contents.canvas_items,
        },
        itemPorts: contents.item_ports,
        semanticRelations: contents.semantic_relations,
        dataflowEdges: contents.dataflow_edges,
        visualConnectors: contents.visual_connectors,
      },
      blobs: contents.blobs,
      executionRecords: contents.execution_records,
      provenance: contents.provenance,
      snapshots: contents.snapshots,
    });
  };
  const readLogs = (
    projectId: string,
    afterSeq: number,
  ): Result<readonly StoredEvent[], RepositoryError> => {
    const rows: unknown[] = database
      .prepare(
        "SELECT project_id, seq, command_id, document FROM event_log WHERE project_id = ? AND seq > ? ORDER BY seq",
      )
      .all(projectId, afterSeq);
    const events: StoredEvent[] = [];
    let previous = afterSeq;
    for (const row of rows) {
      const parsed = validate(logRowSchema, row);
      if (!parsed.ok) return invalid("Invalid event row");
      const decoded = decodeDocument(parsed.value.document);
      if (!decoded.ok) return decoded;
      const event = validate(StoredEventSchema, decoded.value);
      if (
        !event.ok ||
        event.value.projectId !== projectId ||
        event.value.seq !== parsed.value.seq ||
        event.value.commandId !== parsed.value.command_id ||
        event.value.seq !== previous + 1
      )
        return invalid("Invalid event identity/sequence");
      previous = event.value.seq;
      events.push(event.value);
    }
    return ok(events);
  };

  const readAudits = (projectId: string): Result<readonly StoredAudit[], RepositoryError> => {
    const events = readLogs(projectId, 0);
    if (!events.ok) return events;
    const rows: unknown[] = database
      .prepare("SELECT project_id, seq, document FROM audit_log WHERE project_id = ? ORDER BY seq")
      .all(projectId);
    if (rows.length !== events.value.length) return invalid("Audit/event count mismatch");
    const eventsBySeq = new Map(events.value.map((event) => [event.seq, event]));
    const audits: StoredAudit[] = [];
    for (const row of rows) {
      const parsed = validate(auditRowSchema, row);
      if (!parsed.ok) return invalid("Invalid audit row");
      const decoded = decodeDocument(parsed.value.document);
      if (!decoded.ok) return decoded;
      const audit = validate(StoredAuditSchema, decoded.value);
      const event = eventsBySeq.get(parsed.value.seq);
      if (
        !audit.ok ||
        !event ||
        audit.value.projectId !== projectId ||
        audit.value.seq !== parsed.value.seq ||
        audit.value.commandId !== event.commandId ||
        audit.value.actor !== event.actor ||
        audit.value.createdAt !== event.createdAt ||
        !equalJson(audit.value.payload, event.payload)
      )
        return invalid("Audit/event identity mismatch");
      audits.push(audit.value);
    }
    return ok(audits);
  };

  return ok({
    readProject(projectId) {
      const parsed = validate(IdSchema, projectId);
      if (!parsed.ok) return invalid("Invalid project id");
      return transaction<{ readonly seq: number; readonly state: ProjectState } | null>(
        false,
        () => {
          const state = readState(parsed.value);
          if (!state.ok) return state;
          if (state.value === null) return ok(null);
          const seq = currentSeq(parsed.value);
          return seq.ok ? ok({ state: state.value, seq: seq.value }) : seq;
        },
      );
    },
    listProjects() {
      return transaction(false, () => {
        const rows: unknown[] = database
          .prepare("SELECT id, document FROM projects ORDER BY id")
          .all();
        const projects: Project[] = [];
        for (const row of rows) {
          const parsed = validate(v.strictObject({ id: IdSchema, document: v.string() }), row);
          if (!parsed.ok) return invalid("Invalid project row");
          const decoded = decodeDocument(parsed.value.document);
          if (!decoded.ok) return decoded;
          const project = validate(ProjectSchema, decoded.value);
          if (!project.ok || project.value.id !== parsed.value.id)
            return invalid("Invalid stored project");
          projects.push(project.value);
        }
        return ok(projects);
      });
    },
    commit(input) {
      // Reject accessors, lossy values and cycles before Valibot or JSON.stringify.
      if (!isLosslessJson(input)) return invalid("Commit is not lossless JSON");
      const parsed = validate(CommitSchema, input);
      if (!parsed.ok) return invalid("Invalid commit schema");
      const command = parsed.value;
      const checked = validateProjectState(command.state);
      if (!checked.ok) return checked;
      if (checked.value.graph.entities.projects[0]?.id !== command.projectId)
        return invalid("Commit project mismatch");
      return transaction(true, () => {
        const seq = currentSeq(command.projectId);
        if (!seq.ok) return seq;
        if (seq.value !== command.expectedSeq)
          return err({ code: "conflict", actualSeq: seq.value });
        if (seq.value >= Number.MAX_SAFE_INTEGER) return invalid("Event sequence exhausted");
        const auditIntegrity = readAudits(command.projectId);
        if (!auditIntegrity.ok) return auditIntegrity;
        const before = readState(command.projectId);
        if (!before.ok) return before;
        // Resources may arrive after this graph snapshot was read, without advancing event seq.
        // Only verified registry entries are merged; opaque history still requires full retention.
        const incomingIds = new Set(command.state.blobs.map((blob) => blob.id));
        const registered = before.value?.blobs.filter((blob) => "storage" in blob) ?? [];
        for (const blob of command.state.blobs) {
          if ("storage" in blob && !registered.some((entry) => equalJson(entry, blob)))
            return invalid("Content resources must be registered through registerBlob");
        }
        const nextState: ProjectState = {
          ...command.state,
          blobs: [
            ...command.state.blobs,
            ...registered.filter((blob) => !incomingIds.has(blob.id)),
          ],
        };
        const empty: ProjectState = {
          ...command.state,
          graph: {
            ...command.state.graph,
            entities: { projects: [], boards: [], artifacts: [], revisions: [], canvasItems: [] },
            semanticRelations: [],
            dataflowEdges: [],
            visualConnectors: [],
          },
        };
        const versions = checkVersions(before.value ?? empty, nextState);
        if (!versions.ok) return versions;
        // project rows and durable logs are retained; only the supplied project aggregate is replaced.
        for (const spec of tables.toReversed()) {
          if (spec.table !== "projects")
            database
              .prepare(`DELETE FROM ${spec.table} WHERE project_id = ?`)
              .run(command.projectId);
        }
        for (const spec of tables) {
          const columns = [...Object.keys(spec.fields), "document"];
          const write = database.prepare(
            `INSERT INTO ${spec.table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})${spec.table === "projects" ? " ON CONFLICT(id) DO UPDATE SET document = excluded.document" : ""}`,
          );
          for (const value of spec.data(nextState)) {
            const indices = indexValues(spec, value, command.projectId);
            if (!indices.ok) return indices;
            write.run(...indices.value, encodeDocument(value));
          }
        }
        const event: StoredEvent = {
          ...command.event,
          projectId: command.projectId,
          seq: seq.value + 1,
        };
        const audit: StoredAudit = {
          ...event,
          reason: command.audit.reason,
          auditPayload: command.audit.payload,
        };
        database
          .prepare(
            "INSERT INTO event_log (project_id, seq, command_id, document) VALUES (?, ?, ?, ?)",
          )
          .run(command.projectId, event.seq, event.commandId, encodeDocument(event));
        database
          .prepare("INSERT INTO audit_log (project_id, seq, document) VALUES (?, ?, ?)")
          .run(command.projectId, event.seq, encodeDocument(audit));
        return ok({ seq: event.seq });
      });
    },
    eventsAfter(projectId, afterSeq) {
      const id = validate(IdSchema, projectId);
      const sequence = validate(SequenceSchema, afterSeq);
      if (!id.ok || !sequence.ok) return invalid("Invalid event cursor");
      return transaction(false, () => readLogs(id.value, sequence.value));
    },
    readAudit(projectId) {
      const id = validate(IdSchema, projectId);
      if (!id.ok) return invalid("Invalid project id");
      return transaction(false, () => readAudits(id.value));
    },
    registerBlob(input) {
      if (!isLosslessJson(input)) return invalid("Invalid blob metadata JSON");
      const parsed = validate(StoredBlobSchema, input);
      if (!parsed.ok) return invalid("Invalid blob metadata");
      const blob = parsed.value;
      return transaction<BlobRegistration>(true, () => {
        const state = readState(blob.projectId);
        if (!state.ok) return state;
        if (!state.value) return invalid("Unknown project");
        const existing = state.value.blobs.find(
          (entry): entry is StoredBlob => "storage" in entry && entry.sha256 === blob.sha256,
        );
        if (existing)
          return existing.size === blob.size
            ? ok({ metadata: existing, deduplicated: true })
            : invalid("Content hash has inconsistent size");
        database
          .prepare("INSERT INTO blobs(id, project_id, document) VALUES (?, ?, ?)")
          .run(blob.id, blob.projectId, encodeDocument(blob));
        return ok({ metadata: blob, deduplicated: false });
      });
    },
    readBlob(projectId, sha256) {
      const id = validate(IdSchema, projectId);
      const hash = validate(Sha256Schema, sha256);
      if (!id.ok || !hash.ok) return invalid("Invalid blob lookup");
      return transaction(false, () => {
        const state = readState(id.value);
        if (!state.ok) return state;
        return ok(
          state.value?.blobs.find(
            (entry): entry is StoredBlob => "storage" in entry && entry.sha256 === hash.value,
          ) ?? null,
        );
      });
    },
    close() {
      if (!closed) {
        database.close();
        closed = true;
      }
    },
  });
}
