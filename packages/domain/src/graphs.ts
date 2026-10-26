import * as v from "valibot";
import { EntitySnapshotSchema, EntityVersionSchema, OpaqueObjectSchema } from "./entities.ts";
import { IdSchema } from "./id.ts";
import { TimestampSchema } from "./timestamp.ts";

const nonBlankStringSchema = v.pipe(
  v.string(),
  v.check((input) => input.trim().length > 0, "Expected a non-blank string"),
);

export const SemanticRelationTypeSchema = v.picklist([
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
]);
export type SemanticRelationType = v.InferOutput<typeof SemanticRelationTypeSchema>;

export const PortDataTypeSchema = v.picklist([
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
]);
export type PortDataType = v.InferOutput<typeof PortDataTypeSchema>;

export const PortDirectionSchema = v.picklist(["input", "output"]);
export type PortDirection = v.InferOutput<typeof PortDirectionSchema>;

/** Port declarations describe compatibility, never implicitly convert values or units. */
export const PortDefinitionSchema = v.pipe(
  v.strictObject({
    name: nonBlankStringSchema,
    direction: PortDirectionSchema,
    type: PortDataTypeSchema,
    metadata: v.exactOptional(OpaqueObjectSchema),
  }),
  v.readonly(),
);
export type PortDefinition = v.InferOutput<typeof PortDefinitionSchema>;

/** An explicit adapter boundary, independent of Artifact kind/payload implementations. */
export const ItemPortsSchema = v.pipe(
  v.strictObject({
    itemId: IdSchema,
    ports: v.pipe(v.array(PortDefinitionSchema), v.readonly()),
  }),
  v.readonly(),
);
export type ItemPorts = v.InferOutput<typeof ItemPortsSchema>;

const lineMetadataEntries = {
  id: IdSchema,
  createdBy: nonBlankStringSchema,
  createdAt: TimestampSchema,
  version: EntityVersionSchema,
  metadata: v.exactOptional(OpaqueObjectSchema),
} as const;

export const SemanticRelationSchema = v.pipe(
  v.strictObject({
    ...lineMetadataEntries,
    type: v.literal("semantic-relation"),
    fromArtifactId: IdSchema,
    toArtifactId: IdSchema,
    relation: SemanticRelationTypeSchema,
    rationale: v.string(),
  }),
  v.readonly(),
);
export type SemanticRelation = v.InferOutput<typeof SemanticRelationSchema>;

export const DataflowEdgeSchema = v.pipe(
  v.strictObject({
    ...lineMetadataEntries,
    type: v.literal("dataflow-edge"),
    fromItemId: IdSchema,
    fromPort: nonBlankStringSchema,
    toItemId: IdSchema,
    toPort: nonBlankStringSchema,
    description: v.string(),
  }),
  v.readonly(),
);
export type DataflowEdge = v.InferOutput<typeof DataflowEdgeSchema>;

/** Display-only endpoints. Never infer a scientific relation from style or geometry. */
export const VisualConnectorSchema = v.pipe(
  v.strictObject({
    ...lineMetadataEntries,
    type: v.literal("visual-connector"),
    boardId: IdSchema,
    source: IdSchema,
    target: IdSchema,
    style: OpaqueObjectSchema,
    description: v.string(),
  }),
  v.readonly(),
);
export type VisualConnector = v.InferOutput<typeof VisualConnectorSchema>;

/** In-memory validation context, not a persisted file or a permission to save AI output. */
export const GraphSnapshotSchema = v.pipe(
  v.strictObject({
    entities: EntitySnapshotSchema,
    itemPorts: v.pipe(v.array(ItemPortsSchema), v.readonly()),
    semanticRelations: v.pipe(v.array(SemanticRelationSchema), v.readonly()),
    dataflowEdges: v.pipe(v.array(DataflowEdgeSchema), v.readonly()),
    visualConnectors: v.pipe(v.array(VisualConnectorSchema), v.readonly()),
  }),
  v.readonly(),
);
export type GraphSnapshot = v.InferOutput<typeof GraphSnapshotSchema>;

/** Exact declared type equality only. JSON is not a wildcard. */
export function arePortTypesCompatible(output: PortDataType, input: PortDataType): boolean {
  return output === input;
}
