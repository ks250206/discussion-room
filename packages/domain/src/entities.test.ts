import * as v from "valibot";
import { assert, describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  ArtifactRevisionSchema,
  ArtifactSchema,
  BoardSchema,
  CanvasItemSchema,
  EntitySnapshotSchema,
  ProjectSchema,
  removeCanvasItem,
  validate,
  validateEntitySnapshot,
  ViewportSchema,
  type Artifact,
  type ArtifactRevision,
  type Board,
  type CanvasItem,
  type EntitySnapshot,
  type Id,
  type Project,
  type Timestamp,
} from "./index.ts";

function id(number: number): string {
  return `01ARZ3NDEKTSV4RRFFQ69G5F${String(number).padStart(2, "0")}`;
}

const createdAt = "2026-10-26T12:34:56.0012300+09:00";

function makeSnapshot(): v.InferInput<typeof EntitySnapshotSchema> {
  return {
    projects: [
      { id: id(1), title: "LGPS", description: "", createdAt, version: 1 },
      { id: id(2), title: "Other project", description: "", createdAt, version: 2 },
    ],
    boards: [
      {
        id: id(3),
        projectId: id(1),
        name: "First",
        viewport: { x: -5, y: 0, zoom: 1 },
        version: 1,
      },
      {
        id: id(4),
        projectId: id(1),
        name: "Second",
        viewport: { x: 0, y: 0, zoom: 0.5 },
        version: 1,
      },
    ],
    artifacts: [
      {
        id: id(5),
        projectId: id(1),
        kind: "hypothesis",
        payload: {},
        revisionId: id(7),
        version: 2,
      },
    ],
    revisions: [
      { id: id(6), artifactId: id(5), payload: {}, author: "Researcher", createdAt, version: 1 },
      {
        id: id(7),
        artifactId: id(5),
        parentId: id(6),
        payload: {},
        author: "Researcher",
        createdAt,
        version: 1,
      },
    ],
    canvasItems: [
      {
        id: id(8),
        boardId: id(3),
        artifactId: id(5),
        x: -5,
        y: 10,
        width: 300,
        height: 200,
        viewState: { collapsed: false },
        version: 1,
      },
      {
        id: id(9),
        boardId: id(4),
        artifactId: id(5),
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        viewState: {},
        version: 1,
      },
      {
        id: id(10),
        boardId: id(3),
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        viewState: { text: "Decoration without an Artifact" },
        version: 1,
      },
    ],
  };
}

function first<T>(items: readonly T[]): T {
  const item = items[0];
  assert(item !== undefined);
  return item;
}

const entities = [
  { name: "Project", schema: ProjectSchema, value: () => first(makeSnapshot().projects) },
  { name: "Board", schema: BoardSchema, value: () => first(makeSnapshot().boards) },
  { name: "Artifact", schema: ArtifactSchema, value: () => first(makeSnapshot().artifacts) },
  {
    name: "ArtifactRevision",
    schema: ArtifactRevisionSchema,
    value: () => first(makeSnapshot().revisions),
  },
  {
    name: "CanvasItem",
    schema: CanvasItemSchema,
    value: () => first(makeSnapshot().canvasItems.filter((item) => item.artifactId === undefined)),
  },
];

describe("entity shape boundaries", () => {
  test.each(entities)(
    "validates $name and rejects every required missing or undefined field",
    ({ schema, value }) => {
      expect(validate(schema, value()).ok).toBe(true);
      for (const field of Object.keys(value())) {
        const missing: Record<string, unknown> = { ...value() };
        delete missing[field];
        expect(validate(schema, missing).ok, `missing ${field}`).toBe(false);
        expect(validate(schema, { ...value(), [field]: undefined }).ok, `undefined ${field}`).toBe(
          false,
        );
        expect(validate(schema, { ...value(), [field]: null }).ok, `null ${field}`).toBe(false);
      }
    },
  );

  test.each(entities)(
    "rejects unknown $name envelope fields without silently stripping metadata",
    ({ schema, value }) => {
      expect(validate(schema, { ...value(), provenance: { originType: "ai" } }).ok).toBe(false);
    },
  );

  test.each(entities)("rejects invalid $name optimistic versions", ({ schema, value }) => {
    for (const version of [0, -1, 1.5, "1", Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(validate(schema, { ...value(), version }).ok).toBe(false);
    }
    expect(validate(schema, { ...value(), version: Number.MAX_SAFE_INTEGER }).ok).toBe(true);
  });

  test.each(entities)("rejects non-object $name input and malformed IDs", ({ schema, value }) => {
    for (const input of [undefined, null, [], "entity", 42]) {
      expect(validate(schema, input).ok).toBe(false);
    }
    expect(validate(schema, { ...value(), id: "invalid" }).ok).toBe(false);
    expect(validate(schema, { ...value(), id: id(1).toLowerCase() }).ok).toBe(false);
  });

  test("exports branded ID and Timestamp fields and independent entity types", () => {
    const artifact = validate(ArtifactSchema, first(makeSnapshot().artifacts));
    const project = validate(ProjectSchema, first(makeSnapshot().projects));
    assert(artifact.ok && project.ok);
    expectTypeOf(artifact.value).toEqualTypeOf<Artifact>();
    expectTypeOf(artifact.value.id).toEqualTypeOf<Id>();
    expectTypeOf(project.value.createdAt).toEqualTypeOf<Timestamp>();
    expectTypeOf<CanvasItem>().not.toExtend<Artifact>();
    expect(project.value.createdAt).toBe(createdAt);
    expect(
      validate(ProjectSchema, { ...project.value, createdAt: "2026-02-30T00:00:00Z" }).ok,
    ).toBe(false);
  });

  test("exports readonly entity, collection and opaque object outputs", () => {
    expectTypeOf<Project>().toEqualTypeOf<Readonly<Project>>();
    expectTypeOf<Board>().toEqualTypeOf<Readonly<Board>>();
    expectTypeOf<Artifact>().toEqualTypeOf<Readonly<Artifact>>();
    expectTypeOf<ArtifactRevision>().toEqualTypeOf<Readonly<ArtifactRevision>>();
    expectTypeOf<CanvasItem>().toEqualTypeOf<Readonly<CanvasItem>>();
    expectTypeOf<EntitySnapshot>().toEqualTypeOf<Readonly<EntitySnapshot>>();
    expectTypeOf<Board["viewport"]>().toEqualTypeOf<Readonly<Board["viewport"]>>();
    expectTypeOf<EntitySnapshot["artifacts"]>().toEqualTypeOf<readonly Artifact[]>();
    expectTypeOf<Artifact["payload"]>().toEqualTypeOf<Readonly<Record<string, unknown>>>();
    expectTypeOf<CanvasItem["viewState"]>().toEqualTypeOf<Readonly<Record<string, unknown>>>();

    const input = first(makeSnapshot().artifacts);
    const parsed = validate(ArtifactSchema, input);
    assert(parsed.ok);
    expect(parsed.value.payload).toBe(input.payload);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.payload)).toBe(false);
  });

  test.each([
    { schema: ProjectSchema, value: () => first(makeSnapshot().projects), field: "title" },
    { schema: BoardSchema, value: () => first(makeSnapshot().boards), field: "name" },
    { schema: ArtifactSchema, value: () => first(makeSnapshot().artifacts), field: "kind" },
    {
      schema: ArtifactRevisionSchema,
      value: () => first(makeSnapshot().revisions),
      field: "author",
    },
  ])("rejects blank $field without trimming valid stored text", ({ schema, value, field }) => {
    for (const blank of ["", " ", "\t\r\n", "\u3000\u00a0"]) {
      expect(validate(schema, { ...value(), [field]: blank }).ok).toBe(false);
    }
    const text = " 研究者 Researcher \t";
    const parsed = validate(schema, { ...value(), [field]: text });
    assert(parsed.ok);
    expect(parsed.value).toHaveProperty(field, text);
  });

  test("requires opaque object payloads and viewState while preserving all nested content", () => {
    const payload = Object.freeze({
      quantity: { value: null, unit: "mS/cm", significantFigures: 4 },
      provenance: { originType: "ai", sourceIds: [id(12)], approved: false },
      futureField: [null, { uncertainty: 0.003 }],
    });
    for (const { schema, value } of [
      { schema: ArtifactSchema, value: () => first(makeSnapshot().artifacts) },
      { schema: ArtifactRevisionSchema, value: () => first(makeSnapshot().revisions) },
    ]) {
      const result = validate(schema, { ...value(), payload });
      assert(result.ok);
      expect(result.value).toHaveProperty("payload", payload);
      for (const badPayload of [undefined, null, 0, "text", [], new Date()]) {
        expect(validate(schema, { ...value(), payload: badPayload }).ok).toBe(false);
      }
    }
    const result = validate(CanvasItemSchema, {
      ...first(makeSnapshot().canvasItems),
      viewState: payload,
    });
    assert(result.ok);
    expect(result.value.viewState).toBe(payload);
    expect(payload.quantity.value).toBeNull();
  });

  test("allows absent optional references but rejects explicit undefined or malformed references", () => {
    const { artifactId: _artifactId, ...decoration } = first(makeSnapshot().canvasItems);
    expect(validate(CanvasItemSchema, decoration).ok).toBe(true);
    const root = first(makeSnapshot().revisions);
    expect(validate(ArtifactRevisionSchema, root).ok).toBe(true);
    for (const invalid of [undefined, null, "invalid", 42]) {
      expect(validate(CanvasItemSchema, { ...decoration, artifactId: invalid }).ok).toBe(false);
      expect(validate(ArtifactRevisionSchema, { ...root, parentId: invalid }).ok).toBe(false);
    }
  });

  test("requires finite positions and positive finite sizes and zoom", () => {
    const item = first(makeSnapshot().canvasItems);
    for (const field of ["x", "y", "width", "height"]) {
      for (const invalid of [Number.NaN, Infinity, -Infinity, "1"]) {
        expect(validate(CanvasItemSchema, { ...item, [field]: invalid }).ok).toBe(false);
      }
    }
    for (const field of ["width", "height"]) {
      for (const invalid of [0, -1])
        expect(validate(CanvasItemSchema, { ...item, [field]: invalid }).ok).toBe(false);
    }
    for (const field of ["x", "y", "zoom"]) {
      for (const invalid of [Number.NaN, Infinity, -Infinity]) {
        expect(validate(ViewportSchema, { x: 0, y: 0, zoom: 1, [field]: invalid }).ok).toBe(false);
      }
    }
    for (const zoom of [0, -1, "1"])
      expect(validate(ViewportSchema, { x: 0, y: 0, zoom }).ok).toBe(false);
    expect(validate(ViewportSchema, { x: -1, y: 0, zoom: 0.01 }).ok).toBe(true);
  });
});

function issueCodes(input: unknown): string[] {
  const result = validateEntitySnapshot(input);
  assert(!result.ok && result.error.code === "reference_integrity_failed");
  return result.error.issues.map((issue) => issue.code);
}

describe("snapshot reference integrity", () => {
  test("checks structural relationships without certifying opaque current-payload agreement", () => {
    const snapshot = makeSnapshot();
    snapshot.artifacts = snapshot.artifacts.map((artifact) => ({
      ...artifact,
      payload: { currentMaterialization: "must be maintained by the apply layer" },
    }));
    // The authored current revision is the source of truth; #33 must maintain this cache.
    expect(validateEntitySnapshot(snapshot).ok).toBe(true);
  });

  test("accepts shared Artifacts across Boards, optional placements, and branched revision history", () => {
    const snapshot = makeSnapshot();
    snapshot.revisions.push({ ...first(snapshot.revisions), id: id(11), parentId: id(6) });
    expect(validateEntitySnapshot(snapshot)).toEqual({ ok: true, value: snapshot });
  });

  test("rejects missing snapshot collections at the shape boundary", () => {
    const result = validateEntitySnapshot({ projects: [] });
    assert(!result.ok);
    expect(result.error.code).toBe("validation_failed");
    expect(
      validateEntitySnapshot({
        projects: [],
        boards: [],
        artifacts: [],
        revisions: [],
        canvasItems: [],
      }).ok,
    ).toBe(true);
  });

  test.each(["projects", "boards", "artifacts", "revisions", "canvasItems"] as const)(
    "rejects duplicate IDs in %s before resolving ambiguous references",
    (collection) => {
      const snapshot = makeSnapshot();
      const duplicate = snapshot[collection][0];
      assert(duplicate !== undefined);
      expect(
        issueCodes({ ...snapshot, [collection]: [...snapshot[collection], duplicate] }),
      ).toEqual(["duplicate_id"]);
    },
  );

  test("rejects all missing references and retains the collection, field and target diagnostics", () => {
    const snapshot = makeSnapshot();
    const invalid = {
      ...snapshot,
      boards: snapshot.boards.map((board) => ({ ...board, projectId: id(20) })),
      artifacts: snapshot.artifacts.map((artifact) => ({
        ...artifact,
        projectId: id(20),
        revisionId: id(21),
      })),
      revisions: snapshot.revisions.map((revision) => ({
        ...revision,
        artifactId: id(22),
        parentId: id(23),
      })),
      canvasItems: snapshot.canvasItems.map((item) => ({
        ...item,
        boardId: id(24),
        artifactId: id(25),
      })),
    };
    const result = validateEntitySnapshot(invalid);
    assert(!result.ok && result.error.code === "reference_integrity_failed");
    expect(result.error.issues.every((issue) => issue.code === "missing_reference")).toBe(true);
    expect(result.error.issues.map((issue) => `${issue.collection}.${issue.field}`)).toEqual([
      "boards.projectId",
      "boards.projectId",
      "artifacts.projectId",
      "artifacts.revisionId",
      "revisions.artifactId",
      "revisions.parentId",
      "revisions.artifactId",
      "revisions.parentId",
      "canvasItems.boardId",
      "canvasItems.artifactId",
      "canvasItems.boardId",
      "canvasItems.artifactId",
      "canvasItems.boardId",
      "canvasItems.artifactId",
    ]);
    expect(result.error.issues).toContainEqual({
      code: "missing_reference",
      collection: "artifacts",
      id: id(5),
      field: "revisionId",
      referenceId: id(21),
    });
  });

  test("rejects placements across Project boundaries", () => {
    const snapshot = makeSnapshot();
    snapshot.boards = snapshot.boards.map((board) => ({ ...board, projectId: id(2) }));
    expect(issueCodes(snapshot)).toEqual(["project_mismatch", "project_mismatch"]);
  });

  test("requires both current revision and parents to belong to their Artifact", () => {
    const snapshot = makeSnapshot();
    snapshot.artifacts.push({ ...first(snapshot.artifacts), id: id(12), revisionId: id(13) });
    snapshot.revisions.push({
      ...first(snapshot.revisions),
      id: id(13),
      artifactId: id(12),
      parentId: id(6),
    });
    snapshot.artifacts = snapshot.artifacts.map((artifact) => ({
      ...artifact,
      revisionId: id(13),
    }));
    expect(issueCodes(snapshot)).toEqual(["revision_owner_mismatch", "revision_owner_mismatch"]);
  });

  test("rejects self-parenting and detached multi-revision cycles without assuming ID or time order", () => {
    const snapshot = makeSnapshot();
    snapshot.revisions.push(
      { ...first(snapshot.revisions), id: id(14), parentId: id(14) },
      { ...first(snapshot.revisions), id: id(15), parentId: id(16) },
      { ...first(snapshot.revisions), id: id(16), parentId: id(15) },
    );
    expect(issueCodes(snapshot)).toEqual(["revision_cycle", "revision_cycle"]);
  });

  test("validates long parent chains iteratively", () => {
    const snapshot = makeSnapshot();
    let previous = id(6);
    for (let index = 1; index <= 3000; index++) {
      const revisionId = `${id(1).slice(0, -9)}${String(index).padStart(9, "0")}`;
      snapshot.revisions.push({ ...first(snapshot.revisions), id: revisionId, parentId: previous });
      previous = revisionId;
    }
    expect(validateEntitySnapshot(snapshot).ok).toBe(true);
  });
});

describe("placement removal", () => {
  test("removes one placement without mutating input or deleting a shared or last-reference Artifact", () => {
    const validated = validateEntitySnapshot(makeSnapshot());
    assert(validated.ok);
    const snapshot = validated.value;
    const original = makeSnapshot();
    const removed = removeCanvasItem(snapshot, first(snapshot.canvasItems).id);
    assert(removed.ok);
    expect(snapshot).toEqual(original);
    expect(removed.value.canvasItems).toHaveLength(2);
    expect(removed.value.artifacts).toBe(snapshot.artifacts);
    expect(removed.value.revisions).toBe(snapshot.revisions);
    const lastReference = first(removed.value.canvasItems);
    const removedLast = removeCanvasItem(removed.value, lastReference.id);
    assert(removedLast.ok);
    expect(removedLast.value.artifacts).toEqual(snapshot.artifacts);
    expect(removedLast.value.revisions).toEqual(snapshot.revisions);
    expect(validateEntitySnapshot(removedLast.value).ok).toBe(true);
  });

  test("returns Result for a missing placement", () => {
    const validated = validateEntitySnapshot(makeSnapshot());
    assert(validated.ok);
    const missingId = first(validated.value.projects).id;
    expect(removeCanvasItem(validated.value, missingId)).toEqual({
      ok: false,
      error: { code: "canvas_item_not_found", id: missingId },
    });
  });
});
