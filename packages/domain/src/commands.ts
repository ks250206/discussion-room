import * as v from "valibot";
import { M1CardContentSchema } from "./card-payloads.ts";
import {
  ArtifactSchema,
  ArtifactRevisionSchema,
  BoardSchema,
  CanvasItemSchema,
  EntityVersionSchema,
  ProjectSchema,
} from "./entities.ts";
import {
  DataflowEdgeSchema,
  GraphSnapshotSchema,
  ItemPortsSchema,
  SemanticRelationSchema,
  VisualConnectorSchema,
} from "./graphs.ts";
import { IdSchema } from "./id.ts";
import { TimestampSchema } from "./timestamp.ts";

// Reuse the entity entries, applying omit before adding a readonly pipeline.
const projectValue = v.pipe(
  v.omit(v.strictObject(ProjectSchema.entries), ["id", "createdAt", "version"]),
  v.readonly(),
);
const boardCreateValue = v.pipe(
  v.omit(v.strictObject(BoardSchema.entries), ["id", "version"]),
  v.readonly(),
);
const boardValue = v.pipe(
  v.omit(v.strictObject(BoardSchema.entries), ["id", "projectId", "version"]),
  v.readonly(),
);
const canvasCreateValue = v.pipe(
  v.omit(v.strictObject(CanvasItemSchema.entries), ["id", "version"]),
  v.readonly(),
);
const canvasValue = v.pipe(
  v.omit(v.strictObject(CanvasItemSchema.entries), ["id", "boardId", "artifactId", "version"]),
  v.readonly(),
);
const semanticValue = v.pipe(
  v.omit(v.strictObject(SemanticRelationSchema.entries), [
    "id",
    "type",
    "createdBy",
    "createdAt",
    "version",
  ]),
  v.readonly(),
);
const dataflowValue = v.pipe(
  v.omit(v.strictObject(DataflowEdgeSchema.entries), [
    "id",
    "type",
    "createdBy",
    "createdAt",
    "version",
  ]),
  v.readonly(),
);
const visualCreateValue = v.pipe(
  v.omit(v.strictObject(VisualConnectorSchema.entries), [
    "id",
    "type",
    "createdBy",
    "createdAt",
    "version",
  ]),
  v.readonly(),
);
const visualValue = v.pipe(
  v.omit(v.strictObject(VisualConnectorSchema.entries), [
    "id",
    "type",
    "createdBy",
    "createdAt",
    "version",
    "boardId",
  ]),
  v.readonly(),
);
const portsSchema = v.pipe(v.array(ItemPortsSchema.entries.ports.item), v.readonly());
const targetEntries = { id: IdSchema, baseVersion: EntityVersionSchema } as const;

/** Replacement values are complete; omitted optional metadata is retained on update. */
export const CommandSchema = v.pipe(
  v.variant("type", [
    v.strictObject({ type: v.literal("project.create"), value: projectValue }),
    v.strictObject({ type: v.literal("project.update"), ...targetEntries, value: projectValue }),
    v.strictObject({ type: v.literal("project.delete"), ...targetEntries }),
    v.strictObject({ type: v.literal("board.create"), value: boardCreateValue }),
    v.strictObject({ type: v.literal("board.update"), ...targetEntries, value: boardValue }),
    v.strictObject({ type: v.literal("board.delete"), ...targetEntries }),
    v.strictObject({
      type: v.literal("artifact.create"),
      projectId: IdSchema,
      content: M1CardContentSchema,
    }),
    v.strictObject({
      type: v.literal("artifact.update"),
      ...targetEntries,
      content: M1CardContentSchema,
    }),
    v.strictObject({ type: v.literal("artifact.delete"), ...targetEntries }),
    v.strictObject({
      type: v.literal("canvasItem.create"),
      value: canvasCreateValue,
      ports: portsSchema,
    }),
    v.strictObject({
      type: v.literal("canvasItem.update"),
      ...targetEntries,
      value: canvasValue,
      ports: portsSchema,
    }),
    v.strictObject({ type: v.literal("canvasItem.delete"), ...targetEntries }),
    v.strictObject({ type: v.literal("semanticRelation.create"), value: semanticValue }),
    v.strictObject({
      type: v.literal("semanticRelation.update"),
      ...targetEntries,
      value: semanticValue,
    }),
    v.strictObject({ type: v.literal("semanticRelation.delete"), ...targetEntries }),
    v.strictObject({ type: v.literal("dataflowEdge.create"), value: dataflowValue }),
    v.strictObject({
      type: v.literal("dataflowEdge.update"),
      ...targetEntries,
      value: dataflowValue,
    }),
    v.strictObject({ type: v.literal("dataflowEdge.delete"), ...targetEntries }),
    v.strictObject({ type: v.literal("visualConnector.create"), value: visualCreateValue }),
    v.strictObject({
      type: v.literal("visualConnector.update"),
      ...targetEntries,
      value: visualValue,
    }),
    v.strictObject({ type: v.literal("visualConnector.delete"), ...targetEntries }),
  ]),
  v.readonly(),
);
export type Command = v.InferOutput<typeof CommandSchema>;

const actorSchema = ArtifactRevisionSchema.entries.author;
const approvalSchema = v.pipe(
  v.strictObject({ commandId: IdSchema, approvedBy: actorSchema }),
  v.readonly(),
);
/** Trusted authority input, separate from the untrusted command. No generators or clocks. */
export const DecisionContextSchema = v.pipe(
  v.strictObject({
    commandId: IdSchema,
    actor: actorSchema,
    timestamp: TimestampSchema,
    origin: v.picklist(["human", "ai"]),
    entityId: v.exactOptional(IdSchema),
    revisionId: v.exactOptional(IdSchema),
    aiApproval: v.exactOptional(approvalSchema),
  }),
  v.readonly(),
);
export type DecisionContext = v.InferOutput<typeof DecisionContextSchema>;

const eventEntries = {
  commandId: IdSchema,
  actor: actorSchema,
  timestamp: TimestampSchema,
  origin: DecisionContextSchema.entries.origin,
  aiApproval: v.exactOptional(approvalSchema),
} as const;
const revisionsSchema = v.pipe(v.array(ArtifactRevisionSchema), v.readonly());
/** Full previous entities and revision/port values support a later inverse-command layer. */
export const EventSchema = v.pipe(
  v.variant("type", [
    v.strictObject({
      type: v.literal("project.changed"),
      ...eventEntries,
      before: v.nullable(ProjectSchema),
      after: v.nullable(ProjectSchema),
    }),
    v.strictObject({
      type: v.literal("board.changed"),
      ...eventEntries,
      before: v.nullable(BoardSchema),
      after: v.nullable(BoardSchema),
    }),
    v.strictObject({
      type: v.literal("artifact.changed"),
      ...eventEntries,
      before: v.nullable(ArtifactSchema),
      after: v.nullable(ArtifactSchema),
      revisionsBefore: revisionsSchema,
      revisionsAfter: revisionsSchema,
    }),
    v.strictObject({
      type: v.literal("canvasItem.changed"),
      ...eventEntries,
      before: v.nullable(CanvasItemSchema),
      after: v.nullable(CanvasItemSchema),
      portsBefore: v.nullable(ItemPortsSchema),
      portsAfter: v.nullable(ItemPortsSchema),
    }),
    v.strictObject({
      type: v.literal("semanticRelation.changed"),
      ...eventEntries,
      before: v.nullable(SemanticRelationSchema),
      after: v.nullable(SemanticRelationSchema),
    }),
    v.strictObject({
      type: v.literal("dataflowEdge.changed"),
      ...eventEntries,
      before: v.nullable(DataflowEdgeSchema),
      after: v.nullable(DataflowEdgeSchema),
    }),
    v.strictObject({
      type: v.literal("visualConnector.changed"),
      ...eventEntries,
      before: v.nullable(VisualConnectorSchema),
      after: v.nullable(VisualConnectorSchema),
    }),
  ]),
  v.readonly(),
);
export type Event = v.InferOutput<typeof EventSchema>;
export const DomainStateSchema = GraphSnapshotSchema;
export type DomainState = v.InferOutput<typeof DomainStateSchema>;
