import { PredictionRegistrationSchema } from "./card-payloads.ts";
import type { Command, Event } from "./commands.ts";
import { equalContent } from "./domain-state.ts";
import type { CommandError, ConflictCurrent } from "./domain-state.ts";
import { err, ok, type Result } from "./result.ts";
import { validate } from "./validation.ts";

type Update = Extract<Command, { type: `${string}.update` }>;
type Fields = Readonly<Record<string, unknown>>;
type Versioned = NonNullable<Event["after"]>;

function isUpdate(command: Command): command is Update {
  return command.type.endsWith(".update");
}

function fields(entity: Versioned, ports: ConflictCurrent["ports"]): Fields {
  if ("payload" in entity) return entity.payload;
  return ports === undefined ? entity : { ...entity, ports: ports.ports };
}

function proposedFields(command: Update): Fields {
  if (command.type === "artifact.update") return command.content.payload;
  if (command.type === "canvasItem.update") return { ...command.value, ports: command.ports };
  return command.value;
}

function isGeometryField(command: Update, field: string): boolean {
  return (
    command.type === "canvasItem.update" &&
    (field === "x" || field === "y" || field === "width" || field === "height")
  );
}

/**
 * Reconstruct the base from a trusted committed history suffix, then infer the fields the
 * replacement actually edits. Return a replacement at the current version for normal validation.
 */
export function rebaseUpdate(
  command: Command,
  failure: CommandError,
  history: readonly Event[],
): Result<unknown, CommandError> {
  const current = failure.current;
  if (!isUpdate(command) || current === undefined || command.baseVersion >= current.entity.version)
    return err(failure);
  const kind = command.type.split(".")[0];
  const intervening: Fields[] = [];
  let entity = current.entity;
  let ports = current.ports;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const event = history[index];
    if (event?.type !== `${kind}.changed` || (event.after?.id ?? event.before?.id) !== command.id)
      continue;
    if (event.before === null || event.after === null) return err(failure);
    const afterPorts =
      event.type === "canvasItem.changed" ? (event.portsAfter ?? undefined) : undefined;
    if (
      event.before.id !== command.id ||
      event.before.version !== entity.version - 1 ||
      !equalContent(event.after, entity) ||
      !equalContent(afterPorts, ports)
    )
      return err(failure);
    intervening.push(fields(entity, ports));
    entity = event.before;
    ports = event.type === "canvasItem.changed" ? (event.portsBefore ?? undefined) : undefined;
    if (entity.version === command.baseVersion) break;
  }
  if (entity.version !== command.baseVersion) return err(failure);

  const desired = proposedFields(command);
  const base = fields(entity, ports);
  const latest = fields(current.entity, current.ports);
  const keys = new Set(Object.keys(desired));
  if (command.type === "artifact.update") {
    if (
      !("kind" in entity) ||
      entity.kind !== command.content.kind ||
      desired.generatedBy === "ai" ||
      [base, ...intervening].some((payload) => payload.generatedBy === "ai")
    )
      return err(failure);
    // A registration asserts the exact prediction content present at the moment of registration.
    if (
      command.content.kind === "prediction" &&
      command.content.payload.registration.status === "registered" &&
      intervening.some((payload) => !equalContent(payload, base))
    )
      return err(failure);
    for (const key of Object.keys(base)) keys.add(key);
    for (const key of Object.keys(latest)) keys.add(key);
  }
  const replacement = new Map<string, unknown>();
  for (const key of keys) {
    const specified = Object.hasOwn(desired, key);
    const edited =
      (specified || command.type === "artifact.update") && !equalContent(desired[key], base[key]);
    if (edited && !isGeometryField(command, key)) {
      let previous = base[key];
      for (let index = intervening.length - 1; index >= 0; index -= 1) {
        const next = intervening[index]?.[key];
        if (!equalContent(previous, next)) return err({ ...failure, field: key });
        previous = next;
      }
    }
    const source = edited ? desired : latest;
    if (Object.hasOwn(source, key)) replacement.set(key, source[key]);
  }

  const baseVersion = current.entity.version;
  const merged = Object.fromEntries(replacement);
  if (command.type === "artifact.update") {
    if (command.content.kind === "prediction") {
      const registration = validate(PredictionRegistrationSchema, latest.registration);
      if (
        registration.ok &&
        registration.value.status === "registered" &&
        !equalContent(latest.registration, desired.registration) &&
        equalContent(merged.registration, latest.registration) &&
        !equalContent(merged, latest)
      )
        return err({ ...failure, field: "registration" });
    }
    return ok({ ...command, baseVersion, content: { ...command.content, payload: merged } });
  }
  if (command.type === "canvasItem.update") {
    const { ports: mergedPorts, ...value } = merged;
    return ok({ ...command, baseVersion, value, ports: mergedPorts });
  }
  return ok({ ...command, baseVersion, value: merged });
}
