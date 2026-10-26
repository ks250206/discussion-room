import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { validate, IdSchema, TimestampSchema, type Result } from "@discussion-room/domain";
import { openSqliteRepository, type ProjectState, type Repository } from "./index.ts";
import { DATABASE_VERSION, MIGRATIONS, migrateDatabase } from "./migrations.ts";
import { isLosslessJson } from "./json.ts";
import { validateProjectState as validateProject } from "./models.ts";

function success<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
const id = (n: number) =>
  success(validate(IdSchema, `01ARZ3NDEKTSV4RRFFQ69G${String(n).padStart(4, "0")}`));
const time = success(validate(TimestampSchema, "2026-10-27T01:02:03.000Z"));
function state(offset = 0): ProjectState {
  return success(
    validateProject({
      schemaVersion: 1,
      graph: {
        entities: {
          projects: [
            {
              id: id(offset + 1),
              title: "研究",
              description: "NaN is a literal here",
              createdAt: time,
              version: 1,
            },
          ],
          boards: [
            {
              id: id(offset + 2),
              projectId: id(offset + 1),
              name: "Board",
              viewport: { x: 0, y: 0, zoom: 1 },
              version: 1,
            },
          ],
          artifacts: [
            {
              id: id(offset + 3),
              projectId: id(offset + 1),
              kind: "future-scientific-card",
              payload: { unit: "pm", decimal: "112.00", originType: "ai", missing: null },
              revisionId: id(offset + 4),
              version: 1,
            },
          ],
          revisions: [
            {
              id: id(offset + 4),
              artifactId: id(offset + 3),
              payload: { unit: "pm", decimal: "112.00", originType: "ai", missing: null },
              author: "Researcher",
              createdAt: time,
              version: 1,
            },
          ],
          canvasItems: [
            {
              id: id(offset + 5),
              boardId: id(offset + 2),
              artifactId: id(offset + 3),
              x: 1.5,
              y: 2,
              width: 200,
              height: 100,
              viewState: { collapsed: false },
              version: 1,
            },
            {
              id: id(offset + 6),
              boardId: id(offset + 2),
              x: 10,
              y: 20,
              width: 200,
              height: 100,
              viewState: {},
              version: 1,
            },
          ],
        },
        itemPorts: [
          {
            itemId: id(offset + 5),
            ports: [{ name: "out", direction: "output", type: "number", metadata: { unit: "pm" } }],
          },
          { itemId: id(offset + 6), ports: [{ name: "in", direction: "input", type: "number" }] },
        ],
        semanticRelations: [
          {
            id: id(offset + 7),
            type: "semantic-relation",
            fromArtifactId: id(offset + 3),
            toArtifactId: id(offset + 3),
            relation: "references",
            rationale: "",
            createdBy: "R",
            createdAt: time,
            version: 1,
          },
        ],
        dataflowEdges: [
          {
            id: id(offset + 8),
            type: "dataflow-edge",
            fromItemId: id(offset + 5),
            fromPort: "out",
            toItemId: id(offset + 6),
            toPort: "in",
            description: "",
            createdBy: "R",
            createdAt: time,
            version: 1,
          },
        ],
        visualConnectors: [
          {
            id: id(offset + 9),
            type: "visual-connector",
            boardId: id(offset + 2),
            source: id(offset + 5),
            target: id(offset + 6),
            style: { stroke: "red" },
            description: "",
            createdBy: "R",
            createdAt: time,
            version: 1,
          },
        ],
      },
      blobs: [
        {
          id: id(offset + 10),
          projectId: id(offset + 1),
          schemaVersion: 1,
          validation: "opaque-unverified",
          source: { filename: "input.csv" },
          payload: { sha256: "unverified source metadata" },
        },
      ],
      executionRecords: [
        {
          id: id(offset + 11),
          projectId: id(offset + 1),
          artifactId: id(offset + 3),
          schemaVersion: 1,
          validation: "opaque-unverified",
          source: { runtime: "client" },
          payload: { status: "unverified" },
        },
      ],
      provenance: [
        {
          projectId: id(offset + 1),
          value: {
            id: id(offset + 12),
            originType: "ai",
            generatedBy: "ai",
            modelId: "original-model",
            sourceIds: [],
            createdBy: "R",
            method: "proposal",
            timestamp: time,
          },
        },
      ],
      snapshots: [
        {
          id: id(offset + 13),
          projectId: id(offset + 1),
          boardId: id(offset + 2),
          schemaVersion: 1,
          validation: "opaque-unverified",
          source: { method: "manual" },
          payload: { manifestRef: "unverified" },
        },
      ],
    }),
  );
}
function command(value: ProjectState, expectedSeq = 0, commandNumber = 90) {
  return {
    projectId: value.graph.entities.projects[0]?.id,
    expectedSeq,
    state: value,
    event: {
      commandId: id(commandNumber),
      actor: "R",
      createdAt: time,
      payload: {
        eventType: "opaque for future protocol",
        scientific: { value: "112.00", unit: "pm" },
      },
    },
    audit: { reason: "User authored edit", payload: { approvedBy: "upstream command boundary" } },
  };
}
const directories: string[] = [];
const repositories: Repository[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "discussion-repository-"));
  directories.push(directory);
  const path = join(directory, "data.sqlite");
  const repository = success(openSqliteRepository(path));
  repositories.push(repository);
  return { repository, path };
}
function reopen(path: string) {
  const repository = success(openSqliteRepository(path));
  repositories.push(repository);
  return repository;
}
const replaceEntities = (value: ProjectState, entities: ProjectState["graph"]["entities"]) => ({
  ...value,
  graph: { ...value.graph, entities },
});
const changeTitle = (value: ProjectState, title: string) =>
  replaceEntities(value, {
    ...value.graph.entities,
    projects: value.graph.entities.projects.map((project) => ({
      ...project,
      title,
      version: project.version + 1,
    })),
  });

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("SQLite repository", () => {
  test("creates all versioned tables and enables WAL and foreign keys", () => {
    const { path, repository } = fixture();
    expect(repository.readProject(id(1))).toEqual({ ok: true, value: null });
    const database = new DatabaseSync(path);
    try {
      expect(database.prepare("PRAGMA user_version").get()).toMatchObject({
        user_version: DATABASE_VERSION,
      });
      expect(database.prepare("PRAGMA journal_mode").get()).toMatchObject({ journal_mode: "wal" });
      const names = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "projects",
          "boards",
          "artifacts",
          "artifact_revisions",
          "canvas_items",
          "semantic_relations",
          "dataflow_edges",
          "visual_connectors",
          "blobs",
          "execution_records",
          "provenance",
          "snapshots",
          "event_log",
          "audit_log",
        ]),
      );
    } finally {
      database.close();
    }
  });

  test("persists complete graph, opaque records, original scientific metadata and durable logs across reopen", () => {
    const { path, repository } = fixture();
    const original = state();
    expect(repository.commit(command(original))).toEqual({ ok: true, value: { seq: 1 } });
    repository.close();
    const next = reopen(path);
    expect(success(next.readProject(id(1)))).toEqual({ seq: 1, state: original });
    expect(success(next.listProjects())).toEqual(original.graph.entities.projects);
    expect(success(next.eventsAfter(id(1), 0))).toEqual([
      { ...command(original).event, projectId: id(1), seq: 1 },
    ]);
    expect(success(next.readAudit(id(1)))).toEqual([
      {
        ...command(original).event,
        projectId: id(1),
        seq: 1,
        reason: command(original).audit.reason,
        auditPayload: command(original).audit.payload,
      },
    ]);
  });

  test("per-project sequences and cursors are exact with independent connections", () => {
    const { path, repository } = fixture();
    const other = reopen(path);
    success(repository.commit(command(state())));
    success(other.commit(command(state(100), 0, 190)));
    expect(repository.commit(command(changeTitle(state(), "new"), 0, 91))).toEqual({
      ok: false,
      error: { code: "conflict", actualSeq: 1 },
    });
    expect(success(other.commit(command(changeTitle(state(), "new"), 1, 91)))).toEqual({ seq: 2 });
    expect(success(repository.eventsAfter(id(1), 1)).map((event) => event.seq)).toEqual([2]);
    expect(success(repository.eventsAfter(id(101), 0)).map((event) => event.seq)).toEqual([1]);
    expect(success(repository.eventsAfter(id(1), 999))).toEqual([]);
    expect(success(repository.eventsAfter(id(999), 0))).toEqual([]);
  });

  test("rolls back replacement, event and sequence when final audit insertion fails", () => {
    const { path, repository } = fixture();
    success(repository.commit(command(state())));
    const database = new DatabaseSync(path);
    database.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit storage failure'); END",
    );
    database.close();
    expect(repository.commit(command(changeTitle(state(), "lost edit"), 1, 91))).toMatchObject({
      ok: false,
      error: { code: "storage_failure" },
    });
    expect(success(repository.readProject(id(1)))?.state).toEqual(state());
    expect(success(repository.eventsAfter(id(1), 0))).toHaveLength(1);
    expect(success(repository.readAudit(id(1)))).toHaveLength(1);
    const repair = new DatabaseSync(path);
    repair.exec("DROP TRIGGER fail_audit");
    repair.close();
    expect(success(repository.commit(command(changeTitle(state(), "saved edit"), 1, 91)))).toEqual({
      seq: 2,
    });
  });

  test("duplicate command and cross-project id collision roll back every change", () => {
    const { repository } = fixture();
    success(repository.commit(command(state())));
    expect(repository.commit(command(changeTitle(state(), "duplicate"), 1))).toMatchObject({
      ok: false,
      error: { code: "storage_failure" },
    });
    const different = state(100);
    const collided = replaceEntities(different, {
      ...different.graph.entities,
      boards: different.graph.entities.boards.map((board) => ({ ...board, id: id(2) })),
      canvasItems: different.graph.entities.canvasItems.map((item) => ({
        ...item,
        boardId: id(2),
      })),
    });
    const input = {
      ...collided,
      graph: {
        ...collided.graph,
        visualConnectors: collided.graph.visualConnectors.map((line) => ({
          ...line,
          boardId: id(2),
        })),
      },
      snapshots: collided.snapshots.map((snapshot) => ({ ...snapshot, boardId: id(2) })),
    };
    expect(repository.commit(command(input, 0, 191))).toMatchObject({
      ok: false,
      error: { code: "storage_failure" },
    });
    expect(success(repository.readProject(id(101)))).toBeNull();
    expect(success(repository.readProject(id(1)))?.state).toEqual(state());
  });

  test("SQL-shaped strings are bound as data and caller IDs are validated", () => {
    const { repository } = fixture();
    const value = state();
    const title = "'); DROP TABLE projects; --";
    const changed = replaceEntities(value, {
      ...value.graph.entities,
      projects: value.graph.entities.projects.map((project) => ({ ...project, title })),
    });
    success(repository.commit(command(changed)));
    expect(success(repository.listProjects())[0]?.title).toBe(title);
    expect(repository.readProject("' OR 1=1 --")).toMatchObject({
      ok: false,
      error: { code: "invalid_data" },
    });
    expect(repository.eventsAfter(id(1), -1)).toMatchObject({ ok: false });
  });

  test.each([
    NaN,
    Infinity,
    -Infinity,
    -0,
    undefined,
    () => 1,
    Symbol("invalid"),
    1n,
    new Date(),
    { toJSON: () => ({ converted: true }) },
    new Map(),
    [undefined],
    Array(1),
  ])("rejects lossy opaque payload values: %s", (lossy) => {
    const { repository } = fixture();
    const value = command(state());
    const input = { ...value, event: { ...value.event, payload: { lossy } } };
    expect(repository.commit(input)).toMatchObject({ ok: false, error: { code: "invalid_data" } });
    expect(success(repository.listProjects())).toEqual([]);
  });

  test("rejects cycles, accessors, symbol keys, hidden properties and hostile proxies without invoking them", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let invoked = false;
    const getter = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        invoked = true;
        return 1;
      },
    });
    const hidden = Object.defineProperty({}, "hidden", { value: 1 });
    const symbol = { [Symbol("hidden")]: 1 };
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("hostile");
        },
      },
    );
    const { repository } = fixture();
    for (const payload of [cyclic, getter, hidden, symbol, proxy]) {
      expect(
        repository.commit({ ...command(state()), audit: { reason: "reason", payload } }),
      ).toMatchObject({ ok: false, error: { code: "invalid_data" } });
    }
    expect(invoked).toBe(false);
    const alias = { unit: "pm" };
    expect(isLosslessJson({ first: alias, second: alias })).toBe(true);
  });

  test("unknown document versions and invalid known card content fail without defaults", () => {
    const { repository } = fixture();
    expect(
      repository.commit({ ...command(state()), state: { ...state(), schemaVersion: 2 } }),
    ).toMatchObject({ ok: false });
    const value = state();
    const wrong = replaceEntities(value, {
      ...value.graph.entities,
      artifacts: value.graph.entities.artifacts.map((artifact) => ({
        ...artifact,
        kind: "hypothesis",
      })),
    });
    expect(repository.commit(command(wrong))).toMatchObject({
      ok: false,
      error: { code: "invalid_data" },
    });
    expect(success(repository.readProject(id(1)))).toBeNull();
  });

  test("references, ownership, cache equality and graph compatibility are validated atomically", () => {
    const { repository } = fixture();
    const value = state();
    const entities = value.graph.entities;
    const cases = [
      replaceEntities(value, {
        ...entities,
        artifacts: entities.artifacts.map((artifact) => ({
          ...artifact,
          payload: { changed: true },
        })),
      }),
      replaceEntities(value, {
        ...entities,
        revisions: entities.revisions.map((revision) => ({ ...revision, artifactId: id(999) })),
      }),
      replaceEntities(value, {
        ...entities,
        canvasItems: entities.canvasItems.map((item) => ({ ...item, boardId: id(999) })),
      }),
      {
        ...value,
        graph: {
          ...value.graph,
          dataflowEdges: value.graph.dataflowEdges.map((edge) => ({ ...edge, toPort: "missing" })),
        },
      },
      {
        ...value,
        graph: {
          ...value.graph,
          itemPorts: value.graph.itemPorts.map((entry, index) =>
            index === 0
              ? { ...entry, ports: entry.ports.map((port) => ({ ...port, type: "text" as const })) }
              : entry,
          ),
        },
      },
      {
        ...value,
        executionRecords: value.executionRecords.map((record) => ({
          ...record,
          artifactId: id(999),
        })),
      },
      { ...value, snapshots: value.snapshots.map((record) => ({ ...record, boardId: id(999) })) },
      {
        ...value,
        provenance: value.provenance.map((record) => ({ ...record, projectId: id(999) })),
      },
    ];
    for (const input of cases)
      expect(repository.commit({ ...command(value), state: input })).toMatchObject({
        ok: false,
        error: { code: "invalid_data" },
      });
    expect(success(repository.eventsAfter(id(1), 0))).toEqual([]);
  });

  test("historical revisions remain immutable, current pointer/cache move together and entity versions advance once", () => {
    const { path, repository } = fixture();
    const value = state();
    success(repository.commit(command(value)));
    expect(
      repository.commit(
        command(
          replaceEntities(value, {
            ...value.graph.entities,
            projects: value.graph.entities.projects.map((project) => ({
              ...project,
              title: "missing version",
            })),
          }),
          1,
          91,
        ),
      ),
    ).toMatchObject({ ok: false });
    const newPayload = { unit: "pm", decimal: "113.00", originType: "ai", missing: null };
    const next = replaceEntities(value, {
      ...value.graph.entities,
      artifacts: value.graph.entities.artifacts.map((artifact) => ({
        ...artifact,
        payload: newPayload,
        revisionId: id(14),
        version: 2,
      })),
      revisions: [
        ...value.graph.entities.revisions,
        {
          ...value.graph.entities.revisions[0],
          id: id(14),
          artifactId: id(3),
          parentId: id(4),
          payload: newPayload,
          author: "R",
          createdAt: time,
          version: 1,
        },
      ],
    });
    success(repository.commit(command(next, 1, 91)));
    const mutatedHistory = replaceEntities(next, {
      ...next.graph.entities,
      revisions: next.graph.entities.revisions.map((revision) =>
        revision.id === id(4) ? { ...revision, author: "rewritten", version: 2 } : revision,
      ),
    });
    expect(repository.commit(command(mutatedHistory, 2, 92))).toMatchObject({
      ok: false,
      error: { code: "invalid_data" },
    });
    const droppedHistory = replaceEntities(next, {
      ...next.graph.entities,
      revisions: next.graph.entities.revisions
        .filter((revision) => revision.id !== id(4))
        .map(({ parentId: _parent, ...revision }) => revision),
    });
    expect(repository.commit(command(droppedHistory, 2, 92))).toMatchObject({ ok: false });
    repository.close();
    expect(success(reopen(path).readProject(id(1)))?.state).toEqual(next);
  });

  test("historical provenance, executions, blob metadata and snapshots cannot be rewritten or dropped", () => {
    const { repository } = fixture();
    const original = state();
    success(repository.commit(command(original)));
    const events = success(repository.eventsAfter(id(1), 0));
    const audit = success(repository.readAudit(id(1)));
    const attacks: readonly ProjectState[] = [
      {
        ...original,
        provenance: original.provenance.map((entry) => ({
          ...entry,
          value: {
            id: entry.value.id,
            originType: "manual",
            sourceIds: entry.value.sourceIds,
            createdBy: entry.value.createdBy,
            method: entry.value.method,
            timestamp: entry.value.timestamp,
          },
        })),
      },
      {
        ...original,
        provenance: original.provenance.map((entry) => ({
          ...entry,
          value: {
            ...entry.value,
            originType: "ai",
            generatedBy: "ai",
            modelId: "different-model",
          },
        })),
      },
      { ...original, provenance: [] },
      { ...original, executionRecords: [] },
      {
        ...original,
        executionRecords: original.executionRecords.map((entry) => ({
          ...entry,
          payload: { rewritten: true },
        })),
      },
      { ...original, blobs: [] },
      {
        ...original,
        blobs: original.blobs.map((entry) => ({ ...entry, source: { rewritten: true } })),
      },
      { ...original, snapshots: [] },
      {
        ...original,
        snapshots: original.snapshots.map((entry) => ({ ...entry, payload: { rewritten: true } })),
      },
    ];
    for (const next of attacks) {
      expect(repository.commit(command(changeTitle(next, "rejected"), 1, 91))).toMatchObject({
        ok: false,
        error: { code: "invalid_data" },
      });
      expect(success(repository.readProject(id(1)))).toEqual({ seq: 1, state: original });
      expect(success(repository.eventsAfter(id(1), 0))).toEqual(events);
      expect(success(repository.readAudit(id(1)))).toEqual(audit);
    }
  });

  test("new immutable history records can be appended with original records preserved", () => {
    const { path, repository } = fixture();
    const original = state();
    success(repository.commit(command(original)));
    const next = {
      ...original,
      provenance: [
        ...original.provenance,
        ...original.provenance.map((entry) => ({
          ...entry,
          value: { ...entry.value, id: id(112) },
        })),
      ],
      executionRecords: [
        ...original.executionRecords,
        ...original.executionRecords.map((entry) => ({ ...entry, id: id(111) })),
      ],
      blobs: [...original.blobs, ...original.blobs.map((entry) => ({ ...entry, id: id(110) }))],
      snapshots: [
        ...original.snapshots,
        ...original.snapshots.map((entry) => ({ ...entry, id: id(113) })),
      ],
    };
    success(repository.commit(command(next, 1, 91)));
    repository.close();
    expect(success(reopen(path).readProject(id(1)))).toEqual({ seq: 2, state: next });
  });

  test("placement and incident graph removal preserves artifact and revision data", () => {
    const { repository } = fixture();
    const value = state();
    success(repository.commit(command(value)));
    const removed = {
      ...value,
      graph: {
        ...value.graph,
        entities: {
          ...value.graph.entities,
          canvasItems: value.graph.entities.canvasItems.filter((item) => item.id !== id(5)),
        },
        itemPorts: value.graph.itemPorts.filter((entry) => entry.itemId !== id(5)),
        dataflowEdges: [],
        visualConnectors: [],
      },
    };
    success(repository.commit(command(removed, 1, 91)));
    expect(success(repository.readProject(id(1)))?.state.graph.entities.artifacts).toEqual(
      value.graph.entities.artifacts,
    );
    success(repository.commit(command(value, 2, 92)));
    expect(success(repository.readProject(id(1)))?.state).toEqual(value);
  });

  test("stored corrupted JSON, schema, relational index and audit identity return Results", () => {
    const { path, repository } = fixture();
    success(repository.commit(command(state())));
    const db = new DatabaseSync(path);
    try {
      const old = db.prepare("SELECT document FROM canvas_items WHERE id = ?").get(id(5));
      db.prepare("UPDATE canvas_items SET document = ? WHERE id = ?").run(
        JSON.stringify({ schemaVersion: 99, value: {} }),
        id(5),
      );
      expect(repository.readProject(id(1))).toMatchObject({
        ok: false,
        error: { code: "invalid_data" },
      });
      db.prepare("UPDATE canvas_items SET document = ? WHERE id = ?").run(
        String(old?.document),
        id(5),
      );
      db.prepare("UPDATE canvas_items SET document = ? WHERE id = ?").run(
        JSON.stringify({
          schemaVersion: 1,
          value: { ...state().graph.entities.canvasItems[0], boardId: id(999) },
        }),
        id(5),
      );
      expect(repository.readProject(id(1))).toMatchObject({ ok: false });
      db.prepare("UPDATE audit_log SET document = ? WHERE project_id = ?").run(
        JSON.stringify({
          schemaVersion: 1,
          value: {
            ...command(state()).event,
            projectId: id(1),
            seq: 1,
            actor: "forged",
            reason: "reason",
            auditPayload: {},
          },
        }),
        id(1),
      );
      expect(repository.readAudit(id(1))).toMatchObject({
        ok: false,
        error: { code: "invalid_data" },
      });
    } finally {
      db.close();
    }
  });

  test("foreign key enforcement survives every transaction", () => {
    const { path, repository } = fixture();
    success(repository.commit(command(state())));
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TRIGGER invalid_reference AFTER INSERT ON audit_log BEGIN INSERT INTO boards VALUES ('invalid-board', 'missing-project', '{}'); END",
    );
    db.close();
    expect(repository.commit(command(changeTitle(state(), "fail"), 1, 91))).toMatchObject({
      ok: false,
      error: { code: "storage_failure" },
    });
    expect(success(repository.readProject(id(1)))?.seq).toBe(1);
  });

  test("closed repository fails explicitly and close is idempotent", () => {
    const { repository } = fixture();
    repository.close();
    repository.close();
    expect(repository.readProject(id(1))).toMatchObject({
      ok: false,
      error: { code: "storage_failure" },
    });
    expect(repository.commit(command(state()))).toMatchObject({
      ok: false,
      error: { code: "storage_failure" },
    });
  });
});

describe("migrations", () => {
  test("migrates a populated v1 DB without changing original documents, then reopens idempotently", () => {
    const directory = mkdtempSync(join(tmpdir(), "discussion-v1-"));
    directories.push(directory);
    const path = join(directory, "old.sqlite");
    const db = new DatabaseSync(path);
    db.exec(MIGRATIONS[0].sql);
    db.exec("PRAGMA user_version = 1");
    const project = state().graph.entities.projects[0];
    db.prepare("INSERT INTO projects VALUES (?, ?)").run(
      id(1),
      JSON.stringify({ schemaVersion: 1, value: project }),
    );
    db.close();
    const repository = reopen(path);
    expect(success(repository.readProject(id(1)))?.state.graph.entities.projects).toEqual([
      project,
    ]);
    repository.close();
    expect(success(reopen(path).listProjects())).toEqual([project]);
  });
  test("migrates populated v2 data and logs to indexed v3 without changing payloads", () => {
    const { path, repository } = fixture();
    success(repository.commit(command(state())));
    repository.close();
    const old = new DatabaseSync(path);
    // Produce an authentic v2 layout: only application-owned v3 indexes are removed.
    const indexes = old
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL")
      .all();
    for (const row of indexes) {
      const index = typeof row.name === "string" ? row.name : "";
      if (!/^[a-z_]+$/.test(index)) throw new Error("Unexpected fixture index");
      old.exec(`DROP INDEX ${index}`);
    }
    old.exec("PRAGMA user_version = 2");
    old.close();
    const upgraded = reopen(path);
    expect(success(upgraded.readProject(id(1)))).toEqual({ seq: 1, state: state() });
    expect(success(upgraded.readAudit(id(1)))).toHaveLength(1);
    const check = new DatabaseSync(path);
    try {
      expect(check.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 3 });
      const plan = check
        .prepare("EXPLAIN QUERY PLAN SELECT id FROM canvas_items WHERE project_id = ? ORDER BY id")
        .all(id(1));
      expect(
        plan.some((row) => typeof row.detail === "string" && row.detail.includes("canvas_project")),
      ).toBe(true);
      const referencePlan = check
        .prepare(
          "EXPLAIN QUERY PLAN SELECT id FROM snapshots WHERE board_id = ? AND project_id = ?",
        )
        .all(id(2), id(1));
      expect(
        referencePlan.some(
          (row) => typeof row.detail === "string" && row.detail.includes("snapshots_board"),
        ),
      ).toBe(true);
      expect(check.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      check.close();
    }
  });

  test("an opener waiting on the write lock rechecks the version after another connection migrates", async () => {
    const directory = mkdtempSync(join(tmpdir(), "discussion-migration-lock-"));
    directories.push(directory);
    const path = join(directory, "locked.sqlite");
    const database = new DatabaseSync(path, { timeout: 1000 });
    database.exec(MIGRATIONS[0].sql);
    database.exec("PRAGMA user_version = 1");
    database.exec("BEGIN IMMEDIATE");
    const worker = new Worker(new URL("./migration-worker.fixture.ts", import.meta.url), {
      workerData: { path },
    });
    let committed = false;
    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        worker.on("message", (input: unknown) => {
          if (typeof input !== "object" || input === null || !("type" in input)) return;
          if (input.type === "waiting-for-lock") {
            try {
              for (const migration of MIGRATIONS) {
                if (migration.version > 1) database.exec(migration.sql);
              }
              database.exec(`PRAGMA user_version = ${DATABASE_VERSION}`);
              database.exec("COMMIT");
              committed = true;
            } catch (error) {
              reject(error);
            }
          } else if (input.type === "result" && "result" in input) resolve(input.result);
        });
        worker.once("error", reject);
        worker.once("exit", (code) => {
          if (code !== 0) reject(new Error(`Migration worker exited ${code}`));
        });
      });
      expect(result).toEqual({ ok: true, value: undefined });
      expect(database.prepare("PRAGMA user_version").get()).toMatchObject({
        user_version: DATABASE_VERSION,
      });
    } finally {
      if (!committed) database.exec("ROLLBACK");
      database.close();
      await worker.terminate();
    }
  });

  test("future DB versions are refused without schema/version changes", () => {
    const directory = mkdtempSync(join(tmpdir(), "discussion-future-"));
    directories.push(directory);
    const path = join(directory, "future.sqlite");
    const db = new DatabaseSync(path);
    db.exec(
      "PRAGMA user_version = 999; CREATE TABLE future_data (value TEXT); INSERT INTO future_data VALUES ('keep')",
    );
    expect(migrateDatabase(db)).toEqual({
      ok: false,
      error: { code: "unsupported_database_version", version: 999 },
    });
    // The unsupported-version return must leave this same connection out of a transaction.
    db.exec("BEGIN IMMEDIATE");
    db.exec("ROLLBACK");
    db.close();
    expect(openSqliteRepository(path)).toEqual({
      ok: false,
      error: { code: "unsupported_database_version", version: 999 },
    });
    const read = new DatabaseSync(path);
    expect(read.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 999 });
    expect(read.prepare("SELECT value FROM future_data").get()).toMatchObject({ value: "keep" });
    read.close();
  });
  test("failed later migration rolls back all pending migrations and user_version", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE TABLE blobs (sentinel TEXT); INSERT INTO blobs VALUES ('preserve')");
      expect(migrateDatabase(db)).toMatchObject({ ok: false, error: { code: "storage_failure" } });
      expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 0 });
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name='projects'").get(),
      ).toBeUndefined();
      expect(db.prepare("SELECT sentinel FROM blobs").get()).toMatchObject({
        sentinel: "preserve",
      });
    } finally {
      db.close();
    }
  });
});
