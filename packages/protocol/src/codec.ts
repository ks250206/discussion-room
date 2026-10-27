import * as v from "valibot";
import {
  err,
  ok,
  validateArtifactContent,
  validateCardContent,
  validateKnownM1State,
  validateRevisionContent,
  type DomainState,
  type Event,
  type Result,
} from "@discussion-room/domain";
import { snapshotJson, parseJson, type BoundaryError } from "./json.ts";
import {
  ClientMessageSchema,
  ServerMessageSchema,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
  type EventMessage,
} from "./messages.ts";

export type ProtocolError =
  | BoundaryError
  | { readonly code: "invalid_message" }
  | {
      readonly code: "protocol_version_mismatch";
      readonly expected: typeof PROTOCOL_VERSION;
      readonly received: number;
    };
/** Fixed codes contain no input values, token, opaque payload or Valibot issue dumps. */
export const PROTOCOL_ERROR_CODES = [
  "json_unsafe",
  "message_too_large",
  "complexity_limit",
  "invalid_json",
  "invalid_utf8",
  "invalid_message",
  "protocol_version_mismatch",
] as const;

function validSnapshot(state: DomainState, projectId: string): boolean {
  if (state.entities.projects.length !== 1 || state.entities.projects[0]?.id !== projectId)
    return false;
  if (
    state.entities.boards.some((b) => b.projectId !== projectId) ||
    state.entities.artifacts.some((a) => a.projectId !== projectId)
  )
    return false;
  // Preserve future content without weakening cache, references or transitions on known M1 data.
  return validateKnownM1State(state).ok;
}
function validEvent(event: Event, projectId: string): boolean {
  switch (event.type) {
    case "project.changed":
      return [event.before, event.after].every((value) => value === null || value.id === projectId);
    case "board.changed":
      return [event.before, event.after].every(
        (value) => value === null || value.projectId === projectId,
      );
    case "artifact.changed": {
      const validSide = (
        artifact: typeof event.before,
        revisions: typeof event.revisionsBefore,
      ) => {
        if (artifact === null) return revisions.length === 0;
        return (
          artifact.projectId === projectId &&
          validateArtifactContent(artifact).ok &&
          revisions.every(
            (revision) =>
              revision.artifactId === artifact.id &&
              validateRevisionContent(artifact.kind, revision).ok,
          )
        );
      };
      return (
        validSide(event.before, event.revisionsBefore) &&
        validSide(event.after, event.revisionsAfter)
      );
    }
    case "canvasItem.changed":
    case "semanticRelation.changed":
    case "dataflowEdge.changed":
    case "visualConnector.changed":
      return true;
  }
  return false;
}
function validBatch(batch: EventMessage): boolean {
  return batch.events.every((event) => validEvent(event, batch.projectId));
}
function validContent(message: ClientMessage | ServerMessage): boolean {
  switch (message.type) {
    case "joined":
      return message.mode === "snapshot"
        ? validSnapshot(message.snapshot, message.projectId)
        : message.events.every(validBatch);
    case "event":
      return validBatch(message);
    case "command": {
      const command = message.command;
      if (command.type === "artifact.create")
        return command.projectId === message.projectId && validateCardContent(command.content).ok;
      if (command.type === "board.create") return command.value.projectId === message.projectId;
      if (command.type === "project.update" || command.type === "project.delete")
        return command.id === message.projectId;
      return true;
    }
    case "hello":
    case "join":
    case "ack":
    case "reject":
    case "presence":
    case "member":
    case "ping":
    case "pong":
      return true;
  }
  return false;
}
function validateMessage<T extends typeof ClientMessageSchema | typeof ServerMessageSchema>(
  schema: T,
  input: unknown,
): Result<v.InferOutput<T>, ProtocolError> {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return snapshot;
  const value = snapshot.value;
  if (
    schema === ClientMessageSchema &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "type" in value &&
    value.type === "hello" &&
    "protocolVersion" in value &&
    typeof value.protocolVersion === "number" &&
    Number.isSafeInteger(value.protocolVersion) &&
    value.protocolVersion !== PROTOCOL_VERSION
  )
    return err({
      code: "protocol_version_mismatch",
      expected: PROTOCOL_VERSION,
      received: value.protocolVersion,
    });
  const result = v.safeParse(schema, value);
  if (!result.success || !validContent(result.output)) return err({ code: "invalid_message" });
  return ok(result.output);
}
export function validateClientMessage(input: unknown): Result<ClientMessage, ProtocolError> {
  return validateMessage(ClientMessageSchema, input);
}
export function validateServerMessage(input: unknown): Result<ServerMessage, ProtocolError> {
  return validateMessage(ServerMessageSchema, input);
}
export function encodeClientMessage(input: unknown): Result<string, ProtocolError> {
  const valid = validateClientMessage(input);
  return valid.ok ? ok(JSON.stringify(valid.value)) : valid;
}
export function encodeServerMessage(input: unknown): Result<string, ProtocolError> {
  const valid = validateServerMessage(input);
  return valid.ok ? ok(JSON.stringify(valid.value)) : valid;
}
export function decodeClientMessage(
  input: string | Uint8Array,
): Result<ClientMessage, ProtocolError> {
  const parsed = parseJson(input);
  return parsed.ok ? validateClientMessage(parsed.value) : parsed;
}
export function decodeServerMessage(
  input: string | Uint8Array,
): Result<ServerMessage, ProtocolError> {
  const parsed = parseJson(input);
  return parsed.ok ? validateServerMessage(parsed.value) : parsed;
}
