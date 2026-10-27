import { assert, describe, expect, expectTypeOf, test } from "vite-plus/test";
import * as v from "valibot";
import { validateDomainState, validateKnownM1State } from "@discussion-room/domain";
import {
  ClientMessageSchema,
  ServerMessageSchema,
  PROTOCOL_LIMITS,
  PROTOCOL_VERSION,
  REJECT_CODES,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  snapshotJson,
  validateClientMessage,
  validateServerMessage,
  type ClientMessage,
  type ServerMessage,
} from "./index.ts";

const projectId = "01ARZ3NDEKTSV4000000000001";
const boardId = "01ARZ3NDEKTSV4000000000002";
const commandId = "01ARZ3NDEKTSV4000000000090";
const hello = {
  type: "hello",
  protocolVersion: PROTOCOL_VERSION,
  clientId: "client-1",
  displayName: "研究者",
};
const project = {
  id: projectId,
  title: "研究",
  description: "",
  createdAt: "2026-10-27T00:00:00Z",
  version: 1,
};
const state = {
  entities: { projects: [project], boards: [], artifacts: [], revisions: [], canvasItems: [] },
  itemPorts: [],
  semanticRelations: [],
  dataflowEdges: [],
  visualConnectors: [],
};
const event = {
  type: "event",
  seq: 1,
  projectId,
  commandId,
  actor: "editor",
  events: [
    {
      type: "project.changed",
      commandId,
      actor: "editor",
      timestamp: "2026-10-27T00:00:00Z",
      origin: "human",
      before: null,
      after: project,
    },
  ],
};
const presence = { boardId, selection: [], cursor: { x: 0, y: 1 } };
const member = { clientId: "client-1", displayName: "研究者" };
const command = {
  type: "command",
  commandId,
  projectId,
  command: {
    type: "canvasItem.create",
    value: {
      boardId,
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      viewState: { nested: { units: "mS/cm", value: null }, content: [1, true, "Ω"] },
    },
    ports: [],
  },
};
const clients: readonly unknown[] = [
  hello,
  { ...hello, token: "secret" },
  { type: "join", projectId },
  { type: "join", projectId, lastSeq: 0 },
  command,
  { type: "presence", projectId, presence },
  { type: "ping", nonce: "a" },
  { type: "pong", nonce: "a" },
];
const servers: readonly unknown[] = [
  { type: "joined", mode: "snapshot", projectId, seq: 0, snapshot: state, members: [member] },
  { type: "joined", mode: "events", projectId, seq: 1, fromSeq: 0, events: [event], members: [] },
  { type: "joined", mode: "events", projectId, seq: 7, fromSeq: 7, events: [], members: [] },
  { type: "ack", commandId, seq: 1 },
  {
    type: "reject",
    commandId,
    code: "version_conflict",
    message: "Conflict",
    current: { version: 2 },
  },
  event,
  { type: "presence", projectId, clientId: "client-1", presence },
  { type: "member", projectId, action: "joined", member },
  { type: "member", projectId, action: "left", member },
  { type: "ping", nonce: "a" },
  { type: "pong", nonce: "a" },
];
function code(
  result: ReturnType<typeof snapshotJson> | ReturnType<typeof validateClientMessage>,
): string {
  assert(!result.ok);
  return result.error.code;
}
function opaque(value: unknown): unknown {
  return {
    ...command,
    command: { ...command.command, value: { ...command.command.value, viewState: { value } } },
  };
}

describe("directional protocol contracts", () => {
  test.each(clients)("client valid round-trip %#", (input) => {
    const frozen: unknown = JSON.parse(JSON.stringify(input));
    const encoded = encodeClientMessage(input);
    assert(encoded.ok);
    const decoded = decodeClientMessage(encoded.value);
    assert(decoded.ok);
    expect(decoded.value).toEqual(input);
    expect(input).toEqual(frozen);
    expect(v.safeParse(ClientMessageSchema, decoded.value).success).toBe(true);
  });
  test.each(servers)("server valid round-trip %#", (input) => {
    const frozen: unknown = JSON.parse(JSON.stringify(input));
    const encoded = encodeServerMessage(input);
    assert(encoded.ok);
    const decoded = decodeServerMessage(new TextEncoder().encode(encoded.value));
    assert(decoded.ok);
    expect(decoded.value).toEqual(input);
    expect(input).toEqual(frozen);
    expect(v.safeParse(ServerMessageSchema, decoded.value).success).toBe(true);
  });
  test("public contracts are readonly", () => {
    expectTypeOf<ClientMessage>().extract<{ type: "hello" }>().toEqualTypeOf<
      Readonly<{
        type: "hello";
        protocolVersion: 1;
        clientId: string;
        displayName: string;
        token?: string;
      }>
    >();
    expectTypeOf<ServerMessage>()
      .extract<{ type: "joined"; mode: "events" }>()
      .toHaveProperty("events")
      .items.toMatchTypeOf<Readonly<object>>();
  });
  test("direction confusion rejects", () => {
    expect(validateClientMessage(event).ok).toBe(false);
    expect(validateServerMessage(hello).ok).toBe(false);
    expect(validateServerMessage({ type: "presence", projectId, presence }).ok).toBe(false);
    expect(
      validateClientMessage({ type: "presence", projectId, clientId: "forged", presence }).ok,
    ).toBe(false);
  });
  test("version mismatch is distinct and redacts other data", () => {
    expect(validateClientMessage({ ...hello, protocolVersion: 2, token: "do-not-log" })).toEqual({
      ok: false,
      error: { code: "protocol_version_mismatch", expected: 1, received: 2 },
    });
    for (const protocolVersion of [undefined, "1", 1.5, null])
      expect(code(validateClientMessage({ ...hello, protocolVersion }))).not.toBe(
        "protocol_version_mismatch",
      );
  });
  test.each([
    { ...hello, clientId: "" },
    { ...hello, displayName: " " },
    { ...hello, extra: 1 },
    { ...hello, token: "" },
    { ...hello, token: "x".repeat(PROTOCOL_LIMITS.maxTokenLength + 1) },
    { ...hello, displayName: "x".repeat(PROTOCOL_LIMITS.maxDisplayNameLength + 1) },
    { type: "join", projectId: "" },
    { type: "join", projectId, lastSeq: -1 },
    { type: "join", projectId, lastSeq: 0.1 },
    { type: "join", projectId, lastSeq: Number.MAX_SAFE_INTEGER + 1 },
    { type: "ping", nonce: "" },
    { type: "unknown" },
    { ...command, baseVersion: 1 },
    { ...command, decisionContext: { aiApproval: true } },
    { ...command, command: { ...command.command, aiApproval: { approvedBy: "me" } } },
    { ...command, command: { ...command.command, value: { ...command.command.value, width: 0 } } },
    {
      ...command,
      command: {
        type: "artifact.create",
        projectId,
        content: {
          kind: "note",
          payload: { title: "n", markdown: "", author: "me", generatedBy: "human", extra: true },
        },
      },
    },
    {
      ...command,
      command: {
        type: "artifact.update",
        id: boardId,
        baseVersion: 1,
        content: { kind: "note", payload: {} },
      },
    },
    {
      ...command,
      command: {
        type: "artifact.create",
        projectId: boardId,
        content: {
          kind: "note",
          payload: { title: "n", markdown: "", author: "me", generatedBy: "human" },
        },
      },
    },
    { type: "presence", projectId, presence: { ...presence, cursor: { x: 0, y: 1, z: 2 } } },
    { type: "presence", projectId, presence: { ...presence, selection: [""] } },
  ])("invalid client %#", (input) => {
    expect(validateClientMessage(input).ok).toBe(false);
  });
  test.each([
    { ...event, seq: 0 },
    { ...event, seq: 1.5 },
    { ...event, events: [] },
    { ...event, actor: "forged" },
    { ...event, projectId: boardId },
    { ...event, commandId: boardId },
    { ...event, events: [{ ...event.events[0], extra: true }] },
    { type: "ack", commandId, seq: 0 },
    { type: "reject", commandId, code: "random", message: "error" },
    { type: "reject", commandId, code: "not_found", message: "", current: { version: 0 } },
    { type: "member", projectId, action: "other", member },
    {
      type: "joined",
      mode: "snapshot",
      projectId,
      seq: 0,
      snapshot: state,
      events: [],
      members: [],
    },
    { type: "joined", mode: "snapshot", projectId: boardId, seq: 0, snapshot: state, members: [] },
    {
      type: "joined",
      mode: "snapshot",
      projectId,
      seq: 0,
      snapshot: { ...state, entities: { ...state.entities, projects: [] } },
      members: [],
    },
    {
      type: "joined",
      mode: "snapshot",
      projectId,
      seq: 0,
      snapshot: state,
      members: [member, member],
    },
    { type: "joined", mode: "events", projectId, seq: 2, fromSeq: 0, events: [event], members: [] },
    { type: "joined", mode: "events", projectId, seq: 1, fromSeq: 1, events: [event], members: [] },
  ])("invalid server %#", (input) => {
    expect(validateServerMessage(input).ok).toBe(false);
  });
  test.each(REJECT_CODES)("reject code %s", (rejectCode) => {
    expect(
      validateServerMessage({ type: "reject", commandId, code: rejectCode, message: "Rejected" })
        .ok,
    ).toBe(true);
  });
});

describe("JSON safety before send and after receive", () => {
  test.each([
    NaN,
    Infinity,
    -Infinity,
    undefined,
    () => 1,
    Symbol("x"),
    1n,
    new Date(),
    new Map(),
    /a/,
    -0,
  ])("reject lossy or executable value %#", (value) => {
    expect(code(encodeClientMessage(opaque(value)))).toBe("json_unsafe");
  });
  test("reject accessor without invocation and object hooks without invocation", () => {
    let calls = 0;
    const getter = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        calls++;
        return 1;
      },
    });
    const hook = {
      toJSON() {
        calls++;
        return {};
      },
    };
    expect(code(encodeClientMessage(opaque(getter)))).toBe("json_unsafe");
    expect(code(encodeClientMessage(opaque(hook)))).toBe("json_unsafe");
    expect(calls).toBe(0);
  });
  test("plain toJSON keys retain JSON values through encode and decode", () => {
    for (const toJSON of [null, false, 7, "metadata", { nested: ["retained", null] }]) {
      const input = opaque({ toJSON, nested: { toJSON } });
      const encoded = encodeClientMessage(input);
      assert(encoded.ok);
      expect(decodeClientMessage(encoded.value)).toMatchObject({ ok: true, value: input });
    }
  });
  test("standard prototype serialization hooks are refused without invoking them", () => {
    let calls = 0;
    for (const prototype of [Object.prototype, Array.prototype]) {
      const original = Object.getOwnPropertyDescriptor(prototype, "toJSON");
      try {
        Object.defineProperty(prototype, "toJSON", {
          configurable: true,
          get() {
            calls++;
            return () => {
              calls++;
              return "changed";
            };
          },
        });
        const result = encodeClientMessage(opaque({ toJSON: "plain-data" }));
        assert(!result.ok);
        expect(result.error.code).toBe("json_unsafe");
      } finally {
        if (original) Object.defineProperty(prototype, "toJSON", original);
        else Reflect.deleteProperty(prototype, "toJSON");
      }
    }
    expect(calls).toBe(0);
  });
  test("reject hidden properties, symbol keys, sparse arrays, array extensions and custom prototypes", () => {
    const sparse: unknown[] = [];
    sparse.length = 2;
    const values = [
      Object.defineProperty({}, "hidden", { value: 1 }),
      { [Symbol("hidden")]: 1 },
      sparse,
      Object.assign([1], { extra: true }),
      Object.create({ inherited: 1 }) as unknown,
    ];
    for (const value of values)
      expect(code(encodeClientMessage(opaque(value)))).toBe("json_unsafe");
  });
  test("reject cycles but allow repeated references and null prototypes without altering source", () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(code(encodeClientMessage(opaque(cycle)))).toBe("json_unsafe");
    const shared = { value: "unchanged", missing: null };
    const noPrototype: unknown = Object.create(null);
    Object.defineProperty(noPrototype, "__proto__", { value: { safe: true }, enumerable: true });
    const input = opaque({ a: shared, b: shared, noPrototype });
    const encoded = encodeClientMessage(input);
    assert(encoded.ok);
    const decoded = decodeClientMessage(encoded.value);
    assert(decoded.ok);
    expect(decoded.value).toEqual(input);
    expect(shared).toEqual({ value: "unchanged", missing: null });
    expect(Object.getPrototypeOf(noPrototype)).toBe(null);
  });
  test("handles throwing reflection as a Result (not a claim to detect transparent Proxies)", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(code(encodeClientMessage(opaque(revoked.proxy)))).toBe("json_unsafe");
  });
  test("returned snapshot isolates opaque data from later caller mutation", () => {
    const original = { value: 1 };
    const valid = validateClientMessage(opaque(original));
    assert(valid.ok);
    original.value = 2;
    const encoded = encodeClientMessage(valid.value);
    assert(encoded.ok);
    expect(encoded.value).toContain('"value":1');
  });
  test.each([
    "{",
    "null",
    "[]",
    '{"type":"join","projectId":""}',
    '{"type":"ping","nonce":"x","n":1e999}',
  ])("receive rejects invalid JSON/schema/number %#", (text) => {
    expect(decodeClientMessage(text).ok).toBe(false);
  });
  test("reject invalid UTF-8 rather than replacing bytes", () => {
    expect(code(decodeClientMessage(new Uint8Array([0xc3, 0x28])))).toBe("invalid_utf8");
    expect(code(decodeClientMessage(new Uint8Array([0xff])))).toBe("invalid_utf8");
  });
  test("opaque strings preserve Unicode, surrogate escapes, units and provenance-like metadata", () => {
    const value = '研究 😀 Ω \ud800\n\t\u0000\\"';
    const input = opaque({ value, provenance: { originalUnit: "mS/cm", source: null } });
    const encoded = encodeClientMessage(input);
    assert(encoded.ok);
    expect(decodeClientMessage(encoded.value)).toMatchObject({ ok: true, value: input });
  });
  test("UTF-8 limit accepts exact bytes and rejects next byte for encode and decode", () => {
    const base = opaque("");
    const encoded = encodeClientMessage(base);
    assert(encoded.ok);
    const overhead = new TextEncoder().encode(encoded.value).length;
    const payload = "x".repeat(PROTOCOL_LIMITS.maxMessageBytes - overhead);
    const exact = encodeClientMessage(opaque(payload));
    assert(exact.ok);
    expect(new TextEncoder().encode(exact.value).length).toBe(PROTOCOL_LIMITS.maxMessageBytes);
    expect(decodeClientMessage(exact.value).ok).toBe(true);
    expect(code(encodeClientMessage(opaque(payload + "x")))).toBe("message_too_large");
    expect(code(decodeClientMessage(exact.value + " "))).toBe("message_too_large");
    expect(
      code(
        encodeClientMessage(opaque("研".repeat(Math.ceil(PROTOCOL_LIMITS.maxMessageBytes / 3)))),
      ),
    ).toBe("message_too_large");
    expect(
      code(decodeClientMessage('"' + "研".repeat(PROTOCOL_LIMITS.maxMessageBytes / 2) + '"')),
    ).toBe("message_too_large");
  });
  test("string-key-heavy messages near the node limit roundtrip under the same raw budget", () => {
    const keyed = Object.fromEntries(
      Array.from({ length: 9_900 }, (_, index) => [`k${index}`, ""]),
    );
    const input = opaque(Array.from({ length: 5 }, () => keyed));
    const encoded = encodeClientMessage(input);
    assert(encoded.ok);
    expect(new TextEncoder().encode(encoded.value).length).toBeLessThan(
      PROTOCOL_LIMITS.maxMessageBytes,
    );
    expect(decodeClientMessage(encoded.value)).toMatchObject({ ok: true, value: input });
  });
  test("detached JSON copies retain ordinary writable configurable data properties", () => {
    const original = Object.freeze({ metadata: Object.freeze({ x: 1 }) });
    const copy = snapshotJson(original);
    assert(copy.ok);
    expect(copy.value).toEqual(original);
    expect(Object.getOwnPropertyDescriptor(copy.value, "metadata")).toMatchObject({
      enumerable: true,
      writable: true,
      configurable: true,
    });
    expect(Object.getOwnPropertyDescriptor(original, "metadata")).toMatchObject({
      writable: false,
      configurable: false,
    });
  });
  test("depth and collection/node budgets reject before stringify or parse recursion", () => {
    let nested: unknown = null;
    for (let i = 0; i < PROTOCOL_LIMITS.maxDepth + 1; i++) nested = { nested };
    expect(code(encodeClientMessage(opaque(nested)))).toBe("complexity_limit");
    expect(code(decodeClientMessage("[".repeat(70) + "0" + "]".repeat(70)))).toBe(
      "complexity_limit",
    );
    expect(
      code(
        encodeClientMessage(
          opaque(Array.from({ length: PROTOCOL_LIMITS.maxCollectionEntries + 1 }, () => 0)),
        ),
      ),
    ).toBe("complexity_limit");
    expect(
      code(snapshotJson(Array.from({ length: 9 }, () => Array.from({ length: 6_000 }, () => 0)))),
    ).toBe("complexity_limit");
  });
});

describe("domain content across snapshots and events", () => {
  const artifactId = "01ARZ3NDEKTSV4000000000003";
  const revisionId = "01ARZ3NDEKTSV4000000000004";
  const payload = { title: "note", markdown: "原記録", author: "author", generatedBy: "human" };
  const artifact = { id: artifactId, projectId, kind: "note", payload, revisionId, version: 1 };
  const revision = {
    id: revisionId,
    artifactId,
    payload,
    author: "author",
    createdAt: project.createdAt,
    version: 1,
  };
  const populatedState = {
    ...state,
    entities: { ...state.entities, artifacts: [artifact], revisions: [revision] },
  };
  const joined = {
    type: "joined",
    mode: "snapshot",
    projectId,
    seq: 3,
    snapshot: populatedState,
    members: [],
  };
  const artifactEvent = {
    ...event,
    events: [
      {
        ...event.events[0],
        type: "artifact.changed",
        before: null,
        after: artifact,
        revisionsBefore: [],
        revisionsAfter: [revision],
      },
    ],
  };
  test("valid known M1 snapshot and artifact event", () => {
    expect(validateServerMessage(joined).ok).toBe(true);
    expect(validateServerMessage(artifactEvent).ok).toBe(true);
  });
  test("known payload cannot bypass strict kind validation in a snapshot or event", () => {
    const bad = { ...artifact, payload: { ...payload, extra: "silently lost?" } };
    expect(
      validateServerMessage({
        ...joined,
        snapshot: { ...populatedState, entities: { ...populatedState.entities, artifacts: [bad] } },
      }).ok,
    ).toBe(false);
    expect(
      validateServerMessage({
        ...artifactEvent,
        events: [{ ...artifactEvent.events[0], after: bad }],
      }).ok,
    ).toBe(false);
    expect(
      validateServerMessage({
        ...artifactEvent,
        events: [
          {
            ...artifactEvent.events[0],
            revisionsAfter: [{ ...revision, payload: { ...payload, extra: true } }],
          },
        ],
      }).ok,
    ).toBe(false);
  });
  test("known M1 snapshot cache/revision integrity and graph references are checked", () => {
    expect(
      validateServerMessage({
        ...joined,
        snapshot: {
          ...populatedState,
          entities: {
            ...populatedState.entities,
            revisions: [{ ...revision, payload: { ...payload, markdown: "different" } }],
          },
        },
      }).ok,
    ).toBe(false);
    expect(
      validateServerMessage({
        ...joined,
        snapshot: { ...populatedState, entities: { ...populatedState.entities, revisions: [] } },
      }).ok,
    ).toBe(false);
    expect(
      validateServerMessage({
        ...joined,
        snapshot: {
          ...populatedState,
          entities: {
            ...populatedState.entities,
            artifacts: [{ ...artifact, projectId: boardId }],
          },
        },
      }).ok,
    ).toBe(false);
  });
  test("future payload retains opaque metadata but does not relax known M1 strictness", () => {
    const futurePayload = {
      unknownFields: { units: "mS/cm", missing: null, aiOrigin: { model: "unchanged" } },
    };
    const future = { ...artifact, kind: "future-table", payload: futurePayload };
    const futureRevision = { ...revision, payload: futurePayload };
    const input = {
      ...joined,
      snapshot: {
        ...populatedState,
        entities: { ...populatedState.entities, artifacts: [future], revisions: [futureRevision] },
      },
    };
    const encoded = encodeServerMessage(input);
    assert(encoded.ok);
    expect(decodeServerMessage(encoded.value)).toMatchObject({ ok: true, value: input });
    const second = {
      ...artifact,
      id: boardId,
      revisionId: commandId,
      payload: { ...payload, extra: true },
    };
    expect(
      validateServerMessage({
        ...input,
        snapshot: {
          ...input.snapshot,
          entities: {
            ...input.snapshot.entities,
            artifacts: [future, second],
            revisions: [
              futureRevision,
              { ...revision, id: commandId, artifactId: boardId, payload: second.payload },
            ],
          },
        },
      }).ok,
    ).toBe(false);
    expect(
      encodeServerMessage({
        ...input,
        snapshot: {
          ...input.snapshot,
          entities: {
            ...input.snapshot.entities,
            artifacts: [{ ...future, payload: { unsafe: NaN } }],
          },
        },
      }).ok,
    ).toBe(false);
  });
  test("a future artifact never bypasses M1 cache, payload references or AI history invariants", () => {
    const futureId = "01ARZ3NDEKTSV4000000000006";
    const futureRevisionId = "01ARZ3NDEKTSV4000000000007";
    const futurePayload = { preserved: { missing: null, unit: "mS/cm" } };
    const future = {
      ...artifact,
      id: futureId,
      revisionId: futureRevisionId,
      kind: "future-table",
      payload: futurePayload,
    };
    const futureRevision = {
      ...revision,
      id: futureRevisionId,
      artifactId: futureId,
      payload: futurePayload,
    };
    const mixed = {
      ...populatedState,
      entities: {
        ...populatedState.entities,
        artifacts: [artifact, future],
        revisions: [revision, futureRevision],
      },
    };
    expect(validateDomainState(mixed).ok).toBe(false);
    expect(validateKnownM1State(mixed).ok).toBe(true);
    expect(validateServerMessage({ ...joined, snapshot: mixed }).ok).toBe(true);
    const stale = {
      ...mixed,
      entities: {
        ...mixed.entities,
        artifacts: [{ ...artifact, payload: { ...payload, markdown: "stale cache" } }, future],
      },
    };
    expect(validateKnownM1State(stale)).toMatchObject({
      ok: false,
      error: { code: "content_integrity_failed" },
    });
    expect(validateServerMessage({ ...joined, snapshot: stale }).ok).toBe(false);
    expect(decodeServerMessage(JSON.stringify({ ...joined, snapshot: stale })).ok).toBe(false);
    const aiPayload = {
      ...payload,
      generatedBy: "ai",
      provenance: {
        id: commandId,
        sourceIds: [],
        createdBy: "generator",
        method: "generation",
        timestamp: project.createdAt,
        originType: "ai",
        generatedBy: "ai",
        modelId: "retained-model",
      },
    };
    const parentId = "01ARZ3NDEKTSV4000000000005";
    const relabelled = {
      ...mixed,
      entities: {
        ...mixed.entities,
        revisions: [
          { ...revision, id: parentId, payload: aiPayload },
          { ...revision, parentId },
          futureRevision,
        ],
      },
    };
    expect(validateKnownM1State(relabelled)).toMatchObject({
      ok: false,
      error: { code: "ai_origin_changed" },
    });
    expect(validateServerMessage({ ...joined, snapshot: relabelled }).ok).toBe(false);
    expect(decodeServerMessage(JSON.stringify({ ...joined, snapshot: relabelled })).ok).toBe(false);
    const framePayload = {
      title: "frame",
      description: "",
      artifactIds: [commandId],
      author: "author",
      generatedBy: "human",
    };
    const missingReference = {
      ...mixed,
      entities: {
        ...mixed.entities,
        artifacts: [{ ...artifact, kind: "frame", payload: framePayload }, future],
        revisions: [{ ...revision, payload: framePayload }, futureRevision],
      },
    };
    expect(validateKnownM1State(missingReference)).toMatchObject({
      ok: false,
      error: { code: "payload_reference_failed" },
    });
    expect(validateServerMessage({ ...joined, snapshot: missingReference }).ok).toBe(false);
  });
  test("AI provenance survives the wire without constructing trusted approval", () => {
    const aiPayload = {
      ...payload,
      generatedBy: "ai",
      provenance: {
        id: commandId,
        sourceIds: [],
        createdBy: "generator",
        method: "generation",
        timestamp: project.createdAt,
        originType: "ai",
        generatedBy: "ai",
        modelId: "model-record",
      },
    };
    const input = {
      ...command,
      command: {
        type: "artifact.create",
        projectId,
        content: { kind: "note", payload: aiPayload },
      },
    };
    const encoded = encodeClientMessage(input);
    assert(encoded.ok);
    expect(decodeClientMessage(encoded.value)).toMatchObject({ ok: true, value: input });
    expect(
      encodeClientMessage({
        ...input,
        command: { ...input.command, aiApproval: { commandId, approvedBy: "me" } },
      }).ok,
    ).toBe(false);
  });
  test("events reject direct Project mismatch and revision owner mismatch", () => {
    expect(validateServerMessage({ ...artifactEvent, projectId: boardId }).ok).toBe(false);
    expect(
      validateServerMessage({
        ...artifactEvent,
        events: [
          { ...artifactEvent.events[0], revisionsAfter: [{ ...revision, artifactId: boardId }] },
        ],
      }).ok,
    ).toBe(false);
    expect(
      validateServerMessage({
        ...event,
        events: [
          {
            ...event.events[0],
            type: "board.changed",
            after: {
              id: boardId,
              projectId: boardId,
              name: "board",
              viewport: { x: 0, y: 0, zoom: 1 },
              version: 1,
            },
          },
        ],
      }).ok,
    ).toBe(false);
  });
  test("only domain command owns baseVersion and project target must agree", () => {
    const input = {
      ...command,
      command: {
        type: "project.update",
        id: projectId,
        baseVersion: 1,
        value: { title: "next", description: "" },
      },
    };
    expect(validateClientMessage(input).ok).toBe(true);
    expect(validateClientMessage({ ...input, baseVersion: 2 }).ok).toBe(false);
    expect(validateClientMessage({ ...input, command: { ...input.command, id: boardId } }).ok).toBe(
      false,
    );
  });
});

describe("additional boundary regression cases", () => {
  test("strict optional keys reject explicit undefined at every nested boundary", () => {
    expect(code(encodeClientMessage({ ...hello, token: undefined }))).toBe("json_unsafe");
    expect(
      code(
        encodeClientMessage({
          type: "presence",
          projectId,
          presence: { ...presence, editingItemId: undefined },
        }),
      ),
    ).toBe("json_unsafe");
  });
  test("receive checks opaque overflow and known invalid content, not only structural schema", () => {
    const encoded = encodeClientMessage(command);
    assert(encoded.ok);
    expect(code(decodeClientMessage(encoded.value.replace('"value":null', '"value":1e999')))).toBe(
      "json_unsafe",
    );
    expect(
      decodeServerMessage(
        JSON.stringify({ ...event, events: [{ ...event.events[0], actor: "forged" }] }),
      ).ok,
    ).toBe(false);
  });
  test("UTF-8 BOM is rejected for string and bytes", () => {
    expect(code(decodeClientMessage("\ufeff" + JSON.stringify(hello)))).toBe("invalid_json");
    expect(
      code(decodeClientMessage(new TextEncoder().encode("\ufeff" + JSON.stringify(hello)))),
    ).toBe("invalid_json");
  });
  test("all named array budgets are explicit", () => {
    expect(
      validateClientMessage({
        type: "presence",
        projectId,
        presence: {
          ...presence,
          selection: Array.from({ length: PROTOCOL_LIMITS.maxSelection + 1 }, () => boardId),
        },
      }).ok,
    ).toBe(false);
    expect(
      validateServerMessage({
        ...event,
        events: Array.from(
          { length: PROTOCOL_LIMITS.maxEventsPerBatch + 1 },
          () => event.events[0],
        ),
      }).ok,
    ).toBe(false);
    expect(
      validateServerMessage({
        type: "joined",
        mode: "events",
        projectId,
        seq: PROTOCOL_LIMITS.maxResumeBatches + 1,
        fromSeq: 0,
        events: Array.from({ length: PROTOCOL_LIMITS.maxResumeBatches + 1 }, (_, index) => ({
          ...event,
          seq: index + 1,
        })),
        members: [],
      }).ok,
    ).toBe(false);
    expect(
      validateServerMessage({
        type: "joined",
        mode: "snapshot",
        projectId,
        seq: 0,
        snapshot: state,
        members: Array.from({ length: PROTOCOL_LIMITS.maxMembers + 1 }, (_, index) => ({
          ...member,
          clientId: String(index),
        })),
      }).ok,
    ).toBe(false);
  });
});
