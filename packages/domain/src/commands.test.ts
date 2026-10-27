import * as v from "valibot";
import { assert, describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  CommandSchema,
  DecisionContextSchema,
  EventSchema,
  IdSchema,
  TimestampSchema,
  checkBaseVersion,
  decide,
  evolve,
  validate,
  validateDomainState,
  validateKnownM1State,
  type Command,
  type DecisionContext,
  type DomainState,
  type Event,
  type Id,
} from "./index.ts";

function id(value: number): Id {
  return v.parse(IdSchema, `01ARZ3NDEKTSV4${String(value).padStart(12, "0")}`);
}
const timestamp = v.parse(TimestampSchema, "2026-10-27T10:00:00+09:00");
const later = v.parse(TimestampSchema, "2026-10-27T11:00:00+09:00");
function context(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    commandId: id(90),
    actor: "editor",
    timestamp: later,
    origin: "human",
    entityId: id(20),
    revisionId: id(21),
    ...overrides,
  };
}
function note(markdown = "recorded"): {
  title: string;
  markdown: string;
  author: string;
  generatedBy: "human";
} {
  return { title: "note", markdown, author: "original author", generatedBy: "human" };
}
function emptyState(): DomainState {
  return {
    entities: { projects: [], boards: [], artifacts: [], revisions: [], canvasItems: [] },
    itemPorts: [],
    semanticRelations: [],
    dataflowEdges: [],
    visualConnectors: [],
  };
}
function fixture(): DomainState {
  return {
    entities: {
      projects: [
        { id: id(1), title: "project", description: "", createdAt: timestamp, version: 1 },
      ],
      boards: [
        {
          id: id(2),
          projectId: id(1),
          name: "board",
          viewport: { x: 0, y: 0, zoom: 1 },
          version: 1,
        },
      ],
      artifacts: [3, 5].map((n) => ({
        id: id(n),
        projectId: id(1),
        kind: "note",
        payload: note(),
        revisionId: id(n + 1),
        version: 1,
      })),
      revisions: [3, 5].map((n) => ({
        id: id(n + 1),
        artifactId: id(n),
        payload: note(),
        author: "original editor",
        createdAt: timestamp,
        version: 1,
      })),
      canvasItems: [7, 8, 9].map((n) => ({
        id: id(n),
        boardId: id(2),
        ...(n === 9 ? {} : { artifactId: id(n === 7 ? 3 : 5) }),
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        viewState: { nested: { preserve: true } },
        version: 1,
      })),
    },
    itemPorts: [7, 8, 9].map((n) => ({
      itemId: id(n),
      ports: [
        { name: "in", direction: "input", type: "number" },
        { name: "out", direction: "output", type: "number" },
      ],
    })),
    semanticRelations: [
      {
        id: id(10),
        type: "semantic-relation",
        createdBy: "original editor",
        createdAt: timestamp,
        version: 1,
        fromArtifactId: id(3),
        toArtifactId: id(5),
        relation: "supports",
        rationale: "evidence",
        metadata: { origin: { preserved: true } },
      },
    ],
    dataflowEdges: [
      {
        id: id(11),
        type: "dataflow-edge",
        createdBy: "original editor",
        createdAt: timestamp,
        version: 1,
        fromItemId: id(7),
        fromPort: "out",
        toItemId: id(8),
        toPort: "in",
        description: "",
      },
    ],
    visualConnectors: [
      {
        id: id(12),
        type: "visual-connector",
        createdBy: "original editor",
        createdAt: timestamp,
        version: 1,
        boardId: id(2),
        source: id(7),
        target: id(9),
        style: { dash: [1, 2] },
        description: "",
      },
    ],
  };
}
function apply(state: DomainState, command: unknown, ctx = context()) {
  const result = decide(state, command, ctx);
  assert(result.ok, JSON.stringify(result));
  for (const event of result.value) expect(validate(EventSchema, event).ok).toBe(true);
  const next = result.value.reduce(evolve, state);
  expect(validateDomainState(next).ok).toBe(true);
  return { state: next, events: result.value };
}
function expectRejected(state: unknown, command: unknown, code: string, ctx: unknown = context()) {
  const result = decide(state, command, ctx);
  assert(!result.ok);
  expect(result.error.code).toBe(code);
}
function freezeDeep(input: unknown): void {
  if (typeof input !== "object" || input === null || Object.isFrozen(input)) return;
  Object.freeze(input);
  for (const value of Object.values(input)) freezeDeep(value);
}

const crudCases = [
  {
    target: "project",
    create: { type: "project.create", value: { title: "new", description: "description" } },
    update: { title: "edited", description: "updated" },
    event: "project.changed",
  },
  {
    target: "board",
    create: {
      type: "board.create",
      value: { projectId: id(1), name: "new", viewport: { x: 1, y: 2, zoom: 2 } },
    },
    update: { name: "edited", viewport: { x: 3, y: 4, zoom: 0.5 } },
    event: "board.changed",
  },
  {
    target: "artifact",
    create: {
      type: "artifact.create",
      projectId: id(1),
      content: { kind: "note", payload: note() },
    },
    update: undefined,
    event: "artifact.changed",
  },
  {
    target: "canvasItem",
    create: {
      type: "canvasItem.create",
      value: { boardId: id(2), x: 1, y: 2, width: 300, height: 100, viewState: { nested: [1, 2] } },
      ports: [],
    },
    update: { x: 3, y: 4, width: 400, height: 200, viewState: { nested: [3, 4] } },
    event: "canvasItem.changed",
  },
  {
    target: "semanticRelation",
    create: {
      type: "semanticRelation.create",
      value: {
        fromArtifactId: id(3),
        toArtifactId: id(5),
        relation: "competes_with",
        rationale: "alternative",
        metadata: { model: { name: "keep" } },
      },
    },
    update: {
      fromArtifactId: id(3),
      toArtifactId: id(3),
      relation: "can_coexist_with",
      rationale: "updated",
    },
    event: "semanticRelation.changed",
  },
  {
    target: "dataflowEdge",
    create: {
      type: "dataflowEdge.create",
      value: {
        fromItemId: id(7),
        fromPort: "out",
        toItemId: id(9),
        toPort: "in",
        description: "new",
        metadata: { adapter: "number" },
      },
    },
    update: {
      fromItemId: id(7),
      fromPort: "out",
      toItemId: id(9),
      toPort: "in",
      description: "updated",
    },
    event: "dataflowEdge.changed",
  },
  {
    target: "visualConnector",
    create: {
      type: "visualConnector.create",
      value: {
        boardId: id(2),
        source: id(8),
        target: id(8),
        style: { color: "blue" },
        description: "new",
      },
    },
    update: {
      source: id(8),
      target: id(9),
      style: { color: "red" },
      description: "updated",
    },
    event: "visualConnector.changed",
  },
] as const;

describe("authoritative commands and events", () => {
  test.each(crudCases)("$target create/update/delete and exact ordered replay", (entry) => {
    const start = fixture();
    const created = apply(start, entry.create);
    expect(created.events).toHaveLength(1);
    const first = created.events[0];
    assert(first);
    expect(first.type).toBe(entry.event);
    expect(first.before).toBeNull();
    expect(first.after).toMatchObject({ id: id(20), version: 1 });
    const update =
      entry.target === "artifact"
        ? {
            type: "artifact.update",
            id: id(20),
            baseVersion: 1,
            content: { kind: "note", payload: note("changed") },
          }
        : {
            type: `${entry.target}.update`,
            id: id(20),
            baseVersion: 1,
            value: entry.update,
            ...(entry.target === "canvasItem" ? { ports: [] } : {}),
          };
    const edited = apply(created.state, update, context({ revisionId: id(22) }));
    const second = edited.events[0];
    assert(second);
    expect(second.before).toEqual(first.after);
    expect(second.after).toMatchObject({ id: id(20), version: 2 });
    const deleted = apply(edited.state, {
      type: `${entry.target}.delete`,
      id: id(20),
      baseVersion: 2,
    });
    expect(deleted.events[0]?.before).toEqual(second.after);
    expect(deleted.events[0]?.after).toBeNull();
    expect(deleted.state).toEqual(start);
    const all = [...created.events, ...edited.events, ...deleted.events];
    expect(all.reduce(evolve, start)).toEqual(deleted.state);
    expect(all).toEqual(JSON.parse(JSON.stringify(all)));
  });

  test("creates the first Project from an empty state using authoritative IDs and time", () => {
    const { state, events } = apply(emptyState(), {
      type: "project.create",
      value: { title: "P", description: "" },
    });
    expect(state.entities.projects).toEqual([
      { id: id(20), title: "P", description: "", createdAt: later, version: 1 },
    ]);
    expect(events[0]).toMatchObject({
      actor: "editor",
      timestamp: later,
      commandId: id(90),
      origin: "human",
    });
  });

  test("full previous revision and authored content survive a content edit", () => {
    const start = fixture();
    const { state, events } = apply(start, {
      type: "artifact.update",
      id: id(3),
      baseVersion: 1,
      content: { kind: "note", payload: note("next") },
    });
    const event = events[0];
    assert(event?.type === "artifact.changed");
    expect(event.revisionsBefore).toEqual([start.entities.revisions[0]]);
    expect(event.revisionsAfter).toHaveLength(2);
    expect(event.after).toMatchObject({ revisionId: id(21), payload: note("next"), version: 2 });
    expect(event.revisionsAfter[1]).toEqual({
      id: id(21),
      artifactId: id(3),
      parentId: id(4),
      payload: note("next"),
      author: "editor",
      createdAt: later,
      version: 1,
    });
    expect(state.entities.revisions[0]).toEqual(start.entities.revisions[0]);
    expect(state.entities.revisions).toHaveLength(3);
    expect(state.entities.artifacts[0]?.payload).toEqual(state.entities.revisions[2]?.payload);
    expect(state.entities.revisions[2]?.payload.author).toBe("original author");
  });

  test("CanvasItem deletion records incident edge/port values and retains Artifact and history", () => {
    const start = fixture();
    const { state, events } = apply(start, {
      type: "canvasItem.delete",
      id: id(7),
      baseVersion: 1,
    });
    expect(events.map((event) => event.type)).toEqual([
      "dataflowEdge.changed",
      "visualConnector.changed",
      "canvasItem.changed",
    ]);
    expect(events[0]?.before).toEqual(start.dataflowEdges[0]);
    expect(events[1]?.before).toEqual(start.visualConnectors[0]);
    const last = events[2];
    assert(last?.type === "canvasItem.changed");
    expect(last.portsBefore).toEqual(start.itemPorts[0]);
    expect(last.portsAfter).toBeNull();
    expect(state.entities.artifacts).toEqual(start.entities.artifacts);
    expect(state.entities.revisions).toEqual(start.entities.revisions);
    expect(state.semanticRelations).toEqual(start.semanticRelations);
    expect(state.itemPorts.map((ports) => ports.itemId)).toEqual([id(8), id(9)]);
    expect(state.dataflowEdges).toEqual([]);
    expect(state.visualConnectors).toEqual([]);
  });

  test("no inputs are mutated and repeated decisions/replay are deterministic", () => {
    const state = fixture();
    const command = {
      type: "canvasItem.update",
      id: id(7),
      baseVersion: 1,
      value: { x: -2, y: 3, width: 1, height: 2, viewState: { nested: ["keep"] } },
      ports: state.itemPorts[0]?.ports,
    };
    const ctx = context();
    const original = JSON.stringify({ state, command, ctx });
    freezeDeep(state);
    freezeDeep(command);
    freezeDeep(ctx);
    const first = apply(state, command, ctx);
    expect(decide(state, command, ctx)).toEqual(decide(state, command, ctx));
    expect(first.state).not.toBe(state);
    expect(JSON.stringify({ state, command, ctx })).toBe(original);
  });

  test("line updates retain unknown nested metadata and creator attribution", () => {
    const state = fixture();
    const { state: next } = apply(state, {
      type: "semanticRelation.update",
      id: id(10),
      baseVersion: 1,
      value: {
        fromArtifactId: id(5),
        toArtifactId: id(3),
        relation: "contradicts",
        rationale: "updated",
      },
    });
    expect(next.semanticRelations[0]).toMatchObject({
      createdBy: "original editor",
      createdAt: timestamp,
      metadata: { origin: { preserved: true } },
      version: 2,
    });
  });

  test.each(crudCases)("$target refuses stale or missing update targets", (entry) => {
    const created = apply(fixture(), entry.create).state;
    expectRejected(
      created,
      { type: `${entry.target}.delete`, id: id(20), baseVersion: 2 },
      "version_conflict",
    );
    expectRejected(
      created,
      { type: `${entry.target}.delete`, id: id(99), baseVersion: 1 },
      "not_found",
    );
    expect.hasAssertions();
    const duplicateCode =
      entry.target === "artifact"
        ? "id_conflict"
        : ["semanticRelation", "dataflowEdge", "visualConnector"].includes(entry.target)
          ? "graph_integrity_failed"
          : "reference_integrity_failed";
    expectRejected(created, entry.create, duplicateCode);
  });

  test("baseVersion exposes the current version for later concurrency policy", () => {
    const result = checkBaseVersion({ id: id(7), version: 4 }, 3);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "version_conflict",
        message: "baseVersion does not match the current entity",
        id: id(7),
        currentVersion: 4,
        baseVersion: 3,
      },
    });
  });

  test.each([
    { type: "project.create", value: { title: "P", description: "", createdAt: timestamp } },
    {
      type: "artifact.create",
      projectId: id(1),
      content: { kind: "note", payload: note() },
      approved: true,
    },
    {
      type: "artifact.update",
      id: id(3),
      baseVersion: 1,
      content: { kind: "Note", payload: note() },
    },
    {
      type: "artifact.update",
      id: id(3),
      baseVersion: 1,
      content: { kind: "note", payload: { ...note(), modelId: "discard?" } },
    },
    { type: "canvasItem.delete", id: id(7), baseVersion: 0 },
    { type: "canvasItem.delete", id: id(7), baseVersion: 1, ports: undefined },
    { type: "future.command" },
  ])("strict command gate rejects unsupported fields and kinds %#", (command) => {
    expect.hasAssertions();
    expectRejected(fixture(), command, "validation_failed");
  });

  test("context IDs and valid timestamps are mandatory, with no default generator", () => {
    expect.hasAssertions();
    expectRejected(fixture(), crudCases[0].create, "invalid_context", {
      commandId: id(90),
      actor: "editor",
      timestamp: later,
      origin: "human",
    });
    expectRejected(fixture(), crudCases[0].create, "validation_failed", {
      ...context(),
      timestamp: "today",
    });
    expectRejected(fixture(), crudCases[0].create, "validation_failed", {
      ...context(),
      actor: " ",
    });
    expectRejected(fixture(), crudCases[0].create, "validation_failed", {
      ...context(),
      entityId: undefined,
    });
  });

  test("unsafe version overflow is rejected before returning events", () => {
    expect.hasAssertions();
    const state = fixture();
    const max = Number.MAX_SAFE_INTEGER;
    const input = {
      ...state,
      entities: {
        ...state.entities,
        projects: state.entities.projects.map((project) => ({ ...project, version: max })),
      },
    };
    expectRejected(
      input,
      {
        type: "project.update",
        id: id(1),
        baseVersion: max,
        value: { title: "changed", description: "" },
      },
      "validation_failed",
    );
  });

  test("readonly public unions retain existing entity types", () => {
    expectTypeOf<Command["type"]>().toEqualTypeOf<v.InferOutput<typeof CommandSchema>["type"]>();
    expectTypeOf<Event["actor"]>().toEqualTypeOf<string>();
    expectTypeOf<DecisionContext>().toEqualTypeOf<v.InferOutput<typeof DecisionContextSchema>>();
    expectTypeOf<DomainState["entities"]["artifacts"]>().toEqualTypeOf<
      readonly import("./entities.ts").Artifact[]
    >();
  });
});

function stateWithContent(kind: string, payload: Readonly<Record<string, unknown>>): DomainState {
  const state = fixture();
  return {
    ...state,
    entities: {
      ...state.entities,
      artifacts: state.entities.artifacts.map((artifact) =>
        artifact.id === id(3) ? { ...artifact, kind, payload } : artifact,
      ),
      revisions: state.entities.revisions.map((revision) =>
        revision.id === id(4) ? { ...revision, payload } : revision,
      ),
    },
  };
}
function hypothesis(predictionIds: readonly Id[] = []) {
  return {
    title: "hypothesis",
    statement: "testable",
    applicability: [],
    refutationCriteria: [],
    status: "proposed",
    tags: [],
    predictionIds,
    author: "researcher",
    generatedBy: "human",
  };
}
function prediction() {
  return {
    title: "prediction",
    applicability: [],
    interventionFactors: [],
    fixedFactors: [],
    expectedObservations: [
      { type: "qualitative", observable: "conductivity", description: "increases" },
    ],
    registration: { status: "draft", rules: [] },
    author: "researcher",
    generatedBy: "human",
  };
}
function observation() {
  return {
    title: "observation",
    observations: [
      {
        observable: "conductivity",
        quantity: { value: 0, unit: "S/cm", uncertainty: 0.01, significantFigures: 2 },
      },
    ],
    measurementConditions: { status: "unknown", reason: "not recorded" },
    sourceIds: [],
    analysisCodeIds: [],
    author: "researcher",
    generatedBy: "human",
  };
}
function aiNote() {
  return {
    ...note("AI interpretation"),
    author: "model origin",
    generatedBy: "ai",
    provenance: {
      id: id(80),
      originType: "ai",
      generatedBy: "ai",
      modelId: "model/version",
      timestamp,
      createdBy: "model",
      method: "generation",
      sourceIds: [],
    },
  };
}
function approvedContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return context({ aiApproval: { commandId: id(90), approvedBy: "editor" }, ...overrides });
}

describe("scientific content authority and save gates", () => {
  test("current cache mismatch is rejected even for an unrelated position edit", () => {
    expect.hasAssertions();
    const state = fixture();
    const invalid = {
      ...state,
      entities: {
        ...state.entities,
        artifacts: state.entities.artifacts.map((artifact) =>
          artifact.id === id(3) ? { ...artifact, payload: note("unrecorded edit") } : artifact,
        ),
      },
    };
    expectRejected(
      invalid,
      { type: "project.delete", id: id(1), baseVersion: 1 },
      "content_integrity_failed",
    );
    expectRejected(
      invalid,
      {
        type: "artifact.update",
        id: id(3),
        baseVersion: 1,
        content: { kind: "note", payload: note("next") },
      },
      "content_integrity_failed",
    );
  });

  test.each([
    { kind: "future-kind", payload: { mystery: "must not be certified" } },
    { kind: "Note", payload: note() },
    { kind: "note", payload: { title: "missing attribution", markdown: "" } },
    { kind: "note", payload: { ...note(), extraProvenance: { must: "survive" } } },
  ])("initial state cannot bypass strict M1 validation %#", ({ kind, payload }) => {
    expect.hasAssertions();
    expectRejected(
      stateWithContent(kind, payload),
      { type: "project.create", value: { title: "new", description: "" } },
      "validation_failed",
    );
  });

  test("detached old revisions also pass strict content and AI lineage gates", () => {
    expect.hasAssertions();
    const state = fixture();
    const invalid = {
      ...state,
      entities: {
        ...state.entities,
        revisions: [
          ...state.entities.revisions,
          {
            id: id(30),
            artifactId: id(3),
            payload: { ...note(), guessed: 0 },
            author: "old editor",
            createdAt: timestamp,
            version: 1,
          },
        ],
      },
    };
    expectRejected(invalid, crudCases[0].create, "validation_failed");
  });

  test("content mutation cannot change kind, reuse a Revision ID, or backdate an edit", () => {
    expect.hasAssertions();
    const command = {
      type: "artifact.update",
      id: id(3),
      baseVersion: 1,
      content: { kind: "note", payload: note("next") },
    };
    expectRejected(
      fixture(),
      { ...command, content: { kind: "hypothesis", payload: hypothesis() } },
      "immutable_field",
    );
    expectRejected(fixture(), command, "id_conflict", context({ revisionId: id(4) }));
    expectRejected(
      fixture(),
      command,
      "content_integrity_failed",
      context({ timestamp: v.parse(TimestampSchema, "2026-10-27T09:00:00+09:00") }),
    );
    expectRejected(fixture(), command, "invalid_context", {
      commandId: id(90),
      actor: "editor",
      timestamp: later,
      origin: "human",
    });
  });

  test.each([
    { kind: "hypothesis", payload: hypothesis([id(5)]) },
    { kind: "hypothesis", payload: hypothesis([id(99)]) },
    {
      kind: "experiment",
      payload: {
        title: "plan",
        objective: "discriminate",
        protocol: "measure",
        controls: [],
        conditions: [],
        predictionIds: [id(5)],
        decisionCriteria: [],
        author: "researcher",
        generatedBy: "human",
      },
    },
    {
      kind: "prediction",
      payload: {
        ...prediction(),
        registration: {
          status: "draft",
          rules: [
            {
              outcome: "up",
              supportsHypothesisIds: [id(5)],
              challengesHypothesisIds: [],
              rationale: "rule",
            },
          ],
        },
      },
    },
    { kind: "observation", payload: { ...observation(), sourceIds: [id(5)] } },
    { kind: "observation", payload: { ...observation(), analysisCodeIds: [id(5)] } },
    {
      kind: "frame",
      payload: {
        title: "group",
        description: "",
        artifactIds: [id(99)],
        author: "researcher",
        generatedBy: "human",
      },
    },
    {
      kind: "note",
      payload: {
        ...note(),
        provenance: {
          id: id(80),
          originType: "manual",
          sourceIds: [id(99)],
          createdBy: "researcher",
          method: "manual",
          timestamp,
        },
      },
    },
  ])("payload references require existing correct kinds in the same Project %#", (content) => {
    expect.hasAssertions();
    expectRejected(
      fixture(),
      { type: "artifact.create", projectId: id(1), content },
      "payload_reference_failed",
    );
  });

  test("payload references cannot cross Project boundaries", () => {
    expect.hasAssertions();
    const state = stateWithContent("hypothesis", hypothesis());
    const cross = {
      ...state,
      entities: {
        ...state.entities,
        projects: [
          ...state.entities.projects,
          { id: id(30), title: "other", description: "", createdAt: timestamp, version: 1 },
        ],
        artifacts: [
          ...state.entities.artifacts,
          {
            id: id(31),
            projectId: id(30),
            kind: "prediction",
            payload: prediction(),
            revisionId: id(32),
            version: 1,
          },
        ],
        revisions: [
          ...state.entities.revisions,
          {
            id: id(32),
            artifactId: id(31),
            payload: prediction(),
            author: "researcher",
            createdAt: timestamp,
            version: 1,
          },
        ],
      },
    };
    expectRejected(
      cross,
      {
        type: "artifact.update",
        id: id(3),
        baseVersion: 1,
        content: { kind: "hypothesis", payload: hypothesis([id(31)]) },
      },
      "payload_reference_failed",
    );
  });

  test("references are validated in historical content and deletion cannot orphan them", () => {
    const state = apply(fixture(), {
      type: "artifact.create",
      projectId: id(1),
      content: {
        kind: "frame",
        payload: {
          title: "group",
          description: "",
          artifactIds: [id(3)],
          author: "researcher",
          generatedBy: "human",
        },
      },
    }).state;
    const next = apply(
      state,
      {
        type: "artifact.update",
        id: id(20),
        baseVersion: 1,
        content: {
          kind: "frame",
          payload: {
            title: "group",
            description: "",
            artifactIds: [],
            author: "researcher",
            generatedBy: "human",
          },
        },
      },
      context({ revisionId: id(22) }),
    ).state;
    const detached = {
      ...next,
      entities: { ...next.entities, canvasItems: [] },
      itemPorts: [],
      semanticRelations: [],
      dataflowEdges: [],
      visualConnectors: [],
    };
    expectRejected(
      detached,
      { type: "artifact.delete", id: id(3), baseVersion: 1 },
      "payload_reference_failed",
    );
    expect(next.entities.revisions.some((revision) => revision.id === id(21))).toBe(true);
  });

  test("source/observation references preserve quantities, unknown conditions and units", () => {
    const source = apply(fixture(), {
      type: "artifact.create",
      projectId: id(1),
      content: {
        kind: "source",
        payload: {
          title: "data",
          sourceType: "file",
          reference: "measurement.csv",
          description: "",
          author: "researcher",
          generatedBy: "human",
        },
      },
    }).state;
    const payload = { ...observation(), sourceIds: [id(20)] };
    const { state } = apply(
      source,
      { type: "artifact.create", projectId: id(1), content: { kind: "observation", payload } },
      context({ entityId: id(30), revisionId: id(31) }),
    );
    expect(state.entities.artifacts[3]?.payload).toEqual(payload);
    expect(state.entities.revisions[3]?.payload).toEqual(payload);
    expect(state.semanticRelations).toEqual(source.semanticRelations);
  });

  test("new predictions register at the authoritative timestamp/actor and keep all old revisions", () => {
    const hypothesisState = stateWithContent("hypothesis", hypothesis());
    const rules = [
      {
        outcome: "increase",
        supportsHypothesisIds: [id(3)],
        challengesHypothesisIds: [],
        rationale: "discriminates",
      },
    ];
    const registered = {
      ...prediction(),
      registration: { status: "registered", registeredAt: later, registeredBy: "editor", rules },
    };
    const created = apply(hypothesisState, {
      type: "artifact.create",
      projectId: id(1),
      content: { kind: "prediction", payload: registered },
    });
    const future = v.parse(TimestampSchema, "2026-10-27T12:00:00+09:00");
    const edited = { ...registered, title: "new prediction" };
    expectRejected(
      created.state,
      {
        type: "artifact.update",
        id: id(20),
        baseVersion: 1,
        content: { kind: "prediction", payload: edited },
      },
      "registration_invalid",
      context({ timestamp: future, revisionId: id(22) }),
    );
    const draft = { ...edited, registration: { status: "draft", rules } };
    const updated = apply(
      created.state,
      {
        type: "artifact.update",
        id: id(20),
        baseVersion: 1,
        content: { kind: "prediction", payload: draft },
      },
      context({ timestamp: future, revisionId: id(22) }),
    );
    expect(
      updated.state.entities.revisions.find((revision) => revision.id === id(21))?.payload,
    ).toEqual(registered);
    expect(
      updated.state.entities.revisions.find((revision) => revision.id === id(22))?.payload,
    ).toEqual(draft);
    const reRegistered = {
      ...edited,
      registration: { status: "registered", registeredAt: future, registeredBy: "editor", rules },
    };
    const direct = apply(
      created.state,
      {
        type: "artifact.update",
        id: id(20),
        baseVersion: 1,
        content: { kind: "prediction", payload: reRegistered },
      },
      context({ timestamp: future, revisionId: id(22) }),
    );
    expect(direct.state.entities.artifacts[2]?.payload).toEqual(reRegistered);
    expectRejected(
      hypothesisState,
      {
        type: "artifact.create",
        projectId: id(1),
        content: {
          kind: "prediction",
          payload: {
            ...registered,
            registration: { ...registered.registration, registeredAt: future },
          },
        },
      },
      "registration_invalid",
    );
    expectRejected(
      hypothesisState,
      {
        type: "artifact.create",
        projectId: id(1),
        content: {
          kind: "prediction",
          payload: {
            ...registered,
            registration: { ...registered.registration, registeredBy: "forged" },
          },
        },
      },
      "registration_invalid",
    );
  });

  test("AI content and even an AI-origin structural proposal need authoritative approval", () => {
    expect.hasAssertions();
    const command = {
      type: "artifact.create",
      projectId: id(1),
      content: { kind: "note", payload: aiNote() },
    };
    expectRejected(fixture(), command, "ai_approval_required");
    expectRejected(
      fixture(),
      crudCases[0].create,
      "ai_approval_required",
      context({ origin: "ai" }),
    );
    expectRejected(
      fixture(),
      { ...command, aiApproval: { commandId: id(90), approvedBy: "editor" } },
      "validation_failed",
    );
    expectRejected(
      fixture(),
      command,
      "invalid_context",
      context({ aiApproval: { commandId: id(91), approvedBy: "editor" } }),
    );
    expectRejected(
      fixture(),
      command,
      "invalid_context",
      context({ aiApproval: { commandId: id(90), approvedBy: "another person" } }),
    );
  });

  test("approval retains generation metadata and records the human editor separately", () => {
    const command = {
      type: "artifact.create",
      projectId: id(1),
      content: { kind: "note", payload: aiNote() },
    };
    const accepted = apply(fixture(), command, approvedContext({ origin: "ai" }));
    expect(accepted.state.entities.artifacts[2]?.payload).toEqual(aiNote());
    expect(accepted.state.entities.revisions[2]).toMatchObject({
      author: "editor",
      createdAt: later,
      payload: aiNote(),
    });
    expect(accepted.events[0]).toMatchObject({
      origin: "ai",
      aiApproval: { commandId: id(90), approvedBy: "editor" },
    });
    const editedPayload = { ...aiNote(), markdown: "reviewed interpretation" };
    const updated = apply(
      accepted.state,
      {
        type: "artifact.update",
        id: id(20),
        baseVersion: 1,
        content: { kind: "note", payload: editedPayload },
      },
      approvedContext({ revisionId: id(22) }),
    );
    expect(updated.state.entities.revisions[3]?.payload.provenance).toEqual(aiNote().provenance);
    expectRejected(
      accepted.state,
      {
        type: "artifact.update",
        id: id(20),
        baseVersion: 1,
        content: { kind: "note", payload: note("laundered") },
      },
      "ai_origin_changed",
      approvedContext({ revisionId: id(22) }),
    );
    expectRejected(
      accepted.state,
      {
        type: "artifact.update",
        id: id(20),
        baseVersion: 1,
        content: {
          kind: "note",
          payload: {
            ...editedPayload,
            provenance: { ...editedPayload.provenance, modelId: "different" },
          },
        },
      },
      "ai_origin_changed",
      approvedContext({ revisionId: id(22) }),
    );
  });

  test("an initial history cannot launder an AI parent into human content", () => {
    expect.hasAssertions();
    const state = stateWithContent("note", aiNote());
    const invalid = {
      ...state,
      entities: {
        ...state.entities,
        artifacts: state.entities.artifacts.map((artifact) =>
          artifact.id === id(3) ? { ...artifact, revisionId: id(30), payload: note() } : artifact,
        ),
        revisions: [
          ...state.entities.revisions,
          {
            id: id(30),
            artifactId: id(3),
            parentId: id(4),
            payload: note(),
            author: "editor",
            createdAt: later,
            version: 1,
          },
        ],
      },
    };
    expectRejected(invalid, crudCases[0].create, "ai_origin_changed");
  });
});

describe("graph constraints remain atomic command invariants", () => {
  test.each([
    {
      name: "missing project",
      command: {
        type: "board.create",
        value: { projectId: id(99), name: "bad", viewport: { x: 0, y: 0, zoom: 1 } },
      },
      code: "reference_integrity_failed",
    },
    {
      name: "missing artifact",
      command: {
        type: "canvasItem.create",
        value: {
          boardId: id(2),
          artifactId: id(99),
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          viewState: {},
        },
        ports: [],
      },
      code: "reference_integrity_failed",
    },
    {
      name: "missing semantic endpoint",
      command: {
        type: "semanticRelation.create",
        value: { fromArtifactId: id(3), toArtifactId: id(99), relation: "predicts", rationale: "" },
      },
      code: "graph_integrity_failed",
    },
    {
      name: "missing visual endpoint",
      command: {
        type: "visualConnector.create",
        value: { boardId: id(2), source: id(7), target: id(99), style: {}, description: "" },
      },
      code: "graph_integrity_failed",
    },
    {
      name: "reversed port direction",
      command: {
        type: "dataflowEdge.create",
        value: {
          fromItemId: id(7),
          fromPort: "in",
          toItemId: id(9),
          toPort: "out",
          description: "",
        },
      },
      code: "graph_integrity_failed",
    },
    {
      name: "missing port",
      command: {
        type: "dataflowEdge.create",
        value: {
          fromItemId: id(7),
          fromPort: "missing",
          toItemId: id(9),
          toPort: "in",
          description: "",
        },
      },
      code: "graph_integrity_failed",
    },
    {
      name: "duplicate incoming connection",
      command: {
        type: "dataflowEdge.create",
        value: {
          fromItemId: id(9),
          fromPort: "out",
          toItemId: id(8),
          toPort: "in",
          description: "",
        },
      },
      code: "graph_integrity_failed",
    },
    {
      name: "cycle",
      command: {
        type: "dataflowEdge.create",
        value: {
          fromItemId: id(8),
          fromPort: "out",
          toItemId: id(7),
          toPort: "in",
          description: "",
        },
      },
      code: "graph_integrity_failed",
    },
    {
      name: "self-cycle",
      command: {
        type: "dataflowEdge.create",
        value: {
          fromItemId: id(9),
          fromPort: "out",
          toItemId: id(9),
          toPort: "in",
          description: "",
        },
      },
      code: "graph_integrity_failed",
    },
    {
      name: "parent project deletion",
      command: { type: "project.delete", id: id(1), baseVersion: 1 },
      code: "reference_integrity_failed",
    },
    {
      name: "parent board deletion",
      command: { type: "board.delete", id: id(2), baseVersion: 1 },
      code: "reference_integrity_failed",
    },
    {
      name: "shared artifact deletion",
      command: { type: "artifact.delete", id: id(3), baseVersion: 1 },
      code: "reference_integrity_failed",
    },
  ])("rejects $name without changing state", ({ command, code }) => {
    const state = fixture();
    const before = JSON.stringify(state);
    expectRejected(state, command, code);
    expect(JSON.stringify(state)).toBe(before);
  });

  test("port replacement cannot invalidate existing dataflow type/direction or remove ports", () => {
    expect.hasAssertions();
    const state = fixture();
    const command = {
      type: "canvasItem.update",
      id: id(8),
      baseVersion: 1,
      value: { x: 0, y: 0, width: 200, height: 100, viewState: {} },
    };
    expectRejected(
      state,
      { ...command, ports: [{ name: "in", direction: "input", type: "text" }] },
      "graph_integrity_failed",
    );
    expectRejected(
      state,
      { ...command, ports: [{ name: "in", direction: "output", type: "number" }] },
      "graph_integrity_failed",
    );
    expectRejected(state, { ...command, ports: [] }, "graph_integrity_failed");
    expectRejected(
      state,
      {
        ...command,
        ports: [
          { name: "in", direction: "input", type: "number" },
          { name: "in", direction: "output", type: "number" },
        ],
      },
      "graph_integrity_failed",
    );
  });

  test("cross-Board visual and dataflow links reject while semantic links remain Project-scoped", () => {
    const state = fixture();
    const board = apply(state, {
      type: "board.create",
      value: { projectId: id(1), name: "second", viewport: { x: 0, y: 0, zoom: 1 } },
    }).state;
    const item = apply(
      board,
      {
        type: "canvasItem.create",
        value: {
          boardId: id(20),
          artifactId: id(3),
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          viewState: {},
        },
        ports: [{ name: "in", direction: "input", type: "number" }],
      },
      context({ entityId: id(30) }),
    ).state;
    expectRejected(
      item,
      {
        type: "visualConnector.create",
        value: { boardId: id(2), source: id(7), target: id(30), style: {}, description: "" },
      },
      "graph_integrity_failed",
      context({ entityId: id(40) }),
    );
    expectRejected(
      item,
      {
        type: "dataflowEdge.create",
        value: {
          fromItemId: id(7),
          fromPort: "out",
          toItemId: id(30),
          toPort: "in",
          description: "",
        },
      },
      "graph_integrity_failed",
      context({ entityId: id(40) }),
    );
    const linked = apply(
      item,
      {
        type: "semanticRelation.create",
        value: {
          fromArtifactId: id(3),
          toArtifactId: id(5),
          relation: "references",
          rationale: "",
        },
      },
      context({ entityId: id(40) }),
    );
    expect(linked.state.semanticRelations).toHaveLength(2);
    expect(linked.state.entities.artifacts).toEqual(state.entities.artifacts);
    expect(item.entities.canvasItems.filter((entry) => entry.artifactId === id(3))).toHaveLength(2);
  });

  test("cross-Project semantic references are rejected without changing payload status", () => {
    expect.hasAssertions();
    const state = fixture();
    const project = apply(state, {
      type: "project.create",
      value: { title: "other", description: "" },
    }).state;
    const artifact = apply(
      project,
      { type: "artifact.create", projectId: id(20), content: { kind: "note", payload: note() } },
      context({ entityId: id(30), revisionId: id(31) }),
    ).state;
    expectRejected(
      artifact,
      {
        type: "semanticRelation.create",
        value: {
          fromArtifactId: id(3),
          toArtifactId: id(30),
          relation: "contradicts",
          rationale: "",
        },
      },
      "graph_integrity_failed",
      context({ entityId: id(40) }),
    );
  });

  test("initial invalid graphs fail before an unrelated command can be decided", () => {
    expect.hasAssertions();
    const state = fixture();
    expectRejected({ ...state, itemPorts: [] }, crudCases[0].create, "graph_integrity_failed");
    expectRejected(
      { ...state, dataflowEdges: [...state.dataflowEdges, ...state.dataflowEdges] },
      crudCases[0].create,
      "graph_integrity_failed",
    );
  });

  test("event union rejects undeclared outer metadata rather than stripping it", () => {
    const { events } = apply(fixture(), crudCases[0].create);
    const event = events[0];
    assert(event);
    expect(validate(EventSchema, { ...event, generatedBy: "ai" }).ok).toBe(false);
    expect(validate(EventSchema, { ...event, before: undefined }).ok).toBe(false);
    expect(validate(EventSchema, { ...event, type: "future.event" }).ok).toBe(false);
  });
});

function at(time: string): DomainState {
  const state = fixture();
  return {
    ...state,
    entities: {
      ...state.entities,
      revisions: state.entities.revisions.map((revision) => ({
        ...revision,
        createdAt: v.parse(TimestampSchema, time),
      })),
    },
  };
}
describe("exact timestamp causality at the content boundary", () => {
  const command = {
    type: "artifact.update",
    id: id(3),
    baseVersion: 1,
    content: { kind: "note", payload: note("next") },
  };

  test("sub-millisecond backward revision timestamps are rejected, without truncation", () => {
    expect.hasAssertions();
    expectRejected(
      at("2026-10-27T01:00:00.0009Z"),
      command,
      "content_integrity_failed",
      context({ timestamp: v.parse(TimestampSchema, "2026-10-27T01:00:00.0001Z") }),
    );
    expectRejected(
      at("2026-10-27T01:00:00.0000000000000000009Z"),
      command,
      "content_integrity_failed",
      context({ timestamp: v.parse(TimestampSchema, "2026-10-27T01:00:00.0000000000000000001Z") }),
    );
  });

  test("equivalent instants with different offsets/fraction widths remain valid and keep spelling", () => {
    const state = at("2026-10-27T10:00:00.123400+09:00");
    const value = v.parse(TimestampSchema, "2026-10-27T01:00:00.1234Z");
    const next = apply(state, command, context({ timestamp: value })).state;
    expect(next.entities.revisions[0]?.createdAt).toBe("2026-10-27T10:00:00.123400+09:00");
    expect(next.entities.revisions[2]?.createdAt).toBe(value);
  });

  test("future fractional registration timestamps reject, equivalent offsets are accepted", () => {
    const state = stateWithContent("hypothesis", hypothesis());
    const registered = {
      ...prediction(),
      registration: {
        status: "registered",
        registeredAt: "2026-10-27T01:00:00.0009Z",
        registeredBy: "editor",
        rules: [
          {
            outcome: "up",
            supportsHypothesisIds: [id(3)],
            challengesHypothesisIds: [],
            rationale: "rule",
          },
        ],
      },
    };
    const ctx = context({ timestamp: v.parse(TimestampSchema, "2026-10-27T01:00:00.0001Z") });
    expectRejected(
      state,
      {
        type: "artifact.create",
        projectId: id(1),
        content: { kind: "prediction", payload: registered },
      },
      "registration_invalid",
      ctx,
    );
    const equivalent = {
      ...registered,
      registration: {
        ...registered.registration,
        registeredAt: "2026-10-27T10:00:00.000100+09:00",
      },
    };
    const next = apply(
      state,
      {
        type: "artifact.create",
        projectId: id(1),
        content: { kind: "prediction", payload: equivalent },
      },
      ctx,
    ).state;
    expect(next.entities.artifacts[2]?.payload).toEqual(equivalent);
  });

  test("an unknown -00:00 offset fails closed wherever causal order is required", () => {
    expect.hasAssertions();
    expectRejected(at("2026-10-27T01:00:00-00:00"), command, "chronology_undetermined");
    expectRejected(
      fixture(),
      command,
      "chronology_undetermined",
      context({ timestamp: v.parse(TimestampSchema, "2026-10-27T02:00:00-00:00") }),
    );
    const state = stateWithContent("hypothesis", hypothesis());
    const registered = {
      ...prediction(),
      registration: {
        status: "registered",
        registeredAt: "2026-10-27T02:00:00-00:00",
        registeredBy: "editor",
        rules: [
          {
            outcome: "up",
            supportsHypothesisIds: [id(3)],
            challengesHypothesisIds: [],
            rationale: "rule",
          },
        ],
      },
    };
    expectRejected(
      state,
      {
        type: "artifact.create",
        projectId: id(1),
        content: { kind: "prediction", payload: registered },
      },
      "chronology_undetermined",
    );
  });
});

describe("review regressions for origin, ownership and independent replay", () => {
  test.each(["artifact.create", "artifact.update"])(
    "approved AI-origin %s cannot label generated content human",
    (type) => {
      expect.hasAssertions();
      const target =
        type === "artifact.create" ? { projectId: id(1) } : { id: id(3), baseVersion: 1 };
      expectRejected(
        fixture(),
        { type, ...target, content: { kind: "note", payload: note() } },
        "ai_origin_changed",
        approvedContext({ origin: "ai" }),
      );
      const humanProvenance = {
        ...note(),
        provenance: {
          id: id(80),
          originType: "manual",
          timestamp,
          createdBy: "researcher",
          method: "manual",
          sourceIds: [],
        },
      };
      expectRejected(
        fixture(),
        { type, ...target, content: { kind: "note", payload: humanProvenance } },
        "ai_origin_changed",
        approvedContext({ origin: "ai" }),
      );
    },
  );

  test.each(crudCases.filter((entry) => entry.target !== "artifact"))(
    "approved AI-origin $target structural creation fails closed",
    (entry) => {
      expect.hasAssertions();
      expectRejected(
        fixture(),
        entry.create,
        "ai_origin_unsupported",
        approvedContext({ origin: "ai" }),
      );
    },
  );

  test("approved AI-origin structural updates/deletes also fail closed", () => {
    expect.hasAssertions();
    expectRejected(
      fixture(),
      {
        type: "project.update",
        id: id(1),
        baseVersion: 1,
        value: { title: "AI proposal", description: "" },
      },
      "ai_origin_unsupported",
      approvedContext({ origin: "ai" }),
    );
    expectRejected(
      fixture(),
      { type: "semanticRelation.delete", id: id(10), baseVersion: 1 },
      "ai_origin_unsupported",
      approvedContext({ origin: "ai" }),
    );
    expectRejected(
      fixture(),
      { type: "artifact.delete", id: id(3), baseVersion: 1 },
      "ai_origin_unsupported",
      approvedContext({ origin: "ai" }),
    );
  });

  test("a human-origin operation can explicitly approve fully attributed AI content", () => {
    const command = {
      type: "artifact.create",
      projectId: id(1),
      content: { kind: "note", payload: aiNote() },
    };
    const result = apply(fixture(), command, approvedContext({ origin: "human" }));
    expect(result.state.entities.artifacts[2]?.payload).toEqual(aiNote());
    expect(result.events[0]).toMatchObject({
      origin: "human",
      aiApproval: { commandId: id(90), approvedBy: "editor" },
    });
  });

  test("visual connector update keeps its Board and rejects an attempted valid move", () => {
    const board = apply(fixture(), {
      type: "board.create",
      value: { projectId: id(1), name: "another board", viewport: { x: 0, y: 0, zoom: 1 } },
    }).state;
    const state = apply(
      board,
      {
        type: "canvasItem.create",
        value: { boardId: id(20), x: 0, y: 0, width: 100, height: 100, viewState: {} },
        ports: [],
      },
      context({ entityId: id(30) }),
    ).state;
    expectRejected(
      state,
      {
        type: "visualConnector.update",
        id: id(12),
        baseVersion: 1,
        value: {
          boardId: id(20),
          source: id(30),
          target: id(30),
          style: {},
          description: "move to another board",
        },
      },
      "validation_failed",
    );
    const updated = apply(state, {
      type: "visualConnector.update",
      id: id(12),
      baseVersion: 1,
      value: { source: id(8), target: id(9), style: { color: "blue" }, description: "same board" },
    });
    expect(updated.state.visualConnectors[0]?.boardId).toBe(id(2));
  });

  test("content decision and replay both match a complete handwritten expected state/event", () => {
    const beforeArtifact = {
      id: id(3),
      projectId: id(1),
      kind: "note",
      payload: {
        title: "original",
        markdown: "before",
        author: "content researcher",
        generatedBy: "human",
      },
      revisionId: id(4),
      version: 1,
    };
    const beforeRevision = {
      id: id(4),
      artifactId: id(3),
      payload: {
        title: "original",
        markdown: "before",
        author: "content researcher",
        generatedBy: "human",
      },
      author: "first editor",
      createdAt: timestamp,
      version: 1,
    };
    const project = {
      id: id(1),
      title: "research",
      description: "small fixture",
      createdAt: timestamp,
      version: 1,
    };
    const beforeState: DomainState = {
      entities: {
        projects: [project],
        boards: [],
        artifacts: [beforeArtifact],
        revisions: [beforeRevision],
        canvasItems: [],
      },
      itemPorts: [],
      semanticRelations: [],
      dataflowEdges: [],
      visualConnectors: [],
    };
    freezeDeep(beforeState);
    const afterArtifact = {
      id: id(3),
      projectId: id(1),
      kind: "note",
      payload: {
        title: "edited",
        markdown: "after",
        author: "content researcher",
        generatedBy: "human",
      },
      revisionId: id(21),
      version: 2,
    };
    const afterRevision = {
      id: id(21),
      artifactId: id(3),
      parentId: id(4),
      payload: {
        title: "edited",
        markdown: "after",
        author: "content researcher",
        generatedBy: "human",
      },
      author: "editor",
      createdAt: later,
      version: 1,
    };
    const expectedState: DomainState = {
      entities: {
        projects: [project],
        boards: [],
        artifacts: [afterArtifact],
        revisions: [beforeRevision, afterRevision],
        canvasItems: [],
      },
      itemPorts: [],
      semanticRelations: [],
      dataflowEdges: [],
      visualConnectors: [],
    };
    const expectedEvent: Event = {
      type: "artifact.changed",
      commandId: id(90),
      actor: "editor",
      timestamp: later,
      origin: "human",
      before: beforeArtifact,
      after: afterArtifact,
      revisionsBefore: [beforeRevision],
      revisionsAfter: [beforeRevision, afterRevision],
    };
    const decision = decide(
      beforeState,
      {
        type: "artifact.update",
        id: id(3),
        baseVersion: 1,
        content: {
          kind: "note",
          payload: {
            title: "edited",
            markdown: "after",
            author: "content researcher",
            generatedBy: "human",
          },
        },
      },
      context(),
    );
    assert(decision.ok);
    expect(decision.value).toEqual([expectedEvent]);
    expect(decision.value.reduce(evolve, beforeState)).toEqual(expectedState);
    expect(evolve(beforeState, expectedEvent)).toEqual(expectedState);
    expect(beforeState.entities.artifacts).toEqual([beforeArtifact]);
    expect(beforeState.entities.revisions).toEqual([beforeRevision]);
  });
});

test("known M1 read boundary accepts mixed future content without weakening cache integrity or save rules", () => {
  const source = fixture();
  const mixed: DomainState = {
    ...source,
    entities: {
      ...source.entities,
      artifacts: source.entities.artifacts.map((artifact) =>
        artifact.id === id(5) ? { ...artifact, kind: "future-table" } : artifact,
      ),
    },
  };
  const read = validateKnownM1State(mixed);
  assert(read.ok);
  expect(read.value).toEqual(mixed);
  expect(validateDomainState(mixed).ok).toBe(false);
  const stale: DomainState = {
    ...mixed,
    entities: {
      ...mixed.entities,
      artifacts: mixed.entities.artifacts.map((artifact) =>
        artifact.id === id(3) ? { ...artifact, payload: note("stale cache") } : artifact,
      ),
    },
  };
  expect(validateKnownM1State(stale)).toMatchObject({
    ok: false,
    error: { code: "content_integrity_failed" },
  });
  expect(source.entities.artifacts.every((artifact) => artifact.kind === "note")).toBe(true);
});
