import { DatabaseSync } from "node:sqlite";
import * as v from "valibot";
import { err, ok, type Result } from "@discussion-room/domain";
import { type RepositoryError } from "./models.ts";

/** SQL is application-owned. Never accept migration SQL or identifiers from an external caller. */
export const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE projects (id TEXT PRIMARY KEY, document TEXT NOT NULL CHECK(json_valid(document))) STRICT;
      CREATE TABLE boards (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        document TEXT NOT NULL CHECK(json_valid(document)), UNIQUE(id, project_id)
      ) STRICT;
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), revision_id TEXT NOT NULL,
        document TEXT NOT NULL CHECK(json_valid(document)), UNIQUE(id, project_id),
        FOREIGN KEY(revision_id, id) REFERENCES artifact_revisions(id, artifact_id) DEFERRABLE INITIALLY DEFERRED
      ) STRICT;
      CREATE TABLE artifact_revisions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), artifact_id TEXT NOT NULL,
        parent_id TEXT, document TEXT NOT NULL CHECK(json_valid(document)), UNIQUE(id, artifact_id),
        FOREIGN KEY(artifact_id, project_id) REFERENCES artifacts(id, project_id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(parent_id, artifact_id) REFERENCES artifact_revisions(id, artifact_id) DEFERRABLE INITIALLY DEFERRED
      ) STRICT;
      CREATE TABLE canvas_items (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), board_id TEXT NOT NULL, artifact_id TEXT,
        document TEXT NOT NULL CHECK(json_valid(document)),
        FOREIGN KEY(board_id, project_id) REFERENCES boards(id, project_id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(artifact_id, project_id) REFERENCES artifacts(id, project_id) DEFERRABLE INITIALLY DEFERRED
      ) STRICT;
      CREATE TABLE item_ports (
        id TEXT PRIMARY KEY REFERENCES canvas_items(id) DEFERRABLE INITIALLY DEFERRED,
        project_id TEXT NOT NULL REFERENCES projects(id), document TEXT NOT NULL CHECK(json_valid(document))
      ) STRICT;
      CREATE TABLE semantic_relations (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), from_id TEXT NOT NULL, to_id TEXT NOT NULL,
        document TEXT NOT NULL CHECK(json_valid(document)),
        FOREIGN KEY(from_id, project_id) REFERENCES artifacts(id, project_id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(to_id, project_id) REFERENCES artifacts(id, project_id) DEFERRABLE INITIALLY DEFERRED
      ) STRICT;
      CREATE TABLE dataflow_edges (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), from_id TEXT NOT NULL REFERENCES canvas_items(id) DEFERRABLE INITIALLY DEFERRED,
        to_id TEXT NOT NULL REFERENCES canvas_items(id) DEFERRABLE INITIALLY DEFERRED,
        document TEXT NOT NULL CHECK(json_valid(document))
      ) STRICT;
      CREATE TABLE visual_connectors (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), board_id TEXT NOT NULL,
        from_id TEXT NOT NULL REFERENCES canvas_items(id) DEFERRABLE INITIALLY DEFERRED,
        to_id TEXT NOT NULL REFERENCES canvas_items(id) DEFERRABLE INITIALLY DEFERRED,
        document TEXT NOT NULL CHECK(json_valid(document)),
        FOREIGN KEY(board_id, project_id) REFERENCES boards(id, project_id) DEFERRABLE INITIALLY DEFERRED
      ) STRICT;
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE blobs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        document TEXT NOT NULL CHECK(json_valid(document))
      ) STRICT;
      CREATE TABLE execution_records (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), artifact_id TEXT NOT NULL,
        document TEXT NOT NULL CHECK(json_valid(document)),
        FOREIGN KEY(artifact_id, project_id) REFERENCES artifacts(id, project_id) DEFERRABLE INITIALLY DEFERRED
      ) STRICT;
      CREATE TABLE provenance (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        document TEXT NOT NULL CHECK(json_valid(document))
      ) STRICT;
      CREATE TABLE snapshots (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), board_id TEXT,
        document TEXT NOT NULL CHECK(json_valid(document)),
        FOREIGN KEY(board_id, project_id) REFERENCES boards(id, project_id) DEFERRABLE INITIALLY DEFERRED
      ) STRICT;
      CREATE TABLE event_log (
        project_id TEXT NOT NULL REFERENCES projects(id), seq INTEGER NOT NULL CHECK(seq > 0),
        command_id TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)),
        PRIMARY KEY(project_id, seq), UNIQUE(project_id, command_id)
      ) STRICT;
      CREATE TABLE audit_log (
        project_id TEXT NOT NULL, seq INTEGER NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)),
        PRIMARY KEY(project_id, seq), FOREIGN KEY(project_id, seq) REFERENCES event_log(project_id, seq)
      ) STRICT;
    `,
  },
  {
    version: 3,
    sql: `
      CREATE INDEX boards_project ON boards(project_id, id);
      CREATE INDEX artifacts_project ON artifacts(project_id, id);
      CREATE INDEX revisions_project ON artifact_revisions(project_id, id);
      CREATE INDEX canvas_project ON canvas_items(project_id, id);
      CREATE INDEX ports_project ON item_ports(project_id, id);
      CREATE INDEX semantic_project ON semantic_relations(project_id, id);
      CREATE INDEX dataflow_project ON dataflow_edges(project_id, id);
      CREATE INDEX connectors_project ON visual_connectors(project_id, id);
      CREATE INDEX blobs_project ON blobs(project_id, id);
      CREATE INDEX executions_project ON execution_records(project_id, id);
      CREATE INDEX provenance_project ON provenance(project_id, id);
      CREATE INDEX snapshots_project ON snapshots(project_id, id);
      CREATE INDEX artifacts_current_revision ON artifacts(revision_id, id);
      CREATE INDEX revisions_artifact ON artifact_revisions(artifact_id, project_id);
      CREATE INDEX revisions_parent ON artifact_revisions(parent_id, artifact_id);
      CREATE INDEX canvas_board ON canvas_items(board_id, project_id);
      CREATE INDEX canvas_artifact ON canvas_items(artifact_id, project_id);
      CREATE INDEX semantic_from ON semantic_relations(from_id, project_id);
      CREATE INDEX semantic_to ON semantic_relations(to_id, project_id);
      CREATE INDEX dataflow_from ON dataflow_edges(from_id);
      CREATE INDEX dataflow_to ON dataflow_edges(to_id);
      CREATE INDEX connectors_board ON visual_connectors(board_id, project_id);
      CREATE INDEX connectors_from ON visual_connectors(from_id);
      CREATE INDEX connectors_to ON visual_connectors(to_id);
      CREATE INDEX executions_artifact ON execution_records(artifact_id, project_id);
      CREATE INDEX snapshots_board ON snapshots(board_id, project_id);
    `,
  },
  {
    version: 4,
    sql: `CREATE UNIQUE INDEX blobs_content_project ON blobs(project_id, json_extract(document, '$.value.sha256'))
      WHERE json_extract(document, '$.value.storage') = 'content-addressed';`,
  },
] as const;
export const DATABASE_VERSION = 4;
const versionRow = v.object({ user_version: v.pipe(v.number(), v.safeInteger(), v.minValue(0)) });

/** All pending migrations and user_version changes roll back together. */
export function migrateDatabase(database: DatabaseSync): Result<void, RepositoryError> {
  let started = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    started = true;
    // A concurrent opener may have migrated while this connection waited for the write lock.
    const parsed = v.safeParse(versionRow, database.prepare("PRAGMA user_version").get());
    if (!parsed.success) {
      database.exec("ROLLBACK");
      return err({ code: "invalid_data", message: "Invalid SQLite user_version" });
    }
    const version = parsed.output.user_version;
    if (version > DATABASE_VERSION) {
      database.exec("ROLLBACK");
      return err({ code: "unsupported_database_version", version });
    }
    for (const migration of MIGRATIONS) {
      if (migration.version <= version) continue;
      database.exec(migration.sql);
      // The version is a fixed source-code integer, never user input.
      database.exec(`PRAGMA user_version = ${migration.version}`);
    }
    database.exec("COMMIT");
    return ok(undefined);
  } catch (error) {
    if (started) database.exec("ROLLBACK");
    return err({
      code: "storage_failure",
      message: error instanceof Error ? error.message : "Migration failed",
    });
  }
}
