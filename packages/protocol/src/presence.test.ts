import { assert, describe, expect, test } from "vite-plus/test";
import {
  PRESENCE_THROTTLE_MS,
  PRESENCE_TTL_MS,
  PROTOCOL_LIMITS,
  applyPresence,
  editAccess,
  encodeClientMessage,
  encodeServerMessage,
  expirePresence,
  flushPresence,
  notePresence,
  releaseClient,
  type PresenceError,
} from "./index.ts";

const projectId = "01ARZ3NDEKTSV4000000000001";
const boardA = "01ARZ3NDEKTSV4000000000002";
const boardB = "01ARZ3NDEKTSV4000000000003";
const itemA = "01ARZ3NDEKTSV4000000000004";
const itemB = "01ARZ3NDEKTSV4000000000005";

function at(
  x: number,
  y: number,
  editingItemId?: string,
  boardId = boardA,
  selection: readonly string[] = [],
) {
  return {
    boardId,
    selection: [...selection],
    cursor: { x, y },
    ...(editingItemId === undefined ? {} : { editingItemId }),
  };
}

function row(clientId: string, receivedAt: number, editingItemId?: string, boardId = boardA) {
  return {
    clientId,
    receivedAt,
    presence: {
      boardId,
      selection: [],
      ...(editingItemId === undefined ? {} : { editingItemId }),
    },
  };
}

function value<T>(result: { ok: true; value: T } | { ok: false; error: PresenceError }): T {
  assert(result.ok);
  return result.value;
}

describe("presence schema", () => {
  test("accepts board, cursor, selection, and editing item, and rejects a carried client id", () => {
    const presence = at(1, 2, itemA, boardA, [itemB]);
    expect(value(applyPresence([], "client-1", presence, 0)).presence).toEqual(presence);
    expect(applyPresence([], "client-1", { ...presence, clientId: "forged" }, 0)).toEqual({
      ok: false,
      error: { code: "invalid_presence" },
    });
    expect(applyPresence([], "client-1", { ...presence, token: "secret" }, 0).ok).toBe(false);
    expect(applyPresence([], "client-1", { ...presence, cursor: { x: 0, y: 1, z: 2 } }, 0).ok).toBe(
      false,
    );
    expect(
      applyPresence([], "client-1", { ...at(0, 0), cursor: { x: Number.NaN, y: 0 } }, 0).ok,
    ).toBe(false);
    expect(notePresence({}, { ...presence, editingItemId: undefined }, 0)).toEqual({
      ok: false,
      error: { code: "invalid_presence" },
    });
  });

  test("keeps an empty selection and omits an absent cursor", () => {
    const stored = value(applyPresence([], "client-1", { boardId: boardA, selection: [] }, 0));
    expect(stored.presence).toEqual({ boardId: boardA, selection: [] });
    expect("cursor" in stored.presence).toBe(false);
    expect("editingItemId" in stored.presence).toBe(false);
  });

  test("rejects a blank client id only after time, and does not trim or fold case", () => {
    expect(applyPresence([], " ", at(0, 0), 0)).toEqual({
      ok: false,
      error: { code: "invalid_client" },
    });
    expect(releaseClient(null, " ", Number.NaN)).toEqual({
      ok: false,
      error: { code: "invalid_time" },
    });
    expect(releaseClient(null, " ", 0)).toEqual({ ok: false, error: { code: "invalid_client" } });
    const lower = value(applyPresence([], "a", at(0, 0), 0));
    const both = value(applyPresence(lower.records, "A", at(1, 1), 1));
    expect(both.records.map((record) => record.clientId)).toEqual(["A", "a"]);
    const spaced = value(applyPresence([], " a", at(0, 0), 0));
    expect(spaced.records[0]?.clientId).toBe(" a");
    expect(applyPresence([], "c".repeat(200), at(0, 0), 0).ok).toBe(true);
    expect(applyPresence([], "c".repeat(201), at(0, 0), 0).ok).toBe(false);
  });

  test("rejects an oversized record list before inspecting entries", () => {
    const records = Array.from({ length: PROTOCOL_LIMITS.maxMembers + 1 }, () => 1);
    expect(expirePresence(records, 0)).toEqual({ ok: false, error: { code: "invalid_records" } });
  });
});

describe("presence throttle", () => {
  test("emits the first snapshot and holds later ones until the original due time", () => {
    expect(PRESENCE_THROTTLE_MS).toBe(50);
    const first = value(notePresence({}, at(1, 1), 1_000));
    expect(first.kind).toBe("emit");
    if (first.kind !== "emit") return;
    const second = value(notePresence(first.throttle, at(2, 2), 1_040));
    expect(second).toMatchObject({ kind: "hold", dueAt: 1_050 });
    if (second.kind !== "hold") return;
    const third = value(notePresence(second.throttle, at(3, 3), 1_049));
    expect(third).toMatchObject({ kind: "hold", dueAt: 1_050 });
    if (third.kind !== "hold") return;
    expect(third.throttle.held?.cursor).toEqual({ x: 3, y: 3 });
    expect(value(flushPresence(third.throttle, 1_049)).kind).toBe("hold");
    const flushed = value(flushPresence(third.throttle, 1_050));
    expect(flushed.kind).toBe("emit");
    if (flushed.kind !== "emit") return;
    expect(flushed.presence.cursor).toEqual({ x: 3, y: 3 });
    expect(flushed.throttle.emittedAt).toBe(1_050);
  });

  test("emits an unchanged snapshot after the window so a heartbeat can refresh TTL", () => {
    const first = value(notePresence({}, at(1, 1), 0));
    assert(first.kind === "emit");
    const again = value(notePresence(first.throttle, at(1, 1), PRESENCE_THROTTLE_MS));
    expect(again.kind).toBe("emit");
  });

  test("does not emit early when the clock moves backwards", () => {
    const first = value(notePresence({}, at(1, 1), 100));
    assert(first.kind === "emit");
    const held = value(notePresence(first.throttle, at(2, 2), 90));
    expect(held).toMatchObject({ kind: "hold", dueAt: 150 });
  });

  test("copies the snapshot it holds", () => {
    const cursor = { x: 3, y: 4 };
    const first = value(notePresence({}, at(0, 0), 0));
    assert(first.kind === "emit");
    const held = value(
      notePresence(first.throttle, { boardId: boardA, selection: [], cursor }, 10),
    );
    assert(held.kind === "hold");
    cursor.x = 99;
    const flushed = value(flushPresence(held.throttle, 50));
    assert(flushed.kind === "emit");
    expect(flushed.presence.cursor).toEqual({ x: 3, y: 4 });
  });

  test("rejects a bad clock, a bad throttle, and a held snapshot with no emit time", () => {
    expect(notePresence({}, at(0, 0), Number.POSITIVE_INFINITY)).toEqual({
      ok: false,
      error: { code: "invalid_time" },
    });
    expect(notePresence({}, { boardId: "nope", selection: [] }, Number.NaN)).toEqual({
      ok: false,
      error: { code: "invalid_time" },
    });
    expect(notePresence(null, at(0, 0), 0)).toEqual({
      ok: false,
      error: { code: "invalid_throttle" },
    });
    expect(notePresence({ held: at(0, 0) }, at(1, 1), 0)).toEqual({
      ok: false,
      error: { code: "invalid_throttle" },
    });
    expect(value(flushPresence({}, 0)).kind).toBe("idle");
  });

  test("an emitted snapshot is still only a client message, not a granted lock", () => {
    const noted = value(notePresence({}, at(1, 2, itemA), 0));
    assert(noted.kind === "emit");
    expect(encodeClientMessage({ type: "presence", projectId, presence: noted.presence }).ok).toBe(
      true,
    );
    expect(
      encodeServerMessage({
        type: "presence",
        projectId,
        clientId: "client-1",
        presence: noted.presence,
      }).ok,
    ).toBe(true);
    expect(editAccess([], boardA, itemA, "client-1", 0)).toEqual({
      ok: true,
      value: { access: "edit", lock: "open" },
    });
  });
});

describe("presence TTL and soft lock", () => {
  test("keeps Presence records within the member limit", () => {
    const records = Array.from({ length: PROTOCOL_LIMITS.maxMembers }, (_, i) =>
      row(`client-${i}`, 0),
    );
    expect(applyPresence(records, "new-client", at(0, 0), 1)).toEqual({
      ok: false,
      error: { code: "invalid_records" },
    });
    expect(value(applyPresence(records, "client-0", at(0, 0), 1)).records).toHaveLength(
      PROTOCOL_LIMITS.maxMembers,
    );
    expect(
      value(applyPresence(records, "new-client", at(0, 0), PRESENCE_TTL_MS)).records,
    ).toHaveLength(1);
  });

  test("grants, refreshes, and sorts records without mutating the input", () => {
    expect(PRESENCE_TTL_MS).toBe(10_000);
    expect(PRESENCE_TTL_MS).toBeGreaterThan(PRESENCE_THROTTLE_MS);
    const source = row("client-b", 0, itemB);
    const input = [source];
    const granted = value(applyPresence(input, "client-a", at(1, 1, itemA), 10));
    expect(input).toEqual([source]);
    expect(source.receivedAt).toBe(0);
    expect(source.presence.editingItemId).toBe(itemB);
    expect(granted.edit).toBe("granted");
    expect(granted.records.map((record) => record.clientId)).toEqual(["client-a", "client-b"]);
    const kept = granted.records.find((record) => record.clientId === "client-b");
    expect(kept).not.toBe(source);
    expect(kept?.presence).not.toBe(source.presence);
    const refreshed = value(applyPresence(granted.records, "client-a", at(4, 5, itemA), 20));
    expect(refreshed.edit).toBe("refreshed");
    expect(refreshed.records[0]?.receivedAt).toBe(20);
    expect(editAccess(refreshed.records, boardA, itemA, "client-a", 20)).toEqual({
      ok: true,
      value: { access: "edit", lock: "self" },
    });
  });

  test("lets another client view and move a cursor, but not take the editing session", () => {
    const held = value(applyPresence([], "holder", at(0, 0, itemA), 0)).records;
    const viewing = value(applyPresence(held, "viewer", at(8, 9, itemA, boardA, [itemA]), 30));
    expect(viewing.edit).toBe("denied");
    expect(viewing.presence).toEqual({
      boardId: boardA,
      selection: [itemA],
      cursor: { x: 8, y: 9 },
    });
    expect("editingItemId" in viewing.presence).toBe(false);
    expect(editAccess(viewing.records, boardA, itemA, "viewer", 30)).toEqual({
      ok: true,
      value: { access: "view", holderClientId: "holder" },
    });
    expect(editAccess(viewing.records, boardA, itemA, "holder", 30)).toEqual({
      ok: true,
      value: { access: "edit", lock: "self" },
    });
    const still = viewing.records.find((record) => record.clientId === "holder");
    expect(still?.presence.editingItemId).toBe(itemA);
  });

  test("scopes the lock to one board and replaces the caller's previous claim", () => {
    const onA = value(applyPresence([], "editor", at(0, 0, itemA), 0)).records;
    const otherBoard = value(applyPresence(onA, "other", at(1, 1, itemA, boardB), 5));
    expect(otherBoard.edit).toBe("granted");
    expect(editAccess(otherBoard.records, boardA, itemA, "other", 5)).toEqual({
      ok: true,
      value: { access: "view", holderClientId: "editor" },
    });
    expect(editAccess(otherBoard.records, boardB, itemA, "other", 5)).toEqual({
      ok: true,
      value: { access: "edit", lock: "self" },
    });
    const moved = value(applyPresence(otherBoard.records, "editor", at(2, 2, itemB), 6));
    expect(moved.edit).toBe("granted");
    expect(editAccess(moved.records, boardA, itemA, "editor", 6)).toEqual({
      ok: true,
      value: { access: "edit", lock: "open" },
    });
    expect(editAccess(moved.records, boardA, itemB, "editor", 6)).toEqual({
      ok: true,
      value: { access: "edit", lock: "self" },
    });
  });

  test("a denied claim does not keep the caller's previous lock", () => {
    const first = value(applyPresence([], "editor", at(0, 0, itemA), 0)).records;
    const blocked = value(applyPresence(first, "other", at(1, 1, itemB), 1)).records;
    const denied = value(applyPresence(blocked, "editor", at(2, 2, itemB), 2));
    expect(denied.edit).toBe("denied");
    expect(editAccess(denied.records, boardA, itemA, "editor", 2)).toEqual({
      ok: true,
      value: { access: "edit", lock: "open" },
    });
    expect(editAccess(denied.records, boardA, itemB, "other", 2)).toEqual({
      ok: true,
      value: { access: "edit", lock: "self" },
    });
  });

  test("clears a lock when the next snapshot omits the editing item", () => {
    const held = value(applyPresence([], "editor", at(0, 0, itemA), 0)).records;
    const cleared = value(applyPresence(held, "editor", at(3, 3), 4));
    expect(cleared.edit).toBe("none");
    expect(editAccess(cleared.records, boardA, itemA, "editor", 4)).toEqual({
      ok: true,
      value: { access: "edit", lock: "open" },
    });
  });

  test("expires the snapshot and the lock at the TTL boundary", () => {
    const held = [row("editor", 0, itemA)];
    expect(value(expirePresence(held, PRESENCE_TTL_MS - 1))).toHaveLength(1);
    expect(value(expirePresence(held, PRESENCE_TTL_MS))).toEqual([]);
    expect(editAccess(held, boardA, itemA, "viewer", PRESENCE_TTL_MS - 1)).toEqual({
      ok: true,
      value: { access: "view", holderClientId: "editor" },
    });
    expect(editAccess(held, boardA, itemA, "viewer", PRESENCE_TTL_MS)).toEqual({
      ok: true,
      value: { access: "edit", lock: "open" },
    });
    const taken = value(applyPresence(held, "viewer", at(1, 1, itemA), PRESENCE_TTL_MS));
    expect(taken.edit).toBe("granted");
    expect(taken.records).toEqual([
      { clientId: "viewer", receivedAt: PRESENCE_TTL_MS, presence: at(1, 1, itemA) },
    ]);
  });

  test("keeps a future receivedAt and treats a re-claim after expiry as a new grant", () => {
    expect(value(expirePresence([row("editor", 50, itemA)], 40))).toHaveLength(1);
    const expired = [row("editor", 0, itemA)];
    const again = value(applyPresence(expired, "editor", at(1, 1, itemA), PRESENCE_TTL_MS));
    expect(again.edit).toBe("granted");
  });

  test("releaseClient drops one connection without waiting for TTL and expires the others", () => {
    const records = [row("leaving", 0, itemA), row("stale", 0, itemB), row("fresh", 9_500)];
    const left = value(releaseClient(records, "leaving", 10_000));
    expect(left.map((record) => record.clientId)).toEqual(["fresh"]);
    expect(editAccess(left, boardA, itemA, "fresh", 10_000)).toEqual({
      ok: true,
      value: { access: "edit", lock: "open" },
    });
    expect(value(releaseClient(left, "absent", 10_000))).toEqual(left);
  });

  test("does not pick a winner when two live clients claim one board item", () => {
    const corrupt = [row("a", 0, itemA), row("b", 0, itemA)];
    expect(expirePresence(corrupt, 10)).toEqual({ ok: false, error: { code: "invalid_records" } });
    expect(applyPresence(corrupt, "c", at(1, 1), 10).ok).toBe(false);
    expect(editAccess(corrupt, boardA, itemA, "c", 10).ok).toBe(false);
    const released = value(releaseClient(corrupt, "a", 10));
    expect(released.map((record) => record.clientId)).toEqual(["b"]);
    expect(editAccess(released, boardA, itemA, "b", 10)).toEqual({
      ok: true,
      value: { access: "edit", lock: "self" },
    });
    const others = [row("a", 0, itemA), row("b", 0, itemA), row("c", 0)];
    expect(releaseClient(others, "c", 10)).toEqual({
      ok: false,
      error: { code: "invalid_records" },
    });
    const staleConflict = [row("a", 0, itemA), row("b", PRESENCE_TTL_MS, itemA)];
    expect(
      value(expirePresence(staleConflict, PRESENCE_TTL_MS)).map((record) => record.clientId),
    ).toEqual(["b"]);
  });

  test("rejects duplicate client ids and a malformed lock id", () => {
    const duplicate = [row("a", 0), row("a", 1)];
    expect(expirePresence(duplicate, 1)).toEqual({ ok: false, error: { code: "invalid_records" } });
    expect(editAccess([row("a", 0, itemA)], "not-an-id", itemA, "a", 0)).toEqual({
      ok: false,
      error: { code: "invalid_presence" },
    });
  });
});
