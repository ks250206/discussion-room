import * as v from "valibot";
import { err, ok, IdSchema, type Result } from "@discussion-room/domain";
import { PROTOCOL_LIMITS } from "./json.ts";
import { PresenceSchema, type Presence } from "./messages.ts";

/**
 * Portable presence throttle, TTL, and per-board editing soft-lock.
 * Callers pass time and the server-assigned clientId. No clock, socket,
 * token check, persistence, or command inspection lives here. See docs/presence.md.
 */

/** Minimum gap between emitted presence snapshots. Issue #37 names 50ms as the target. */
export const PRESENCE_THROTTLE_MS = 50;
/**
 * A record older than this is absent, and its editing soft-lock leaves with it.
 * Chosen for this contract so a throttled refresh cannot consume the whole window.
 * Not a threshold from the implementation plan.
 */
export const PRESENCE_TTL_MS = 10_000;

export type PresenceError = {
  readonly code:
    | "invalid_presence"
    | "invalid_throttle"
    | "invalid_client"
    | "invalid_time"
    | "invalid_records";
};

/** Sender-side coalesce state. `{}` is the initial value. The module stores nothing itself. */
export type PresenceThrottle = {
  readonly emittedAt?: number;
  readonly held?: Presence;
};

export type PresenceEmit =
  | {
      readonly kind: "emit";
      readonly presence: Presence;
      readonly throttle: PresenceThrottle;
    }
  | { readonly kind: "hold"; readonly dueAt: number; readonly throttle: PresenceThrottle }
  | { readonly kind: "idle"; readonly throttle: PresenceThrottle };

export type PresenceRecord = {
  readonly clientId: string;
  readonly presence: Presence;
  readonly receivedAt: number;
};

export type PresenceEdit = "none" | "granted" | "refreshed" | "denied";

export type PresenceUpdate = {
  readonly records: readonly PresenceRecord[];
  readonly presence: Presence;
  readonly edit: PresenceEdit;
};

/**
 * `edit` + `open`: nobody holds the item, so an editing claim may be attempted.
 * `edit` + `self`: this client holds it.
 * `view`: another client holds it. Cursor and selection still update; the claim is not stored.
 */
export type EditAccess =
  | { readonly access: "edit"; readonly lock: "open" }
  | { readonly access: "edit"; readonly lock: "self" }
  | { readonly access: "view"; readonly holderClientId: string };

const clientIdSchema = v.pipe(
  v.string(),
  v.check((value) => value.trim().length > 0),
  v.maxLength(200),
);
const receivedAtSchema = v.pipe(v.number(), v.finite());
const recordSchema = v.pipe(
  v.strictObject({
    clientId: clientIdSchema,
    presence: PresenceSchema,
    receivedAt: receivedAtSchema,
  }),
  v.readonly(),
);
const throttleSchema = v.pipe(
  v.strictObject({
    emittedAt: v.exactOptional(receivedAtSchema),
    held: v.exactOptional(PresenceSchema),
  }),
  v.readonly(),
);

function readTime(now: number): Result<number, PresenceError> {
  return typeof now === "number" && Number.isFinite(now) ? ok(now) : err({ code: "invalid_time" });
}

function readClientId(clientId: string): Result<string, PresenceError> {
  const parsed = v.safeParse(clientIdSchema, clientId);
  return parsed.success ? ok(parsed.output) : err({ code: "invalid_client" });
}

function snapshotPresence(presence: Presence): Presence {
  const base = { boardId: presence.boardId, selection: [...presence.selection] };
  const cursor =
    presence.cursor === undefined ? undefined : { x: presence.cursor.x, y: presence.cursor.y };
  if (cursor !== undefined && presence.editingItemId !== undefined) {
    return { ...base, cursor, editingItemId: presence.editingItemId };
  }
  if (cursor !== undefined) return { ...base, cursor };
  if (presence.editingItemId !== undefined) {
    return { ...base, editingItemId: presence.editingItemId };
  }
  return base;
}

function withoutEditing(presence: Presence): Presence {
  const base = { boardId: presence.boardId, selection: [...presence.selection] };
  if (presence.cursor === undefined) return base;
  return { ...base, cursor: { x: presence.cursor.x, y: presence.cursor.y } };
}

function copyRecord(record: PresenceRecord): PresenceRecord {
  return {
    clientId: record.clientId,
    presence: snapshotPresence(record.presence),
    receivedAt: record.receivedAt,
  };
}

function byClientId(left: PresenceRecord, right: PresenceRecord): number {
  if (left.clientId < right.clientId) return -1;
  if (left.clientId > right.clientId) return 1;
  return 0;
}

function readRecords(records: unknown): Result<readonly PresenceRecord[], PresenceError> {
  if (!Array.isArray(records) || records.length > PROTOCOL_LIMITS.maxMembers) {
    return err({ code: "invalid_records" });
  }
  const copied: PresenceRecord[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const parsed = v.safeParse(recordSchema, record);
    if (!parsed.success) return err({ code: "invalid_records" });
    if (seen.has(parsed.output.clientId)) return err({ code: "invalid_records" });
    seen.add(parsed.output.clientId);
    copied.push(copyRecord(parsed.output));
  }
  return ok(copied);
}

function lockKey(presence: Presence): string | undefined {
  if (presence.editingItemId === undefined) return undefined;
  return `${presence.boardId}\0${presence.editingItemId}`;
}

/** Drops expired rows. Two live claims for one board item are corrupt and are not repaired. */
function liveRecords(
  records: readonly PresenceRecord[],
  now: number,
): Result<readonly PresenceRecord[], PresenceError> {
  const live: PresenceRecord[] = [];
  const locks = new Set<string>();
  for (const record of records) {
    const age = now - record.receivedAt;
    if (!Number.isFinite(age)) return err({ code: "invalid_time" });
    if (age >= PRESENCE_TTL_MS) continue;
    const key = lockKey(record.presence);
    if (key !== undefined) {
      if (locks.has(key)) return err({ code: "invalid_records" });
      locks.add(key);
    }
    live.push(record);
  }
  live.sort(byClientId);
  return ok(live);
}

function readThrottle(throttle: unknown): Result<PresenceThrottle, PresenceError> {
  const parsed = v.safeParse(throttleSchema, throttle);
  if (!parsed.success) return err({ code: "invalid_throttle" });
  if (parsed.output.held !== undefined && parsed.output.emittedAt === undefined) {
    return err({ code: "invalid_throttle" });
  }
  const emittedAt = parsed.output.emittedAt;
  const held = parsed.output.held;
  if (emittedAt === undefined) return ok({});
  if (held === undefined) return ok({ emittedAt });
  return ok({ emittedAt, held: snapshotPresence(held) });
}

function sameClaim(record: PresenceRecord | undefined, boardId: string, itemId: string): boolean {
  return (
    record !== undefined &&
    record.presence.boardId === boardId &&
    record.presence.editingItemId === itemId
  );
}

function dueAt(emittedAt: number): Result<number, PresenceError> {
  const at = emittedAt + PRESENCE_THROTTLE_MS;
  return Number.isFinite(at) ? ok(at) : err({ code: "invalid_time" });
}

/**
 * Leading-edge throttle. The first snapshot emits. Later ones within the window replace `held`
 * and keep the original due time. An identical snapshot after the window emits again so a
 * heartbeat can refresh TTL. Unchanged snapshots are not suppressed.
 */
export function notePresence(
  throttle: unknown,
  presence: unknown,
  now: number,
): Result<Exclude<PresenceEmit, { readonly kind: "idle" }>, PresenceError> {
  const time = readTime(now);
  if (!time.ok) return time;
  const state = readThrottle(throttle);
  if (!state.ok) return state;
  const parsed = v.safeParse(PresenceSchema, presence);
  if (!parsed.success) return err({ code: "invalid_presence" });
  const snapshot = snapshotPresence(parsed.output);
  const emittedAt = state.value.emittedAt;
  if (emittedAt === undefined) {
    return ok({ kind: "emit", presence: snapshot, throttle: { emittedAt: time.value } });
  }
  const age = time.value - emittedAt;
  if (!Number.isFinite(age)) return err({ code: "invalid_time" });
  if (age >= PRESENCE_THROTTLE_MS) {
    return ok({ kind: "emit", presence: snapshot, throttle: { emittedAt: time.value } });
  }
  const at = dueAt(emittedAt);
  if (!at.ok) return at;
  return ok({
    kind: "hold",
    dueAt: at.value,
    throttle: { emittedAt, held: snapshot },
  });
}

/** Emits `held` once `now` reaches the due time. Does not schedule the timer. */
export function flushPresence(throttle: unknown, now: number): Result<PresenceEmit, PresenceError> {
  const time = readTime(now);
  if (!time.ok) return time;
  const state = readThrottle(throttle);
  if (!state.ok) return state;
  const emittedAt = state.value.emittedAt;
  const held = state.value.held;
  if (held === undefined || emittedAt === undefined) {
    return ok({ kind: "idle", throttle: emittedAt === undefined ? {} : { emittedAt } });
  }
  const age = time.value - emittedAt;
  if (!Number.isFinite(age)) return err({ code: "invalid_time" });
  if (age >= PRESENCE_THROTTLE_MS) {
    return ok({
      kind: "emit",
      presence: snapshotPresence(held),
      throttle: { emittedAt: time.value },
    });
  }
  const at = dueAt(emittedAt);
  if (!at.ok) return at;
  return ok({
    kind: "hold",
    dueAt: at.value,
    throttle: { emittedAt, held: snapshotPresence(held) },
  });
}

/**
 * Replaces this client's snapshot. `clientId` is the id the server already bound to the
 * connection; the payload cannot carry one. A free editing claim is stored. A claim held by
 * someone else is dropped and the cursor and selection are still stored. Previous claims of
 * this client disappear because one client has one snapshot.
 */
export function applyPresence(
  records: unknown,
  clientId: string,
  presence: unknown,
  now: number,
): Result<PresenceUpdate, PresenceError> {
  const time = readTime(now);
  if (!time.ok) return time;
  const id = readClientId(clientId);
  if (!id.ok) return id;
  const parsed = v.safeParse(PresenceSchema, presence);
  if (!parsed.success) return err({ code: "invalid_presence" });
  const read = readRecords(records);
  if (!read.ok) return read;
  const live = liveRecords(read.value, time.value);
  if (!live.ok) return live;
  const desired = snapshotPresence(parsed.output);
  const self = live.value.find((record) => record.clientId === id.value);
  const others = live.value.filter((record) => record.clientId !== id.value);
  if (others.length >= PROTOCOL_LIMITS.maxMembers) return err({ code: "invalid_records" });
  const itemId = desired.editingItemId;
  let accepted = desired;
  let edit: PresenceEdit = "none";
  if (itemId !== undefined) {
    const occupant = others.find(
      (record) =>
        record.presence.boardId === desired.boardId && record.presence.editingItemId === itemId,
    );
    if (occupant !== undefined) {
      accepted = withoutEditing(desired);
      edit = "denied";
    } else if (sameClaim(self, desired.boardId, itemId)) {
      edit = "refreshed";
    } else {
      edit = "granted";
    }
  }
  const stored = snapshotPresence(accepted);
  const next = [...others, { clientId: id.value, presence: stored, receivedAt: time.value }];
  next.sort(byClientId);
  return ok({ records: next, presence: stored, edit });
}

/** TTL pass with no new snapshot. Scheduling the pass is the caller's job. */
export function expirePresence(
  records: unknown,
  now: number,
): Result<readonly PresenceRecord[], PresenceError> {
  const time = readTime(now);
  if (!time.ok) return time;
  const read = readRecords(records);
  if (!read.ok) return read;
  return liveRecords(read.value, time.value);
}

/**
 * Drops one server-assigned client immediately. The server calls this on leave or disconnect.
 * TTL is only the fallback when that signal never arrives. Other clients are expired in the
 * same pass. Two remaining live claims still fail closed.
 */
export function releaseClient(
  records: unknown,
  clientId: string,
  now: number,
): Result<readonly PresenceRecord[], PresenceError> {
  const time = readTime(now);
  if (!time.ok) return time;
  const id = readClientId(clientId);
  if (!id.ok) return id;
  const read = readRecords(records);
  if (!read.ok) return read;
  return liveRecords(
    read.value.filter((record) => record.clientId !== id.value),
    time.value,
  );
}

/** Per-board soft-lock lookup. A missing record is not a holder; an open lock is not acquired. */
export function editAccess(
  records: unknown,
  boardId: string,
  itemId: string,
  clientId: string,
  now: number,
): Result<EditAccess, PresenceError> {
  const time = readTime(now);
  if (!time.ok) return time;
  const id = readClientId(clientId);
  if (!id.ok) return id;
  if (!v.safeParse(IdSchema, boardId).success || !v.safeParse(IdSchema, itemId).success) {
    return err({ code: "invalid_presence" });
  }
  const read = readRecords(records);
  if (!read.ok) return read;
  const live = liveRecords(read.value, time.value);
  if (!live.ok) return live;
  const holders = live.value.filter(
    (record) => record.presence.boardId === boardId && record.presence.editingItemId === itemId,
  );
  const holder = holders[0];
  if (holder === undefined) return ok({ access: "edit", lock: "open" });
  if (holder.clientId === id.value) return ok({ access: "edit", lock: "self" });
  return ok({ access: "view", holderClientId: holder.clientId });
}
