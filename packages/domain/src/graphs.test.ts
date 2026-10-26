import * as v from "valibot";
import { assert, describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  arePortTypesCompatible,
  DataflowEdgeSchema,
  GraphSnapshotSchema,
  ItemPortsSchema,
  PortDataTypeSchema,
  PortDefinitionSchema,
  SemanticRelationSchema,
  SemanticRelationTypeSchema,
  validate,
  validateGraphSnapshot,
  VisualConnectorSchema,
  type DataflowEdge,
  type GraphReferenceIssue,
  type GraphSnapshot,
  type ItemPorts,
  type PortDefinition,
  type SemanticRelation,
  type VisualConnector,
} from "./index.ts";

function id(value: number): string {
  return `01ARZ3NDEKTSV4${String(value).padStart(12, "0")}`;
}
const createdAt = "2026-10-27T10:11:12+09:00";
const lineMetadata = { createdAt, createdBy: "researcher", version: 1 } as const;

function makeSnapshot(): v.InferInput<typeof GraphSnapshotSchema> {
  return {
    entities: {
      projects: [{ id: id(1), title: "project", description: "", createdAt, version: 1 }],
      boards: [
        {
          id: id(2),
          projectId: id(1),
          name: "board",
          viewport: { x: 0, y: 0, zoom: 1 },
          version: 1,
        },
      ],
      artifacts: [3, 4].map((value) => ({
        id: id(value),
        projectId: id(1),
        kind: "future-kind",
        payload: {},
        revisionId: id(value + 2),
        version: 1,
      })),
      revisions: [3, 4].map((value) => ({
        id: id(value + 2),
        artifactId: id(value),
        payload: {},
        author: "researcher",
        createdAt,
        version: 1,
      })),
      canvasItems: [7, 8, 9].map((value) => ({
        id: id(value),
        boardId: id(2),
        ...(value === 9 ? {} : { artifactId: id(value - 4) }),
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        viewState: {},
        version: 1,
      })),
    },
    itemPorts: [7, 8].map((value) => ({
      itemId: id(value),
      ports: [
        { name: "in", direction: "input", type: "number" },
        { name: "out", direction: "output", type: "number" },
      ],
    })),
    semanticRelations: [
      {
        ...lineMetadata,
        id: id(10),
        type: "semantic-relation",
        fromArtifactId: id(3),
        toArtifactId: id(4),
        relation: "supports",
        rationale: "observed evidence",
      },
    ],
    dataflowEdges: [
      {
        ...lineMetadata,
        id: id(11),
        type: "dataflow-edge",
        fromItemId: id(7),
        fromPort: "out",
        toItemId: id(8),
        toPort: "in",
        description: "",
      },
    ],
    visualConnectors: [
      {
        ...lineMetadata,
        id: id(12),
        type: "visual-connector",
        boardId: id(2),
        source: id(7),
        target: id(9),
        style: { arrow: true },
        description: "annotation",
      },
    ],
  };
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  assert(value !== undefined);
  return value;
}

function issues(snapshot: unknown): readonly GraphReferenceIssue[] {
  const result = validateGraphSnapshot(snapshot);
  assert(!result.ok && result.error.code === "graph_integrity_failed");
  return result.error.issues;
}

function codes(snapshot: unknown): string[] {
  return issues(snapshot).map((issue) => issue.code);
}

function freeze(input: unknown): void {
  if (typeof input !== "object" || input === null || Object.isFrozen(input)) return;
  Object.freeze(input);
  for (const value of Object.values(input)) freeze(value);
}

const lineCases = [
  {
    name: "semantic",
    schema: SemanticRelationSchema,
    value: () => first(makeSnapshot().semanticRelations),
  },
  {
    name: "dataflow",
    schema: DataflowEdgeSchema,
    value: () => first(makeSnapshot().dataflowEdges),
  },
  {
    name: "visual",
    schema: VisualConnectorSchema,
    value: () => first(makeSnapshot().visualConnectors),
  },
];

describe("strict distinct line schemas", () => {
  test.each(lineCases)(
    "requires each $name field, valid identifiers and explicit metadata",
    ({ schema, value }) => {
      expect(validate(schema, value()).ok).toBe(true);
      for (const field of Object.keys(value())) {
        const missing: Record<string, unknown> = { ...value() };
        delete missing[field];
        expect(validate(schema, missing).ok, `missing ${field}`).toBe(false);
        for (const invalid of [null, undefined]) {
          expect(validate(schema, { ...value(), [field]: invalid }).ok).toBe(false);
        }
      }
      for (const invalid of ["not-an-id", id(1).toLowerCase()]) {
        expect(validate(schema, { ...value(), id: invalid }).ok).toBe(false);
      }
      for (const version of [0, 1.5, Number.NaN, Infinity, "1"]) {
        expect(validate(schema, { ...value(), version }).ok).toBe(false);
      }
      expect(validate(schema, { ...value(), createdAt: "2026-02-30T00:00:00Z" }).ok).toBe(false);
      expect(validate(schema, { ...value(), createdBy: " \t" }).ok).toBe(false);
      expect(validate(schema, { ...value(), futureProvenance: { originType: "ai" } }).ok).toBe(
        false,
      );
      expect(validate(schema, { ...value(), metadata: undefined }).ok).toBe(false);
      expect(validate(schema, { ...value(), metadata: [] }).ok).toBe(false);
      const metadata = Object.freeze({
        originType: "ai",
        approved: false,
        future: { sourceIds: [id(1)] },
      });
      const parsed = validate(schema, { ...value(), metadata });
      assert(parsed.ok);
      expect(parsed.value.metadata).toBe(metadata);
    },
  );

  test("rejects interchange of line kinds and scientific meaning on display connectors", () => {
    const snapshot = makeSnapshot();
    expect(validate(SemanticRelationSchema, first(snapshot.dataflowEdges)).ok).toBe(false);
    expect(validate(DataflowEdgeSchema, first(snapshot.visualConnectors)).ok).toBe(false);
    expect(validate(VisualConnectorSchema, first(snapshot.semanticRelations)).ok).toBe(false);
    expect(
      validate(VisualConnectorSchema, { ...first(snapshot.visualConnectors), relation: "supports" })
        .ok,
    ).toBe(false);
    expect(
      validate(SemanticRelationSchema, {
        ...first(snapshot.semanticRelations),
        type: "visual-connector",
      }).ok,
    ).toBe(false);
  });

  test("supports all ten semantic relations and ten exact port data types", () => {
    const relations = [
      "supports",
      "contradicts",
      "predicts",
      "tests",
      "explains",
      "depends_on",
      "competes_with",
      "can_coexist_with",
      "derived_from",
      "references",
    ];
    const types = [
      "number",
      "text",
      "json",
      "table",
      "series",
      "element-selection",
      "ionic-radius-selection",
      "composition",
      "structure-ref",
      "binary-ref",
    ];
    expect(SemanticRelationTypeSchema.options).toEqual(relations);
    expect(PortDataTypeSchema.options).toEqual(types);
    for (const relation of relations)
      expect(validate(SemanticRelationTypeSchema, relation).ok).toBe(true);
    for (const input of ["unknown", "Number", null]) {
      expect(validate(SemanticRelationTypeSchema, input).ok).toBe(false);
      expect(validate(PortDataTypeSchema, input).ok).toBe(false);
    }
    for (const output of PortDataTypeSchema.options) {
      for (const input of PortDataTypeSchema.options) {
        expect(arePortTypesCompatible(output, input)).toBe(output === input);
      }
    }
  });

  test("requires named typed directional ports with no unknown fields", () => {
    const port = first(first(makeSnapshot().itemPorts).ports);
    for (const invalid of ["", " \t", null, undefined]) {
      expect(validate(PortDefinitionSchema, { ...port, name: invalid }).ok).toBe(false);
    }
    expect(validate(PortDefinitionSchema, { ...port, direction: "both" }).ok).toBe(false);
    expect(validate(PortDefinitionSchema, { ...port, type: "float" }).ok).toBe(false);
    expect(validate(PortDefinitionSchema, { ...port, unit: "K" }).ok).toBe(false);
    expect(validate(ItemPortsSchema, { itemId: id(7) }).ok).toBe(false);
  });

  test("preserves visual styling and explicit port metadata without inferring meaning", () => {
    const snapshot = makeSnapshot();
    const style = Object.freeze({ futureArrow: { points: [1, 2, 3] }, label: "supports" });
    const connector = validate(VisualConnectorSchema, {
      ...first(snapshot.visualConnectors),
      style,
    });
    assert(connector.ok);
    expect(connector.value.style).toBe(style);
    const metadata = Object.freeze({
      futureSchema: { version: 2 },
      provenance: { approved: false },
    });
    const port = validate(PortDefinitionSchema, {
      ...first(first(snapshot.itemPorts).ports),
      metadata,
    });
    assert(port.ok);
    expect(port.value.metadata).toBe(metadata);
    for (const type of PortDataTypeSchema.options) {
      const graph = makeSnapshot();
      graph.itemPorts = graph.itemPorts.map((entry) => ({
        ...entry,
        ports: entry.ports.map((entryPort) => ({ ...entryPort, type })),
      }));
      expect(validateGraphSnapshot(graph).ok).toBe(true);
    }
  });

  test("exports independent readonly lines, nested definitions and collections", () => {
    expectTypeOf<SemanticRelation>().toEqualTypeOf<Readonly<SemanticRelation>>();
    expectTypeOf<DataflowEdge>().toEqualTypeOf<Readonly<DataflowEdge>>();
    expectTypeOf<VisualConnector>().toEqualTypeOf<Readonly<VisualConnector>>();
    expectTypeOf<PortDefinition>().toEqualTypeOf<Readonly<PortDefinition>>();
    expectTypeOf<ItemPorts>().toEqualTypeOf<Readonly<ItemPorts>>();
    expectTypeOf<ItemPorts["ports"]>().toEqualTypeOf<readonly PortDefinition[]>();
    expectTypeOf<GraphSnapshot>().toEqualTypeOf<Readonly<GraphSnapshot>>();
    expectTypeOf<GraphSnapshot["dataflowEdges"]>().toEqualTypeOf<readonly DataflowEdge[]>();
    expectTypeOf<SemanticRelation>().not.toExtend<DataflowEdge>();
    expectTypeOf<VisualConnector>().not.toExtend<SemanticRelation>();
  });
});

describe("graph reference integrity", () => {
  test("validates same-project knowledge independently of Board placements", () => {
    const snapshot = makeSnapshot();
    snapshot.semanticRelations.push({
      ...first(snapshot.semanticRelations),
      id: id(13),
      fromArtifactId: id(4),
      toArtifactId: id(3),
    });
    snapshot.semanticRelations.push({
      ...first(snapshot.semanticRelations),
      id: id(14),
      toArtifactId: id(3),
    });
    snapshot.visualConnectors.push({
      ...first(snapshot.visualConnectors),
      id: id(15),
      source: id(9),
      target: id(7),
    });
    snapshot.visualConnectors.push({
      ...first(snapshot.visualConnectors),
      id: id(16),
      target: id(7),
    });
    snapshot.entities.canvasItems = snapshot.entities.canvasItems.map(
      ({ artifactId: _artifactId, ...item }) => item,
    );
    expect(validateGraphSnapshot(snapshot)).toEqual({ ok: true, value: snapshot });
  });

  test("requires all graph collections and validates existing entity references first", () => {
    expect(validateGraphSnapshot({}).ok).toBe(false);
    expect(validateGraphSnapshot({ ...makeSnapshot(), arbitrary: {} }).ok).toBe(false);
    const snapshot = makeSnapshot();
    snapshot.entities.boards = [];
    const result = validateGraphSnapshot(snapshot);
    assert(!result.ok);
    expect(result.error.code).toBe("reference_integrity_failed");
    expect(
      validateGraphSnapshot({
        entities: { projects: [], boards: [], artifacts: [], revisions: [], canvasItems: [] },
        itemPorts: [],
        semanticRelations: [],
        dataflowEdges: [],
        visualConnectors: [],
      }).ok,
    ).toBe(true);
  });

  test.each(["semanticRelations", "dataflowEdges", "visualConnectors", "itemPorts"] as const)(
    "rejects duplicate IDs in %s before resolution",
    (collection) => {
      const snapshot = makeSnapshot();
      expect(
        codes({
          ...snapshot,
          [collection]: [...snapshot[collection], snapshot[collection][0]],
        }),
      ).toEqual(["duplicate_id"]);
    },
  );

  test("rejects ambiguous duplicate port names even when directions differ", () => {
    const snapshot = makeSnapshot();
    snapshot.itemPorts = snapshot.itemPorts.map((entry) => ({
      ...entry,
      ports: [
        { name: "value", direction: "input", type: "number" },
        { name: "value", direction: "output", type: "number" },
      ],
    }));
    expect(codes(snapshot)).toEqual(["duplicate_port", "duplicate_port"]);
  });

  test("reports missing Artifact, item, Board, registry and port references with source fields", () => {
    const snapshot = makeSnapshot();
    snapshot.semanticRelations = snapshot.semanticRelations.map((relation) => ({
      ...relation,
      fromArtifactId: id(100),
      toArtifactId: id(101),
    }));
    snapshot.itemPorts.push({ itemId: id(102), ports: [] });
    snapshot.dataflowEdges = snapshot.dataflowEdges.map((edge) => ({
      ...edge,
      fromItemId: id(103),
      toItemId: id(104),
    }));
    snapshot.visualConnectors = snapshot.visualConnectors.map((connector) => ({
      ...connector,
      boardId: id(105),
      source: id(106),
      target: id(107),
    }));
    expect(issues(snapshot).map((issue) => [issue.code, issue.field, issue.reference])).toEqual([
      ["missing_reference", "itemId", id(102)],
      ["missing_reference", "fromArtifactId", id(100)],
      ["missing_reference", "toArtifactId", id(101)],
      ["missing_reference", "fromItemId", id(103)],
      ["missing_reference", "toItemId", id(104)],
      ["missing_reference", "boardId", id(105)],
      ["missing_reference", "source", id(106)],
      ["missing_reference", "target", id(107)],
    ]);
    const missingPorts = makeSnapshot();
    missingPorts.itemPorts = [];
    expect(codes(missingPorts)).toEqual(["missing_port", "missing_port"]);
    missingPorts.itemPorts = makeSnapshot().itemPorts;
    missingPorts.dataflowEdges = missingPorts.dataflowEdges.map((edge) => ({
      ...edge,
      fromPort: "missing",
      toPort: "absent",
    }));
    expect(codes(missingPorts)).toEqual(["missing_port", "missing_port"]);
  });

  test("rejects knowledge relations across Projects without requiring canvas placements", () => {
    const snapshot = makeSnapshot();
    snapshot.entities.projects.push({ ...first(snapshot.entities.projects), id: id(20) });
    snapshot.entities.artifacts = snapshot.entities.artifacts.map((artifact) => ({
      ...artifact,
      projectId: artifact.id === id(4) ? id(20) : artifact.projectId,
    }));
    snapshot.entities.canvasItems = snapshot.entities.canvasItems.map(
      ({ artifactId: _artifactId, ...item }) => item,
    );
    expect(codes(snapshot)).toEqual(["project_mismatch"]);
  });

  test("rejects dataflow across Boards and visual endpoints outside the declared Board", () => {
    const snapshot = makeSnapshot();
    snapshot.entities.boards.push({ ...first(snapshot.entities.boards), id: id(20) });
    snapshot.entities.canvasItems = snapshot.entities.canvasItems.map((item) => ({
      ...item,
      boardId: item.id === id(8) || item.id === id(9) ? id(20) : item.boardId,
    }));
    expect(codes(snapshot)).toEqual(["board_mismatch", "board_mismatch"]);
    snapshot.visualConnectors = snapshot.visualConnectors.map((connector) => ({
      ...connector,
      boardId: id(20),
    }));
    expect(codes(snapshot)).toEqual(["board_mismatch", "board_mismatch"]);
  });

  test("rejects reversed port direction and incompatible data types without JSON wildcard conversion", () => {
    const snapshot = makeSnapshot();
    snapshot.dataflowEdges = snapshot.dataflowEdges.map((edge) => ({
      ...edge,
      fromPort: "in",
      toPort: "out",
    }));
    expect(codes(snapshot)).toEqual(["port_direction_mismatch", "port_direction_mismatch"]);
    snapshot.dataflowEdges = makeSnapshot().dataflowEdges;
    snapshot.itemPorts = snapshot.itemPorts.map((entry) => ({
      ...entry,
      ports: entry.ports.map((port) => ({
        ...port,
        type: entry.itemId === id(8) ? "json" : "number",
      })),
    }));
    expect(codes(snapshot)).toEqual(["port_type_mismatch"]);
  });

  test("rejects every subsequent connection into the same input, including identical endpoints", () => {
    const snapshot = makeSnapshot();
    const edge = first(snapshot.dataflowEdges);
    snapshot.itemPorts.push({ ...first(snapshot.itemPorts), itemId: id(9) });
    snapshot.dataflowEdges.push(
      { ...edge, id: id(20) },
      { ...edge, id: id(21), fromItemId: id(9) },
    );
    expect(issues(snapshot)).toEqual(
      [20, 21].map((value) => ({
        code: "duplicate_input_connection",
        collection: "dataflowEdges",
        id: id(value),
        field: "toPort",
        reference: "in",
      })),
    );
  });

  test("allows output fan-out, distinct-port parallel edges and diamond joins on distinct inputs", () => {
    const snapshot = makeSnapshot();
    const edge = first(snapshot.dataflowEdges);
    snapshot.itemPorts = snapshot.itemPorts.map((entry) => ({
      ...entry,
      ports: [
        ...entry.ports,
        { name: "second-in", direction: "input", type: "number" },
        { name: "second-out", direction: "output", type: "number" },
      ],
    }));
    snapshot.itemPorts.push({ ...first(snapshot.itemPorts), itemId: id(9) });
    snapshot.dataflowEdges.push({
      ...edge,
      id: id(20),
      fromPort: "second-out",
      toPort: "second-in",
    });
    expect(validateGraphSnapshot(snapshot).ok).toBe(true);
    snapshot.dataflowEdges = [
      edge,
      { ...edge, id: id(22), toItemId: id(9) },
      { ...edge, id: id(23), fromItemId: id(9), toPort: "second-in" },
    ];
    expect(validateGraphSnapshot(snapshot).ok).toBe(true);
  });

  test("detects self cycles and multi-item cycles with a single upstream connection per input", () => {
    const snapshot = makeSnapshot();
    const edge = first(snapshot.dataflowEdges);
    snapshot.dataflowEdges.push({ ...edge, id: id(21), fromItemId: id(8), toItemId: id(7) });
    expect(codes(snapshot)).toEqual(["dataflow_cycle"]);
    snapshot.dataflowEdges = [{ ...edge, toItemId: id(7) }];
    expect(codes(snapshot)).toEqual(["dataflow_cycle"]);
  });

  test("does not resolve directions or types from port registrations for missing items", () => {
    const snapshot = makeSnapshot();
    snapshot.itemPorts.push({
      itemId: id(20),
      ports: [{ name: "out", direction: "input", type: "text" }],
    });
    snapshot.dataflowEdges = snapshot.dataflowEdges.map((edge) => ({
      ...edge,
      fromItemId: id(20),
    }));
    expect(codes(snapshot)).toEqual(["missing_reference", "missing_reference"]);
  });

  test("detects disconnected cycles and preserves direction instead of treating edges as undirected", () => {
    const snapshot = makeSnapshot();
    snapshot.itemPorts.push({ ...first(snapshot.itemPorts), itemId: id(9) });
    snapshot.dataflowEdges.push({
      ...first(snapshot.dataflowEdges),
      id: id(20),
      fromItemId: id(9),
      toItemId: id(9),
    });
    const cycle = issues(snapshot);
    expect(cycle).toEqual([
      {
        code: "dataflow_cycle",
        collection: "dataflowEdges",
        id: id(20),
        field: "toItemId",
        reference: id(9),
      },
    ]);
  });

  test("validates long chains and their closing cycle iteratively", () => {
    const snapshot = makeSnapshot();
    const item = first(snapshot.entities.canvasItems);
    const ports = first(snapshot.itemPorts);
    const edge = first(snapshot.dataflowEdges);
    snapshot.entities.canvasItems = [];
    snapshot.itemPorts = [];
    snapshot.dataflowEdges = [];
    snapshot.visualConnectors = [];
    const length = 12000;
    for (let index = 0; index < length; index++) {
      const itemId = id(1000 + index);
      snapshot.entities.canvasItems.push({ ...item, id: itemId });
      snapshot.itemPorts.push({ ...ports, itemId });
      if (index > 0)
        snapshot.dataflowEdges.push({
          ...edge,
          id: id(20000 + index),
          fromItemId: id(999 + index),
          toItemId: itemId,
        });
    }
    expect(validateGraphSnapshot(snapshot).ok).toBe(true);
    snapshot.dataflowEdges.push({
      ...edge,
      id: id(40000),
      fromItemId: id(999 + length),
      toItemId: id(1000),
    });
    expect(codes(snapshot)).toEqual(["dataflow_cycle"]);
  });

  test("leaves frozen input and opaque provenance untouched on success and failure", () => {
    const snapshot = makeSnapshot();
    const metadata = { originType: "ai", approved: false, sources: [id(3)] };
    snapshot.semanticRelations = snapshot.semanticRelations.map((relation) => ({
      ...relation,
      metadata,
    }));
    const original = JSON.stringify(snapshot);
    freeze(snapshot);
    const result = validateGraphSnapshot(snapshot);
    assert(result.ok);
    expect(first(result.value.semanticRelations).metadata).toBe(metadata);
    expect(JSON.stringify(snapshot)).toBe(original);
    const invalid = {
      ...snapshot,
      dataflowEdges: [{ ...first(snapshot.dataflowEdges), toItemId: id(7) }],
    };
    freeze(invalid);
    expect(codes(invalid)).toEqual(["dataflow_cycle"]);
    expect(JSON.stringify(snapshot)).toBe(original);
  });
});
