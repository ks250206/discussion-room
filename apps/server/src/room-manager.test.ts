import { once } from "node:events";
import type { Server } from "node:http";
import {
  decodeServerMessage,
  PROTOCOL_VERSION,
  PRESENCE_TTL_MS,
  type ServerMessage,
} from "@discussion-room/protocol";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { WebSocket, type RawData } from "ws";
import { createAppServer, type AppOptions } from "./app.ts";
import { openSqliteRepository, type Repository } from "./repository/index.ts";

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G${String(n).padStart(4, "0")}`;
const projectId = id(1);
const boardId = id(2);
const itemId = id(3);
const otherProjectId = id(11);
const otherBoardId = id(12);
const createdAt = "2026-10-27T01:02:03.000Z";

function seed(repository: Repository, offset: number): void {
  expect(
    repository.commit({
      projectId: id(offset + 1),
      expectedSeq: 0,
      state: {
        schemaVersion: 1,
        graph: {
          entities: {
            projects: [
              { id: id(offset + 1), title: "Project", description: "", version: 1, createdAt },
            ],
            boards: [
              {
                id: id(offset + 2),
                projectId: id(offset + 1),
                name: "Board",
                version: 1,
                viewport: { x: 0, y: 0, zoom: 1 },
              },
            ],
            artifacts: [],
            revisions: [],
            canvasItems: [
              {
                id: id(offset + 3),
                boardId: id(offset + 2),
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                viewState: {},
                version: 1,
              },
            ],
          },
          itemPorts: [],
          semanticRelations: [],
          dataflowEdges: [],
          visualConnectors: [],
        },
        blobs: [],
        executionRecords: [],
        provenance: [],
        snapshots: [],
      },
      event: { commandId: id(offset + 4), actor: "fixture", createdAt, payload: {} },
      audit: { reason: "fixture", payload: {} },
    }),
  ).toEqual({ ok: true, value: { seq: 1 } });
}

let app: Server | undefined;
let repository: Repository | undefined;
let port: number;
afterEach(async () => {
  try {
    if (app)
      await new Promise<void>((resolve, reject) =>
        app?.close((error) => (error ? reject(error) : resolve())),
      );
  } finally {
    repository?.close();
    repository = undefined;
    app = undefined;
  }
});

async function start(options?: AppOptions): Promise<Repository> {
  const opened = openSqliteRepository(":memory:");
  if (!opened.ok) throw new Error(opened.error.code);
  repository = opened.value;
  seed(repository, 0);
  seed(repository, 10);
  const server = createAppServer({ ...options, repository });
  app = server;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP address");
  port = address.port;
  return repository;
}

function send(socket: WebSocket, message: unknown): void {
  socket.send(JSON.stringify(message));
}

async function connect(clientId?: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await once(socket, "open");
  if (clientId !== undefined) {
    send(socket, {
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      clientId,
      displayName: clientId,
    });
  }
  return socket;
}

function next(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const receive = (data: RawData): void => {
      const decoded = decodeServerMessage(
        Array.isArray(data) ? Buffer.concat(data) : new Uint8Array(data),
      );
      if (decoded.ok && decoded.value.type === "ping") return;
      socket.off("message", receive);
      if (decoded.ok) resolve(decoded.value);
      else reject(new Error(decoded.error.code));
    };
    socket.on("message", receive);
  });
}

function join(socket: WebSocket, target = projectId, lastSeq?: number): Promise<ServerMessage> {
  const reply = next(socket);
  send(socket, { type: "join", projectId: target, lastSeq });
  return reply;
}

function presence(socket: WebSocket, target = projectId, board = boardId): void {
  send(socket, {
    type: "presence",
    projectId: target,
    presence: {
      boardId: board,
      cursor: { x: 1, y: 2 },
      selection: [itemId],
      editingItemId: itemId,
    },
  });
}

function closeCode(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once("close", resolve));
}

async function barrier(socket: WebSocket): Promise<void> {
  const reply = next(socket);
  send(socket, { type: "ping", nonce: "barrier" });
  expect(await reply).toEqual({ type: "pong", nonce: "barrier" });
}

test("isolates projects, relays accepted presence, and releases the room on departure", async () => {
  const store = await start();
  const alice = await connect("Alice");
  const bob = await connect("Bob");
  const carol = await connect("Carol");
  expect(await join(alice)).toMatchObject({
    type: "joined",
    mode: "snapshot",
    projectId,
    seq: 1,
    members: [{ clientId: "Alice" }],
  });
  const joined = next(alice);
  expect(await join(bob, projectId, 1)).toMatchObject({
    type: "joined",
    mode: "events",
    projectId,
    fromSeq: 1,
    seq: 1,
    events: [],
    members: [
      { clientId: "Bob", displayName: "Bob" },
      { clientId: "Alice", displayName: "Alice" },
    ],
  });
  expect(await joined).toMatchObject({
    type: "member",
    action: "joined",
    member: { clientId: "Bob" },
  });
  expect(await join(carol, otherProjectId)).toMatchObject({
    type: "joined",
    projectId: otherProjectId,
    members: [{ clientId: "Carol", displayName: "Carol" }],
  });

  const unexpectedInOtherRoom: unknown[] = [];
  carol.on("message", (data) => unexpectedInOtherRoom.push(data));
  const resyncTraffic: unknown[] = [];
  const observeResync = (data: unknown) => resyncTraffic.push(data);
  alice.on("message", observeResync);
  expect(await join(bob, projectId, 1)).toMatchObject({ type: "joined", mode: "events", seq: 1 });
  await barrier(alice);
  alice.off("message", observeResync);
  expect(resyncTraffic).toHaveLength(1);

  const validTraffic: unknown[] = [];
  const observePresence = (data: unknown) => validTraffic.push(data);
  bob.on("message", observePresence);
  presence(alice, otherProjectId);
  presence(alice, projectId, otherBoardId);
  await barrier(alice);
  await barrier(bob);
  bob.off("message", observePresence);
  expect(validTraffic).toHaveLength(1);

  const aliceEcho = next(alice);
  const bobRelay = next(bob);
  presence(alice);
  const accepted = await bobRelay;
  expect(accepted).toEqual(await aliceEcho);
  expect(accepted).toMatchObject({
    type: "presence",
    clientId: "Alice",
    presence: { editingItemId: itemId },
  });
  const denied = next(bob);
  const deniedRelay = next(alice);
  presence(bob);
  expect(await deniedRelay).toEqual(await denied);
  expect(await denied).toEqual({
    type: "presence",
    projectId,
    clientId: "Bob",
    presence: { boardId, cursor: { x: 1, y: 2 }, selection: [itemId] },
  });
  expect(unexpectedInOtherRoom).toHaveLength(0);

  const left = next(bob);
  alice.close();
  expect(await left).toMatchObject({
    type: "member",
    action: "left",
    member: { clientId: "Alice" },
  });
  const acquired = next(bob);
  presence(bob);
  expect(await acquired).toMatchObject({
    type: "presence",
    clientId: "Bob",
    presence: { editingItemId: itemId },
  });

  const carolUpdate = next(carol);
  expect(await join(bob, otherProjectId)).toMatchObject({
    type: "joined",
    projectId: otherProjectId,
  });
  expect(await carolUpdate).toMatchObject({
    type: "member",
    action: "joined",
    member: { clientId: "Bob" },
  });
  const returned = await connect("Returned");
  expect(await join(returned)).toMatchObject({
    type: "joined",
    mode: "snapshot",
    seq: 1,
    members: [{ clientId: "Returned", displayName: "Returned" }],
  });
  const newLock = next(returned);
  presence(returned);
  expect(await newLock).toMatchObject({ type: "presence", presence: { editingItemId: itemId } });
  expect(store.eventsAfter(projectId, 0)).toMatchObject({ ok: true, value: [{ seq: 1 }] });
});

test("enforces hello, unique room identity, project existence, and command scope", async () => {
  await start();
  const noHello = await connect();
  const noHelloClose = closeCode(noHello);
  send(noHello, { type: "join", projectId });
  expect(await noHelloClose).toBe(1008);

  const wrongVersion = await connect();
  const wrongVersionClose = closeCode(wrongVersion);
  send(wrongVersion, {
    type: "hello",
    clientId: "version",
    displayName: "version",
    protocolVersion: 999,
  });
  expect(await wrongVersionClose).toBe(1002);

  const missing = await connect("Missing");
  const missingClose = closeCode(missing);
  send(missing, { type: "join", projectId: id(99) });
  expect(await missingClose).toBe(1008);

  const alice = await connect("Alice");
  const command = (target: string) => ({
    type: "command",
    projectId: target,
    commandId: id(100),
    command: { type: "project.delete", id: target, baseVersion: 1 },
  });
  const beforeJoin = next(alice);
  send(alice, command(projectId));
  expect(await beforeJoin).toMatchObject({ type: "reject", code: "not_joined" });
  await join(alice);
  const duplicate = await connect("Alice");
  const duplicateClose = closeCode(duplicate);
  send(duplicate, { type: "join", projectId });
  expect(await duplicateClose).toBe(1013);
  const wrongRoom = next(alice);
  send(alice, command(otherProjectId));
  expect(await wrongRoom).toMatchObject({ type: "reject", code: "project_mismatch" });
  const unavailable = next(alice);
  send(alice, command(projectId));
  expect(await unavailable).toMatchObject({ type: "reject", code: "forbidden" });
});

test("matching heartbeat pong keeps a client connected and a wrong pong times out", async () => {
  await start({ heartbeatIntervalMs: 100, heartbeatTimeoutMs: 100 });
  const alice = await connect("Alice");
  const bob = await connect("Bob");
  const bobClose = closeCode(bob);
  const left = new Promise<void>((resolve) => {
    alice.on("message", (data) => {
      const frame = decodeServerMessage(
        Array.isArray(data) ? Buffer.concat(data) : new Uint8Array(data),
      );
      if (frame.ok && frame.value.type === "ping")
        send(alice, { type: "pong", nonce: frame.value.nonce });
      if (frame.ok && frame.value.type === "member" && frame.value.action === "left") resolve();
    });
  });
  bob.on("message", (data) => {
    const frame = decodeServerMessage(
      Array.isArray(data) ? Buffer.concat(data) : new Uint8Array(data),
    );
    if (frame.ok && frame.value.type === "ping") send(bob, { type: "pong", nonce: "wrong" });
  });
  await join(alice);
  await join(bob);
  expect(await bobClose).toBe(1006);
  await left;
  await barrier(alice);
  const reconnected = await connect("Bob");
  expect(await join(reconnected, projectId, 1)).toMatchObject({ type: "joined", mode: "events" });
});

test("expires presence while its sender remains connected", async () => {
  let time = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => time);
  try {
    await start();
    const alice = await connect("Alice");
    const bob = await connect("Bob");
    await join(alice);
    await join(bob);
    const initial = next(bob);
    presence(alice);
    expect(await initial).toMatchObject({
      type: "presence",
      clientId: "Alice",
      presence: { editingItemId: itemId },
    });

    const expired = next(bob);
    time += PRESENCE_TTL_MS;
    expect(await expired).toEqual({
      type: "presence",
      projectId,
      clientId: "Alice",
      presence: { boardId, selection: [] },
    });
    const acquired = next(bob);
    presence(bob);
    expect(await acquired).toMatchObject({
      type: "presence",
      clientId: "Bob",
      presence: { editingItemId: itemId },
    });
    await barrier(alice);
  } finally {
    clock.mockRestore();
  }
});

test("sends joined before the live presence and edit lock of an existing member", async () => {
  await start();
  const alice = await connect("Alice");
  await join(alice);
  const accepted = next(alice);
  presence(alice);
  expect(await accepted).toMatchObject({
    type: "presence",
    clientId: "Alice",
    presence: { editingItemId: itemId },
  });

  const bob = await connect("Bob");
  const received = await new Promise<ServerMessage[]>((resolve, reject) => {
    const messages: ServerMessage[] = [];
    const receive = (data: RawData): void => {
      const frame = decodeServerMessage(
        Array.isArray(data) ? Buffer.concat(data) : new Uint8Array(data),
      );
      if (!frame.ok) {
        bob.off("message", receive);
        reject(new Error(frame.error.code));
        return;
      }
      messages.push(frame.value);
      if (messages.length === 2) {
        bob.off("message", receive);
        resolve(messages);
      }
    };
    bob.on("message", receive);
    send(bob, { type: "join", projectId });
  });
  expect(received[0]).toMatchObject({ type: "joined", projectId, seq: 1 });
  expect(received[1]).toMatchObject({
    type: "presence",
    projectId,
    clientId: "Alice",
    presence: { editingItemId: itemId },
  });
  const denied = next(bob);
  presence(bob);
  expect(await denied).toEqual({
    type: "presence",
    projectId,
    clientId: "Bob",
    presence: { boardId, cursor: { x: 1, y: 2 }, selection: [itemId] },
  });
});
