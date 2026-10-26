import { validateEntitySnapshot, type EntityReferenceError } from "./entity-snapshot.ts";
import {
  arePortTypesCompatible,
  GraphSnapshotSchema,
  type DataflowEdge,
  type GraphSnapshot,
  type PortDefinition,
} from "./graphs.ts";
import type { Id } from "./id.ts";
import { err, ok, type Result } from "./result.ts";
import { validate, type ValidationError } from "./validation.ts";

export type GraphReferenceIssue = {
  readonly code:
    | "duplicate_id"
    | "duplicate_port"
    | "duplicate_input_connection"
    | "missing_reference"
    | "project_mismatch"
    | "board_mismatch"
    | "missing_port"
    | "port_direction_mismatch"
    | "port_type_mismatch"
    | "dataflow_cycle";
  readonly collection: Exclude<keyof GraphSnapshot, "entities">;
  readonly id: Id;
  readonly field: string;
  readonly reference: string;
};
export type GraphReferenceError = {
  readonly code: "graph_integrity_failed";
  readonly issues: readonly GraphReferenceIssue[];
};

/** Iterative DFS reports actual back edges, including disconnected and self cycles. */
function findDataflowCycles(edges: readonly DataflowEdge[]): GraphReferenceIssue[] {
  const adjacency = new Map<Id, DataflowEdge[]>();
  for (const edge of edges) {
    const outgoing = adjacency.get(edge.fromItemId);
    if (outgoing) outgoing.push(edge);
    else adjacency.set(edge.fromItemId, [edge]);
  }
  const active = new Set<Id>();
  const complete = new Set<Id>();
  const issues: GraphReferenceIssue[] = [];
  for (const start of adjacency.keys()) {
    if (complete.has(start)) continue;
    active.add(start);
    const stack: { readonly id: Id; readonly edges: Iterator<DataflowEdge> }[] = [
      { id: start, edges: (adjacency.get(start) ?? [])[Symbol.iterator]() },
    ];
    while (stack.length > 0) {
      const frame = stack.at(-1);
      if (!frame) break;
      const next = frame.edges.next();
      if (next.done) {
        active.delete(frame.id);
        complete.add(frame.id);
        stack.pop();
        continue;
      }
      const edge = next.value;
      if (active.has(edge.toItemId)) {
        issues.push({
          code: "dataflow_cycle",
          collection: "dataflowEdges",
          id: edge.id,
          field: "toItemId",
          reference: edge.toItemId,
        });
      } else if (!complete.has(edge.toItemId)) {
        active.add(edge.toItemId);
        stack.push({
          id: edge.toItemId,
          edges: (adjacency.get(edge.toItemId) ?? [])[Symbol.iterator](),
        });
      }
    }
  }
  return issues;
}

/** Validate shape, references and declared dataflow compatibility without mutating inputs. */
export function validateGraphSnapshot(
  input: unknown,
): Result<GraphSnapshot, ValidationError | EntityReferenceError | GraphReferenceError> {
  const parsed = validate(GraphSnapshotSchema, input);
  if (!parsed.ok) return parsed;
  const snapshot = parsed.value;
  const entities = validateEntitySnapshot(snapshot.entities);
  if (!entities.ok) return entities;

  const issues: GraphReferenceIssue[] = [];
  const add = (
    code: GraphReferenceIssue["code"],
    collection: GraphReferenceIssue["collection"],
    id: Id,
    field: string,
    reference: string,
  ) => issues.push({ code, collection, id, field, reference });

  for (const collection of ["semanticRelations", "dataflowEdges", "visualConnectors"] as const) {
    const seen = new Set<Id>();
    for (const line of snapshot[collection]) {
      if (seen.has(line.id)) add("duplicate_id", collection, line.id, "id", line.id);
      seen.add(line.id);
    }
  }
  const registeredItems = new Set<Id>();
  for (const entry of snapshot.itemPorts) {
    if (registeredItems.has(entry.itemId))
      add("duplicate_id", "itemPorts", entry.itemId, "itemId", entry.itemId);
    registeredItems.add(entry.itemId);
    const seen = new Set<string>();
    for (const port of entry.ports) {
      if (seen.has(port.name))
        add("duplicate_port", "itemPorts", entry.itemId, "ports.name", port.name);
      seen.add(port.name);
    }
  }
  // Never resolve ambiguous identifiers by silently selecting a declaration.
  if (issues.length > 0) return err({ code: "graph_integrity_failed", issues });

  const artifacts = new Map(snapshot.entities.artifacts.map((artifact) => [artifact.id, artifact]));
  const boards = new Map(snapshot.entities.boards.map((board) => [board.id, board]));
  const items = new Map(snapshot.entities.canvasItems.map((item) => [item.id, item]));
  const ports = new Map<Id, ReadonlyMap<string, PortDefinition>>();
  for (const entry of snapshot.itemPorts) {
    if (!items.has(entry.itemId))
      add("missing_reference", "itemPorts", entry.itemId, "itemId", entry.itemId);
    ports.set(entry.itemId, new Map(entry.ports.map((port) => [port.name, port])));
  }
  for (const relation of snapshot.semanticRelations) {
    const from = artifacts.get(relation.fromArtifactId);
    const to = artifacts.get(relation.toArtifactId);
    if (!from)
      add(
        "missing_reference",
        "semanticRelations",
        relation.id,
        "fromArtifactId",
        relation.fromArtifactId,
      );
    if (!to)
      add(
        "missing_reference",
        "semanticRelations",
        relation.id,
        "toArtifactId",
        relation.toArtifactId,
      );
    if (from && to && from.projectId !== to.projectId)
      add("project_mismatch", "semanticRelations", relation.id, "toArtifactId", to.id);
  }
  const validEdges: DataflowEdge[] = [];
  const connectedInputs = new Map<Id, Set<string>>();
  for (const edge of snapshot.dataflowEdges) {
    const before = issues.length;
    const itemInputs = connectedInputs.get(edge.toItemId);
    if (itemInputs?.has(edge.toPort))
      add("duplicate_input_connection", "dataflowEdges", edge.id, "toPort", edge.toPort);
    if (itemInputs) itemInputs.add(edge.toPort);
    else connectedInputs.set(edge.toItemId, new Set([edge.toPort]));
    const from = items.get(edge.fromItemId);
    const to = items.get(edge.toItemId);
    if (!from) add("missing_reference", "dataflowEdges", edge.id, "fromItemId", edge.fromItemId);
    if (!to) add("missing_reference", "dataflowEdges", edge.id, "toItemId", edge.toItemId);
    if (from && to && from.boardId !== to.boardId)
      add("board_mismatch", "dataflowEdges", edge.id, "toItemId", to.id);
    const output = from ? ports.get(from.id)?.get(edge.fromPort) : undefined;
    const inputPort = to ? ports.get(to.id)?.get(edge.toPort) : undefined;
    if (from && !output) add("missing_port", "dataflowEdges", edge.id, "fromPort", edge.fromPort);
    if (to && !inputPort) add("missing_port", "dataflowEdges", edge.id, "toPort", edge.toPort);
    if (output && output.direction !== "output")
      add("port_direction_mismatch", "dataflowEdges", edge.id, "fromPort", edge.fromPort);
    if (inputPort && inputPort.direction !== "input")
      add("port_direction_mismatch", "dataflowEdges", edge.id, "toPort", edge.toPort);
    if (output && inputPort && !arePortTypesCompatible(output.type, inputPort.type))
      add("port_type_mismatch", "dataflowEdges", edge.id, "toPort", edge.toPort);
    if (issues.length === before) validEdges.push(edge);
  }
  for (const connector of snapshot.visualConnectors) {
    if (!boards.has(connector.boardId))
      add("missing_reference", "visualConnectors", connector.id, "boardId", connector.boardId);
    for (const field of ["source", "target"] as const) {
      const item = items.get(connector[field]);
      if (!item)
        add("missing_reference", "visualConnectors", connector.id, field, connector[field]);
      else if (item.boardId !== connector.boardId)
        add("board_mismatch", "visualConnectors", connector.id, field, item.id);
    }
  }
  for (const issue of findDataflowCycles(validEdges)) issues.push(issue);
  return issues.length > 0 ? err({ code: "graph_integrity_failed", issues }) : ok(snapshot);
}
