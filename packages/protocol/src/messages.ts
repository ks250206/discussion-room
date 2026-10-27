import * as v from "valibot";
import {
  CommandSchema,
  DomainStateSchema,
  EntityVersionSchema,
  EventSchema,
  IdSchema,
} from "@discussion-room/domain";
import { PROTOCOL_LIMITS } from "./json.ts";

export const PROTOCOL_VERSION = 1;
export const ProtocolVersionSchema = v.literal(PROTOCOL_VERSION);
export const SequenceSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const committedSequenceSchema = v.pipe(SequenceSchema, v.minValue(1));
const nonBlank = v.pipe(
  v.string(),
  v.check((s) => s.trim().length > 0),
);
const displayNameSchema = v.pipe(nonBlank, v.maxLength(PROTOCOL_LIMITS.maxDisplayNameLength));
const identifierSchema = v.pipe(nonBlank, v.maxLength(200));
const finite = v.pipe(v.number(), v.finite());

export const MemberSchema = v.pipe(
  v.strictObject({
    clientId: identifierSchema,
    displayName: displayNameSchema,
  }),
  v.readonly(),
);
export type Member = v.InferOutput<typeof MemberSchema>;
export const PresenceSchema = v.pipe(
  v.strictObject({
    boardId: IdSchema,
    cursor: v.exactOptional(v.pipe(v.strictObject({ x: finite, y: finite }), v.readonly())),
    selection: v.pipe(v.array(IdSchema), v.maxLength(PROTOCOL_LIMITS.maxSelection), v.readonly()),
    editingItemId: v.exactOptional(IdSchema),
  }),
  v.readonly(),
);
export type Presence = v.InferOutput<typeof PresenceSchema>;
export const HelloMessageSchema = v.pipe(
  v.strictObject({
    type: v.literal("hello"),
    protocolVersion: ProtocolVersionSchema,
    clientId: identifierSchema,
    displayName: displayNameSchema,
    token: v.exactOptional(v.pipe(nonBlank, v.maxLength(PROTOCOL_LIMITS.maxTokenLength))),
  }),
  v.readonly(),
);
export const JoinMessageSchema = v.pipe(
  v.strictObject({
    type: v.literal("join"),
    projectId: IdSchema,
    lastSeq: v.exactOptional(SequenceSchema),
  }),
  v.readonly(),
);
export const CommandMessageSchema = v.pipe(
  v.strictObject({
    type: v.literal("command"),
    commandId: IdSchema,
    projectId: IdSchema,
    command: CommandSchema,
  }),
  v.readonly(),
);
export const AckMessageSchema = v.pipe(
  v.strictObject({
    type: v.literal("ack"),
    commandId: IdSchema,
    seq: committedSequenceSchema,
  }),
  v.readonly(),
);
export const REJECT_CODES = [
  "validation_failed",
  "reference_integrity_failed",
  "graph_integrity_failed",
  "chronology_undetermined",
  "not_found",
  "version_conflict",
  "id_conflict",
  "invalid_context",
  "content_integrity_failed",
  "payload_reference_failed",
  "ai_approval_required",
  "ai_origin_changed",
  "ai_origin_unsupported",
  "registration_invalid",
  "immutable_field",
  "not_joined",
  "project_mismatch",
  "forbidden",
  "rate_limited",
  "internal_error",
] as const;
export const RejectCodeSchema = v.picklist(REJECT_CODES);
export type RejectCode = v.InferOutput<typeof RejectCodeSchema>;
export const RejectMessageSchema = v.pipe(
  v.strictObject({
    type: v.literal("reject"),
    commandId: IdSchema,
    code: RejectCodeSchema,
    message: v.pipe(nonBlank, v.maxLength(PROTOCOL_LIMITS.maxErrorMessageLength)),
    current: v.exactOptional(
      v.pipe(v.strictObject({ version: EntityVersionSchema }), v.readonly()),
    ),
  }),
  v.readonly(),
);
export const EventMessageSchema = v.pipe(
  v.strictObject({
    type: v.literal("event"),
    seq: committedSequenceSchema,
    projectId: IdSchema,
    actor: nonBlank,
    commandId: IdSchema,
    events: v.pipe(
      v.array(EventSchema),
      v.minLength(1),
      v.maxLength(PROTOCOL_LIMITS.maxEventsPerBatch),
      v.readonly(),
    ),
  }),
  v.check((batch) =>
    batch.events.every(
      (event) => event.actor === batch.actor && event.commandId === batch.commandId,
    ),
  ),
  v.readonly(),
);
export type EventMessage = v.InferOutput<typeof EventMessageSchema>;
const joinedEntries = {
  type: v.literal("joined"),
  projectId: IdSchema,
  seq: SequenceSchema,
  members: v.pipe(
    v.array(MemberSchema),
    v.maxLength(PROTOCOL_LIMITS.maxMembers),
    v.check((members) => new Set(members.map((member) => member.clientId)).size === members.length),
    v.readonly(),
  ),
} as const;
export const JoinedMessageSchema = v.pipe(
  v.variant("mode", [
    v.strictObject({ ...joinedEntries, mode: v.literal("snapshot"), snapshot: DomainStateSchema }),
    v.strictObject({
      ...joinedEntries,
      mode: v.literal("events"),
      fromSeq: SequenceSchema,
      events: v.pipe(
        v.array(EventMessageSchema),
        v.maxLength(PROTOCOL_LIMITS.maxResumeBatches),
        v.readonly(),
      ),
    }),
  ]),
  v.check(
    (message) =>
      message.mode === "snapshot" ||
      (message.seq === message.fromSeq + message.events.length &&
        message.events.every(
          (batch, index) =>
            batch.projectId === message.projectId && batch.seq === message.fromSeq + index + 1,
        )),
  ),
  v.readonly(),
);
export type JoinedMessage = v.InferOutput<typeof JoinedMessageSchema>;
export const ClientPresenceMessageSchema = v.pipe(
  v.strictObject({
    type: v.literal("presence"),
    projectId: IdSchema,
    presence: PresenceSchema,
  }),
  v.readonly(),
);
export const ServerPresenceMessageSchema = v.pipe(
  v.strictObject({
    type: v.literal("presence"),
    projectId: IdSchema,
    clientId: identifierSchema,
    presence: PresenceSchema,
  }),
  v.readonly(),
);
export const MemberMessageSchema = v.pipe(
  v.strictObject({
    type: v.literal("member"),
    projectId: IdSchema,
    action: v.picklist(["joined", "left"]),
    member: MemberSchema,
  }),
  v.readonly(),
);
export const PingMessageSchema = v.pipe(
  v.strictObject({
    type: v.literal("ping"),
    nonce: identifierSchema,
  }),
  v.readonly(),
);
export const PongMessageSchema = v.pipe(
  v.strictObject({
    type: v.literal("pong"),
    nonce: identifierSchema,
  }),
  v.readonly(),
);
export const ClientMessageSchema = v.pipe(
  v.variant("type", [
    HelloMessageSchema,
    JoinMessageSchema,
    CommandMessageSchema,
    ClientPresenceMessageSchema,
    PingMessageSchema,
    PongMessageSchema,
  ]),
  v.readonly(),
);
// A union preserves the check on the nested joined mode variant. Valibot 1.5 outer
// variants otherwise skip that nested variant pipeline; resume tests guard this boundary.
export const ServerMessageSchema = v.pipe(
  v.union([
    JoinedMessageSchema,
    AckMessageSchema,
    RejectMessageSchema,
    EventMessageSchema,
    ServerPresenceMessageSchema,
    MemberMessageSchema,
    PingMessageSchema,
    PongMessageSchema,
  ]),
  v.readonly(),
);
export type ClientMessage = v.InferOutput<typeof ClientMessageSchema>;
export type ServerMessage = v.InferOutput<typeof ServerMessageSchema>;

export type HelloMessage = v.InferOutput<typeof HelloMessageSchema>;
export type JoinMessage = v.InferOutput<typeof JoinMessageSchema>;
export type CommandMessage = v.InferOutput<typeof CommandMessageSchema>;
export type AckMessage = v.InferOutput<typeof AckMessageSchema>;
export type RejectMessage = v.InferOutput<typeof RejectMessageSchema>;
export type ClientPresenceMessage = v.InferOutput<typeof ClientPresenceMessageSchema>;
export type ServerPresenceMessage = v.InferOutput<typeof ServerPresenceMessageSchema>;
export type MemberMessage = v.InferOutput<typeof MemberMessageSchema>;
export type PingMessage = v.InferOutput<typeof PingMessageSchema>;
export type PongMessage = v.InferOutput<typeof PongMessageSchema>;
