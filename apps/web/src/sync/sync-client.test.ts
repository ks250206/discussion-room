import { IdSchema, validate, type Id } from "@discussion-room/domain";
import { decodeClientMessage, type ClientMessage } from "@discussion-room/protocol";
import { afterEach, assert, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { createSyncClient } from "./sync-client.ts";

function fixtureId(suffix: string): Id {
  const result = validate(IdSchema, `01ARZ3NDEKTSV40000000000${suffix}`);
  assert(result.ok);
  return result.value;
}

const projectId = fixtureId("01");
const commandId = fixtureId("10");
const nextId = fixtureId("11");
const actor = "client-1";
const timestamp = "2026-10-27T00:00:00Z";
const project = { id: projectId, title: "研究", description: "", createdAt: timestamp, version: 1 };
const member = { clientId: actor, displayName: "研究者" };
const board = {
  id: fixtureId("02"),
  projectId,
  name: "board",
  version: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
};

const update = (title: string, baseVersion = 1) =>
  ({
    type: "project.update",
    id: projectId,
    baseVersion,
    value: { title, description: "" },
  }) as const;

function snapshot(current = project, seq = 0) {
  return {
    type: "joined",
    mode: "snapshot",
    projectId,
    seq,
    members: [member],
    snapshot: {
      entities: {
        projects: [current],
        boards: [board],
        artifacts: [],
        revisions: [],
        canvasItems: [],
      },
      itemPorts: [],
      semanticRelations: [],
      dataflowEdges: [],
      visualConnectors: [],
    },
  };
}

function batch(seq: number, id: Id, before: typeof project, after: typeof project) {
  return {
    type: "event",
    projectId,
    seq,
    commandId: id,
    actor,
    events: [
      { type: "project.changed", commandId: id, actor, timestamp, origin: "human", before, after },
    ],
  };
}

type MockEvents = { open: Event; message: MessageEvent<unknown>; close: CloseEvent };
type MockListeners = { [K in keyof MockEvents]: (event: MockEvents[K]) => void };

class MockSocket {
  private readonly listeners: Partial<MockListeners> = {};
  readyState = 0;
  readonly sent: ClientMessage[] = [];

  addEventListener<K extends keyof MockEvents>(type: K, listener: MockListeners[K]) {
    this.listeners[type] = listener;
  }

  send(text: string): void {
    const decoded = decodeClientMessage(text);
    assert(decoded.ok);
    this.sent.push(decoded.value);
  }

  open(): void {
    this.readyState = 1;
    this.listeners.open?.(new Event("open"));
  }

  receive(input: unknown): void {
    this.listeners.message?.(new MessageEvent("message", { data: JSON.stringify(input) }));
  }

  close(code = 1000): void {
    this.readyState = 3;
    this.listeners.close?.(new CloseEvent("close", { code }));
  }
}

function setup() {
  const sockets: MockSocket[] = [];
  const client = createSyncClient({
    projectId,
    clientId: actor,
    displayName: member.displayName,
    url: "ws://localhost/ws",
    createSocket: () => {
      const socket = new MockSocket();
      sockets.push(socket);
      return socket;
    },
  });
  const socketAt = (index: number): MockSocket => {
    const socket = sockets[index];
    assert(socket);
    return socket;
  };
  const read = client.store.getState;
  const title = () => read().snapshot?.entities.projects[0]?.title;
  const open = () => {
    client.start();
    const socket = socketAt(0);
    socket.open();
    socket.receive(snapshot());
    return socket;
  };
  return { client, sockets, socketAt, open, read, title };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("WebSocket sync store", () => {
  test("joins and applies optimistic updates, then rolls back only the rejected command", () => {
    const { client, open, read, title } = setup();
    const socket = open();
    expect(socket.sent).toEqual([
      { type: "hello", protocolVersion: 1, ...member },
      { type: "join", projectId },
    ]);
    expect(read()).toMatchObject({ connection: "connected", members: [member] });
    expect(client.submit(commandId, update("first")).ok).toBe(true);
    expect(client.submit(nextId, update("second", 2)).ok).toBe(true);
    expect(title()).toBe("second");
    expect(read().checkpoint?.snapshot.entities.projects[0]?.title).toBe("研究");

    const rejected = {
      type: "reject",
      commandId: nextId,
      code: "version_conflict",
      message: "Conflict",
    };
    socket.receive(rejected);
    expect(title()).toBe("first");
    expect(read().pendingCommands).toEqual([{ commandId, command: update("first") }]);
    expect(read().rejection).toEqual(rejected);
    client.clearRejection();
    expect(read().rejection).toBeNull();
  });

  test("holds the optimistic view until the authoritative event covers the ACK", () => {
    const { client, open, read, title } = setup();
    const socket = open();
    client.submit(commandId, update("optimistic"));
    socket.receive({ type: "ack", commandId, seq: 1 });
    expect(title()).toBe("optimistic");
    expect(read().pendingCommands).toHaveLength(1);
    const committed = batch(1, commandId, project, { ...project, title: "committed", version: 2 });
    socket.receive(committed);
    expect(title()).toBe("committed");
    expect(read().pendingCommands).toEqual([]);
    socket.receive(committed);
    expect(read().checkpoint?.seq).toBe(1);
  });

  test("backs off exponentially, ignores retired sockets, and clears a pending command found by resume", () => {
    const { client, open, read, socketAt, sockets, title } = setup();
    const socket = open();
    const first = { ...project, title: "first", version: 2 };
    socket.receive(batch(1, nextId, project, first));
    client.submit(commandId, update("pending", 2));
    socket.close(1006);
    expect(read().connection).toBe("reconnecting");
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    socketAt(1).close(1006);
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    const reconnect = socketAt(2);
    reconnect.open();
    expect(reconnect.sent.at(-1)).toEqual({ type: "join", projectId, lastSeq: 1 });
    socket.receive({ type: "reject", commandId, code: "version_conflict", message: "stale" });
    expect(title()).toBe("pending");
    reconnect.receive({
      type: "joined",
      mode: "events",
      projectId,
      fromSeq: 1,
      seq: 2,
      members: [],
      events: [batch(2, commandId, first, { ...first, title: "resumed", version: 3 })],
    });
    expect(title()).toBe("resumed");
    expect(read().pendingCommands).toEqual([]);
    expect(reconnect.sent).toHaveLength(2);

    reconnect.close(1006);
    vi.advanceTimersByTime(1_999);
    expect(sockets).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(4);
    client.stop();
    vi.advanceTimersByTime(15_000);
    expect(read().connection).toBe("idle");
    expect(sockets).toHaveLength(4);
  });

  test("resends an unresolved command with the same ID and answers heartbeat after a snapshot fallback", () => {
    const { client, open, read, socketAt, title } = setup();
    const socket = open();
    client.submit(commandId, update("before disconnect"));
    socket.close(1006);
    vi.advanceTimersByTime(500);
    const reconnect = socketAt(1);
    reconnect.open();
    reconnect.receive(snapshot({ ...project, title: "in snapshot", version: 2 }, 1));
    expect(reconnect.sent.at(-1)).toEqual(socket.sent.at(-1));
    expect(title()).toBe("in snapshot");
    reconnect.receive({ type: "ack", commandId, seq: 1 });
    expect(read().pendingCommands).toHaveLength(0);
    reconnect.receive({ type: "ping", nonce: "alive" });
    expect(reconnect.sent.at(-1)).toEqual({ type: "pong", nonce: "alive" });
  });

  test("temporarily hides a provisional create when a newer snapshot may contain it", () => {
    const { client, open, read, socketAt } = setup();
    const socket = open();
    const value = { projectId, name: "new board", viewport: board.viewport };
    expect(client.submit(commandId, { type: "board.create", value }).ok).toBe(true);
    expect(read().snapshot?.entities.boards).toHaveLength(2);
    socket.close(1006);
    vi.advanceTimersByTime(500);
    const reconnect = socketAt(1);
    reconnect.open();
    const recovered = snapshot(project, 1);
    reconnect.receive({
      ...recovered,
      snapshot: {
        ...recovered.snapshot,
        entities: {
          ...recovered.snapshot.entities,
          boards: [board, { ...value, id: fixtureId("03"), version: 1 }],
        },
      },
    });
    expect(read().snapshot?.entities.boards.map((entry) => entry.id)).toEqual([
      board.id,
      fixtureId("03"),
    ]);
    expect(read().pendingCommands).toHaveLength(1);
    expect(reconnect.sent.at(-1)).toEqual(socket.sent.at(-1));
  });

  test("refreshes after a version rejection while preserving a disjoint pending update", () => {
    const { client, open, read, title } = setup();
    const socket = open();
    client.submit(commandId, update("stale edit"));
    expect(
      client.submit(nextId, {
        type: "board.update",
        id: board.id,
        baseVersion: 1,
        value: { name: "pending board", viewport: board.viewport },
      }).ok,
    ).toBe(true);
    socket.receive({
      type: "reject",
      commandId,
      code: "version_conflict",
      message: "Conflict",
      current: { version: 2 },
    });
    expect(title()).toBe("研究");
    expect(read().connection).toBe("synchronizing");
    expect(socket.sent.at(-1)).toEqual({ type: "join", projectId });
    socket.receive(snapshot({ ...project, title: "current", version: 2 }, 1));
    expect(title()).toBe("current");
    expect(read().snapshot?.entities.boards[0]?.name).toBe("pending board");
    expect(read().pendingCommands.map((command) => command.commandId)).toEqual([nextId]);
    expect(read().rejection?.current?.version).toBe(2);
  });

  test("requests resume on a sequence gap without accepting the out-of-order batch", () => {
    const { open, read, title } = setup();
    const socket = open();
    const next = { ...project, title: "later", version: 2 };
    socket.receive(batch(2, commandId, project, next));
    expect(socket.sent.at(-1)).toEqual({ type: "join", projectId, lastSeq: 0 });
    expect(read().connection).toBe("synchronizing");
    expect(title()).toBe("研究");
    socket.receive(snapshot(next, 2));
    expect(read().connection).toBe("connected");
    expect(title()).toBe("later");
  });

  test("preserves the checkpoint while recovering from an invalid batch, including after reconnect", () => {
    const { client, open, read, socketAt, title } = setup();
    const socket = open();
    const invalid = batch(1, commandId, project, project);
    socket.receive({
      ...invalid,
      events: invalid.events.map((event) => ({ ...event, after: null })),
    });
    expect(socket.sent.at(-1)).toEqual({ type: "join", projectId });
    expect(read().connection).toBe("synchronizing");
    expect(read().checkpoint?.seq).toBe(0);
    expect(title()).toBe("研究");

    socket.close(1006);
    vi.advanceTimersByTime(500);
    const reconnect = socketAt(1);
    reconnect.open();
    expect(reconnect.sent.at(-1)).toEqual({ type: "join", projectId });
    expect(client.submit(nextId, update("queued during refresh")).ok).toBe(true);
    expect(title()).toBe("queued during refresh");
    reconnect.receive(snapshot());
    expect(reconnect.sent.at(-1)).toMatchObject({ type: "command", commandId: nextId });
  });

  test("resets retry delay after a sustained connection", () => {
    const { open, socketAt, sockets } = setup();
    open().close(1006);
    vi.advanceTimersByTime(500);
    const reconnect = socketAt(1);
    reconnect.open();
    reconnect.receive(snapshot());
    vi.advanceTimersByTime(15_000);
    reconnect.close(1006);
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
  });

  test("retries when an open socket never answers join", () => {
    const { client, read, socketAt, sockets } = setup();
    client.start();
    socketAt(0).open();
    vi.advanceTimersByTime(10_000);
    expect(read().connection).toBe("reconnecting");
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
  });

  test("does not resend an acknowledged command when the resumed snapshot covers it", () => {
    const { client, open, read, socketAt, title } = setup();
    const socket = open();
    client.submit(commandId, update("awaiting event"));
    socket.receive({ type: "ack", commandId, seq: 1 });
    socket.close(1006);
    vi.advanceTimersByTime(500);
    const reconnect = socketAt(1);
    reconnect.open();
    reconnect.receive(snapshot({ ...project, title: "committed", version: 2 }, 1));
    expect(reconnect.sent).toHaveLength(2);
    expect(read().pendingCommands).toHaveLength(0);
    expect(title()).toBe("committed");
  });

  test("queues edits during a transient disconnect and enforces the pending limit", () => {
    const { client, open, read, socketAt, title } = setup();
    const socket = open();
    socket.close(1006);
    for (let index = 0; index < 16; index += 1) {
      const command = fixtureId((index + 16).toString(16).toUpperCase());
      expect(client.submit(command, update(`offline ${index}`, index + 1)).ok).toBe(true);
    }
    expect(client.submit(fixtureId("20"), update("over limit", 17))).toEqual({
      ok: false,
      error: { code: "queue_full" },
    });
    expect(title()).toBe("offline 15");
    expect(socket.sent).toHaveLength(2);
    vi.advanceTimersByTime(500);
    const reconnect = socketAt(1);
    reconnect.open();
    reconnect.receive(snapshot());
    expect(reconnect.sent.filter((message) => message.type === "command")).toHaveLength(16);
    expect(read().pendingCommands).toHaveLength(16);
  });

  test("a policy close ends retries, and stop/start isolates StrictMode effect generations", () => {
    const { client, open, read, socketAt, sockets } = setup();
    const first = open();
    client.stop();
    client.start();
    const second = socketAt(1);
    second.open();
    first.close(1006);
    second.close(1008);
    vi.advanceTimersByTime(30_000);
    expect(sockets).toHaveLength(2);
    expect(read().connection).toBe("failed");
  });
});
