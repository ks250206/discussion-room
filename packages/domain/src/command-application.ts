import { M1CardContentSchema } from "./card-payloads.ts";
import {
  CommandSchema,
  DecisionContextSchema,
  EventSchema,
  type Command,
  type DecisionContext,
  type DomainState,
  type Event,
} from "./commands.ts";
import {
  equalContent,
  validateDomainState,
  type CommandError,
  type DomainError,
} from "./domain-state.ts";
import type { ArtifactRevision } from "./entities.ts";
import type { Id } from "./id.ts";
import { err, ok, type Result } from "./result.ts";
import { validate } from "./validation.ts";

/** Conservative E2 hook; E3 adds LWW/field merge policy without bypassing integrity checks. */
export function checkBaseVersion(
  current: { readonly id: Id; readonly version: number },
  baseVersion: number,
): Result<undefined, CommandError> {
  return current.version === baseVersion
    ? ok(undefined)
    : err({
        code: "version_conflict",
        message: "baseVersion does not match the current entity",
        id: current.id,
        currentVersion: current.version,
        baseVersion,
      });
}

function target<T extends { readonly id: Id; readonly version: number }>(
  rows: readonly T[],
  command: { readonly id: Id; readonly baseVersion: number },
): Result<T, CommandError> {
  const current = rows.find((row) => row.id === command.id);
  if (!current)
    return err({ code: "not_found", message: "Command target does not exist", id: command.id });
  const version = checkBaseVersion(current, command.baseVersion);
  return version.ok ? ok(current) : version;
}

function replace<T extends { readonly id: Id }>(
  rows: readonly T[],
  before: T | null,
  after: T | null,
): readonly T[] {
  if (before === null) return after === null ? rows : [...rows, after];
  return rows.flatMap((row) => (row.id === before.id ? (after === null ? [] : [after]) : [row]));
}

/** Replay an authoritative, already validated event in order. No validation, clocks or IO here. */
export function evolve(state: DomainState, event: Event): DomainState {
  switch (event.type) {
    case "project.changed":
      return {
        ...state,
        entities: {
          ...state.entities,
          projects: replace(state.entities.projects, event.before, event.after),
        },
      };
    case "board.changed":
      return {
        ...state,
        entities: {
          ...state.entities,
          boards: replace(state.entities.boards, event.before, event.after),
        },
      };
    case "artifact.changed": {
      const incoming = new Map(event.revisionsAfter.map((revision) => [revision.id, revision]));
      const previousIds = new Set(event.revisionsBefore.map((revision) => revision.id));
      const revisions = state.entities.revisions.flatMap((revision) => {
        if (!previousIds.has(revision.id)) return [revision];
        const next = incoming.get(revision.id);
        return next === undefined ? [] : [next];
      });
      revisions.push(...event.revisionsAfter.filter((revision) => !previousIds.has(revision.id)));
      return {
        ...state,
        entities: {
          ...state.entities,
          artifacts: replace(state.entities.artifacts, event.before, event.after),
          revisions,
        },
      };
    }
    case "canvasItem.changed": {
      const itemId = event.before?.id ?? event.after?.id;
      const ports = state.itemPorts.filter((declaration) => declaration.itemId !== itemId);
      // Preserve declaration ordering on updates; append only a newly declared item.
      const itemPorts =
        event.portsBefore === null
          ? event.portsAfter === null
            ? ports
            : [...ports, event.portsAfter]
          : state.itemPorts.flatMap((declaration) =>
              declaration.itemId === itemId
                ? event.portsAfter === null
                  ? []
                  : [event.portsAfter]
                : [declaration],
            );
      return {
        ...state,
        entities: {
          ...state.entities,
          canvasItems: replace(state.entities.canvasItems, event.before, event.after),
        },
        itemPorts,
      };
    }
    case "semanticRelation.changed":
      return {
        ...state,
        semanticRelations: replace(state.semanticRelations, event.before, event.after),
      };
    case "dataflowEdge.changed":
      return { ...state, dataflowEdges: replace(state.dataflowEdges, event.before, event.after) };
    case "visualConnector.changed":
      return {
        ...state,
        visualConnectors: replace(state.visualConnectors, event.before, event.after),
      };
  }
  return event;
}

function eventHeader(ctx: DecisionContext) {
  return {
    commandId: ctx.commandId,
    actor: ctx.actor,
    timestamp: ctx.timestamp,
    origin: ctx.origin,
    ...(ctx.aiApproval === undefined ? {} : { aiApproval: ctx.aiApproval }),
  };
}

function isApproved(ctx: DecisionContext): boolean {
  return ctx.aiApproval?.commandId === ctx.commandId && ctx.aiApproval.approvedBy === ctx.actor;
}

function buildEvents(
  state: DomainState,
  command: Command,
  ctx: DecisionContext,
): Result<readonly Event[], DomainError> {
  const header = eventHeader(ctx);
  const newId = ctx.entityId;
  const needsId = command.type.endsWith(".create");
  if (needsId && newId === undefined)
    return err({ code: "invalid_context", message: "Create requires an injected entityId" });
  if (ctx.aiApproval !== undefined && !isApproved(ctx))
    return err({
      code: "invalid_context",
      message: "Approval must identify this command and the acting approver",
    });
  const hasAIContent =
    (command.type === "artifact.create" || command.type === "artifact.update") &&
    command.content.payload.generatedBy === "ai";
  if ((ctx.origin === "ai" || hasAIContent) && !isApproved(ctx))
    return err({
      code: "ai_approval_required",
      message:
        "An authoritative approval decision is required before applying AI content or proposals",
    });
  if (ctx.origin === "ai") {
    if (command.type !== "artifact.create" && command.type !== "artifact.update")
      return err({
        code: "ai_origin_unsupported",
        message:
          "AI-origin structural operations require a persistent provenance contract before they can be applied",
      });
    if (command.content.payload.generatedBy !== "ai")
      return err({
        code: "ai_origin_changed",
        message: "AI-origin content must retain generatedBy ai and its complete AI provenance",
      });
  }
  const line = { id: newId, createdBy: ctx.actor, createdAt: ctx.timestamp, version: 1 };
  let events: readonly Event[];
  // A narrowed entityId is required only in the creation arms.
  switch (command.type) {
    case "project.create":
      if (newId === undefined) return err({ code: "invalid_context", message: "Missing entityId" });
      events = [
        {
          ...header,
          type: "project.changed",
          before: null,
          after: { ...command.value, id: newId, createdAt: ctx.timestamp, version: 1 },
        },
      ];
      break;
    case "project.update":
    case "project.delete": {
      const current = target(state.entities.projects, command);
      if (!current.ok) return current;
      events = [
        {
          ...header,
          type: "project.changed",
          before: current.value,
          after:
            command.type === "project.delete"
              ? null
              : { ...current.value, ...command.value, version: current.value.version + 1 },
        },
      ];
      break;
    }
    case "board.create":
      if (newId === undefined) return err({ code: "invalid_context", message: "Missing entityId" });
      events = [
        {
          ...header,
          type: "board.changed",
          before: null,
          after: { ...command.value, id: newId, version: 1 },
        },
      ];
      break;
    case "board.update":
    case "board.delete": {
      const current = target(state.entities.boards, command);
      if (!current.ok) return current;
      events = [
        {
          ...header,
          type: "board.changed",
          before: current.value,
          after:
            command.type === "board.delete"
              ? null
              : { ...current.value, ...command.value, version: current.value.version + 1 },
        },
      ];
      break;
    }
    case "artifact.create":
    case "artifact.update":
    case "artifact.delete": {
      const current =
        command.type === "artifact.create" ? ok(null) : target(state.entities.artifacts, command);
      if (!current.ok) return current;
      const before = current.value;
      const revisionsBefore = state.entities.revisions.filter(
        (revision) => revision.artifactId === before?.id,
      );
      if (command.type === "artifact.delete") {
        events = [
          {
            ...header,
            type: "artifact.changed",
            before,
            after: null,
            revisionsBefore,
            revisionsAfter: [],
          },
        ];
        break;
      }
      if (before !== null && before.kind !== command.content.kind)
        return err({
          code: "immutable_field",
          message: "Artifact kind cannot be changed by a content edit",
          id: before.id,
          field: "kind",
        });
      const artifactId = before?.id ?? newId;
      const revisionId = ctx.revisionId;
      if (artifactId === undefined || revisionId === undefined)
        return err({
          code: "invalid_context",
          message:
            "Content commands require an injected revisionId (and creation requires entityId)",
        });
      if (state.entities.revisions.some((revision) => revision.id === revisionId))
        return err({
          code: "id_conflict",
          message: "Revision IDs are immutable and cannot be reused",
          id: revisionId,
        });
      if (before !== null) {
        const previous = validate(M1CardContentSchema, {
          kind: before.kind,
          payload: before.payload,
        });
        if (!previous.ok) return previous;
        if (
          previous.value.payload.generatedBy === "ai" &&
          (command.content.payload.generatedBy !== "ai" ||
            !equalContent(previous.value.payload.provenance, command.content.payload.provenance))
        )
          return err({
            code: "ai_origin_changed",
            message: "Preserve the AI generation record when editing approved content",
            id: artifactId,
          });
      }
      const revision: ArtifactRevision = {
        id: revisionId,
        artifactId,
        ...(before === null ? {} : { parentId: before.revisionId }),
        payload: command.content.payload,
        author: ctx.actor,
        createdAt: ctx.timestamp,
        version: 1,
      };
      const projectId = command.type === "artifact.create" ? command.projectId : before?.projectId;
      if (projectId === undefined)
        return err({ code: "not_found", message: "Artifact project is absent", id: artifactId });
      events = [
        {
          ...header,
          type: "artifact.changed",
          before,
          after: {
            id: artifactId,
            projectId,
            ...command.content,
            revisionId,
            version: (before?.version ?? 0) + 1,
          },
          revisionsBefore,
          revisionsAfter: [...revisionsBefore, revision],
        },
      ];
      break;
    }
    case "canvasItem.create":
      if (newId === undefined) return err({ code: "invalid_context", message: "Missing entityId" });
      events = [
        {
          ...header,
          type: "canvasItem.changed",
          before: null,
          after: { ...command.value, id: newId, version: 1 },
          portsBefore: null,
          portsAfter: { itemId: newId, ports: command.ports },
        },
      ];
      break;
    case "canvasItem.update":
    case "canvasItem.delete": {
      const current = target(state.entities.canvasItems, command);
      if (!current.ok) return current;
      const before = current.value;
      const itemEvent: Event = {
        ...header,
        type: "canvasItem.changed",
        before,
        after:
          command.type === "canvasItem.delete"
            ? null
            : { ...before, ...command.value, version: before.version + 1 },
        portsBefore:
          state.itemPorts.find((declaration) => declaration.itemId === before.id) ?? null,
        portsAfter:
          command.type === "canvasItem.delete" ? null : { itemId: before.id, ports: command.ports },
      };
      events =
        command.type === "canvasItem.update"
          ? [itemEvent]
          : [
              ...state.dataflowEdges
                .filter((edge) => edge.fromItemId === before.id || edge.toItemId === before.id)
                .map((edge): Event => ({
                  ...header,
                  type: "dataflowEdge.changed",
                  before: edge,
                  after: null,
                })),
              ...state.visualConnectors
                .filter((edge) => edge.source === before.id || edge.target === before.id)
                .map((edge): Event => ({
                  ...header,
                  type: "visualConnector.changed",
                  before: edge,
                  after: null,
                })),
              itemEvent,
            ];
      break;
    }
    case "semanticRelation.create":
      if (newId === undefined) return err({ code: "invalid_context", message: "Missing entityId" });
      events = [
        {
          ...header,
          type: "semanticRelation.changed",
          before: null,
          after: { ...command.value, ...line, id: newId, type: "semantic-relation" },
        },
      ];
      break;
    case "semanticRelation.update":
    case "semanticRelation.delete": {
      const current = target(state.semanticRelations, command);
      if (!current.ok) return current;
      events = [
        {
          ...header,
          type: "semanticRelation.changed",
          before: current.value,
          after:
            command.type === "semanticRelation.delete"
              ? null
              : { ...current.value, ...command.value, version: current.value.version + 1 },
        },
      ];
      break;
    }
    case "dataflowEdge.create":
      if (newId === undefined) return err({ code: "invalid_context", message: "Missing entityId" });
      events = [
        {
          ...header,
          type: "dataflowEdge.changed",
          before: null,
          after: { ...command.value, ...line, id: newId, type: "dataflow-edge" },
        },
      ];
      break;
    case "dataflowEdge.update":
    case "dataflowEdge.delete": {
      const current = target(state.dataflowEdges, command);
      if (!current.ok) return current;
      events = [
        {
          ...header,
          type: "dataflowEdge.changed",
          before: current.value,
          after:
            command.type === "dataflowEdge.delete"
              ? null
              : { ...current.value, ...command.value, version: current.value.version + 1 },
        },
      ];
      break;
    }
    case "visualConnector.create":
      if (newId === undefined) return err({ code: "invalid_context", message: "Missing entityId" });
      events = [
        {
          ...header,
          type: "visualConnector.changed",
          before: null,
          after: { ...command.value, ...line, id: newId, type: "visual-connector" },
        },
      ];
      break;
    case "visualConnector.update":
    case "visualConnector.delete": {
      const current = target(state.visualConnectors, command);
      if (!current.ok) return current;
      events = [
        {
          ...header,
          type: "visualConnector.changed",
          before: current.value,
          after:
            command.type === "visualConnector.delete"
              ? null
              : { ...current.value, ...command.value, version: current.value.version + 1 },
        },
      ];
      break;
    }
  }
  return ok(events);
}

/** Validate all boundary inputs, decide atomically, and return only authoritative replayable events. */
export function decide(
  input: unknown,
  commandInput: unknown,
  contextInput: unknown,
): Result<readonly Event[], DomainError> {
  const state = validateDomainState(input);
  if (!state.ok) return state;
  const command = validate(CommandSchema, commandInput);
  if (!command.ok) return command;
  const ctx = validate(DecisionContextSchema, contextInput);
  if (!ctx.ok) return ctx;
  const decision = buildEvents(state.value, command.value, ctx.value);
  if (!decision.ok) return decision;
  let next = state.value;
  for (const event of decision.value) {
    const parsed = validate(EventSchema, event);
    if (!parsed.ok) return parsed;
    next = evolve(next, parsed.value);
  }
  const valid = validateDomainState(next);
  return valid.ok ? decision : valid;
}
