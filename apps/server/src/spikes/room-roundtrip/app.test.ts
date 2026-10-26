import { request } from "node:http";
import { performance } from "node:perf_hooks";
import { expect, test, vi } from "vite-plus/test";
import * as v from "valibot";
import { WebSocket, WebSocketServer } from "ws";
import { createRoomSpike, limits } from "./app.ts";
import { outputSchema, type Output } from "./messages.ts";

type Spike = ReturnType<typeof createRoomSpike>;
const listen = async (spike: Spike): Promise<string> => {
  await new Promise<void>((resolve, reject) => {
    spike.server.once("error", reject);
    spike.server.listen(0, "127.0.0.1", resolve);
  });
  const address = spike.server.address();
  if (address === null || typeof address === "string") throw new Error("expected TCP address");
  return `http://127.0.0.1:${address.port}`;
};
const peer = async (url: string, autoPong = true) => {
  const socket = new WebSocket(`${url.replace(/^http/, "ws")}/ws`, { origin: url, autoPong });
  const messages: Output[] = [];
  socket.on("message", (data) => {
    const input: unknown = JSON.parse(Buffer.isBuffer(data) ? data.toString() : "null");
    messages.push(v.parse(outputSchema, input));
  });
  // Retained so expected protocol closes do not create an unhandled error.
  socket.on("error", () => {});
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const next = async (type: Output["type"]): Promise<Output> => {
    await vi.waitFor(() => expect(messages.some((message) => message.type === type)).toBe(true), {
      timeout: 2000,
      interval: 5,
    });
    const index = messages.findIndex((message) => message.type === type);
    const found = messages.splice(index, 1)[0];
    if (found === undefined) throw new Error("missing message");
    return found;
  };
  const send = (input: unknown): void => {
    socket.send(JSON.stringify(input));
  };
  const join = async (projectId: string): Promise<Output> => {
    send({ type: "join", projectId });
    return next("snapshot");
  };
  await next("ready");
  return { socket, messages, next, send, join };
};
const disconnected = (socket: WebSocket): Promise<number> =>
  new Promise((resolve) => {
    socket.once("close", (code) => resolve(code));
  });

test("two real WS clients join, broadcast, leave, isolate rooms, and reconnect to authoritative latest state", async () => {
  const spike = createRoomSpike();
  try {
    const url = await listen(spike);
    const one = await peer(url),
      two = await peer(url),
      other = await peer(url);
    expect(await one.join("project-a")).toMatchObject({
      revision: 0,
      position: { x: 100, y: 100 },
    });
    const secondSnapshot = await two.join("project-a");
    if (secondSnapshot.type !== "snapshot") throw new Error("expected snapshot");
    expect(secondSnapshot.members).toHaveLength(2);
    await other.join("project-b");
    await vi.waitFor(() =>
      expect(
        one.messages.some((message) => message.type === "members" && message.members.length === 2),
      ).toBe(true),
    );
    one.send({ type: "move", requestId: 1, position: { x: 240, y: 190 } });
    expect(await two.next("position")).toMatchObject({
      projectId: "project-a",
      revision: 1,
      position: { x: 240, y: 190 },
    });
    expect(await one.next("ack")).toEqual({ type: "ack", requestId: 1, revision: 1 });
    expect(other.messages.some((message) => message.type === "position")).toBe(false);
    // Leaving does not leave a socket able to mutate its old room.
    two.send({ type: "leave" });
    expect(await two.next("left")).toEqual({ type: "left" });
    two.send({ type: "move", requestId: 2, position: { x: 1, y: 1 } });
    expect(await two.next("reject")).toEqual({ type: "reject", code: "join_required" });
    const closed = disconnected(two.socket);
    two.socket.terminate();
    await closed;
    one.send({ type: "move", requestId: 3, position: { x: 301, y: 201 } });
    await one.next("ack");
    const fresh = await peer(url);
    expect(await fresh.join("project-a")).toMatchObject({
      revision: 2,
      position: { x: 301, y: 201 },
    });
    // Switching rooms removes old membership and cannot select a move target via payload.
    await fresh.join("project-b");
    fresh.send({ type: "move", requestId: 4, position: { x: 77, y: 88 }, projectId: "project-a" });
    expect(await fresh.next("reject")).toMatchObject({ code: "invalid_message" });
    expect(spike.metrics.moves).toBe(2);
    await fresh.join("project-a");
    expect(await fresh.join("project-a")).toMatchObject({
      revision: 2,
      position: { x: 301, y: 201 },
    });
  } finally {
    await spike.close();
  }
});

test("last position survives an empty room; recreation has only synthetic initial state", async () => {
  const spike = createRoomSpike();
  try {
    const url = await listen(spike),
      one = await peer(url);
    await one.join("empty");
    one.send({ type: "move", requestId: 0, position: { x: 20, y: 30 } });
    await one.next("ack");
    const closed = disconnected(one.socket);
    one.socket.terminate();
    await closed;
    const rejoined = await peer(url);
    expect(await rejoined.join("empty")).toMatchObject({ revision: 1, position: { x: 20, y: 30 } });
  } finally {
    await spike.close();
  }
  const recreated = createRoomSpike();
  try {
    const one = await peer(await listen(recreated));
    expect(await one.join("empty")).toMatchObject({ revision: 0, position: { x: 100, y: 100 } });
  } finally {
    await recreated.close();
  }
});

test("native heartbeat removes a no-pong client and broadcasts departure while responsive peer remains", async () => {
  const spike = createRoomSpike({ heartbeatMs: 60 });
  try {
    const url = await listen(spike),
      healthy = await peer(url),
      dead = await peer(url, false);
    await healthy.join("heartbeat");
    await dead.join("heartbeat");
    const gone = disconnected(dead.socket);
    expect(await gone).toBe(1006);
    await vi.waitFor(() =>
      expect(
        healthy.messages.some(
          (message) => message.type === "members" && message.members.length === 1,
        ),
      ).toBe(true),
    );
    expect(healthy.socket.readyState).toBe(WebSocket.OPEN);
    expect(spike.metrics.deadClients).toBe(1);
  } finally {
    await spike.close();
  }
});

test("malformed/extra/nonfinite/out-of-bounds inputs never mutate the room; binary and oversized frames close", async () => {
  const spike = createRoomSpike();
  try {
    const url = await listen(spike),
      one = await peer(url);
    await one.join("validation");
    one.socket.send("{");
    expect(await one.next("reject")).toMatchObject({ code: "invalid_json" });
    for (const input of [
      null,
      [],
      { type: "join", projectId: "../bad" },
      { type: "move", requestId: -1, position: { x: 0, y: 0 } },
      { type: "move", requestId: 0, position: { x: 561, y: 0 } },
      { type: "move", requestId: 0, position: { x: 0, y: 0.5 } },
      { type: "move", requestId: 0, position: { x: null, y: 0 } },
      { type: "move", requestId: 0, position: { x: 0, y: 0, extra: 1 } },
    ]) {
      one.send(input);
      expect(await one.next("reject")).toMatchObject({ code: "invalid_message" });
    }
    one.socket.send('{"type":"move","requestId":0,"position":{"x":1e999,"y":0}}');
    expect(await one.next("reject")).toMatchObject({ code: "invalid_message" });
    expect(spike.metrics.moves).toBe(0);
    const binaryClosed = disconnected(one.socket);
    one.socket.send(Buffer.from([1, 2, 3]));
    expect(await binaryClosed).toBe(1003);
    const huge = await peer(url),
      hugeClosed = disconnected(huge.socket);
    huge.socket.send("x".repeat(limits.payloadBytes + 1));
    expect(await hugeClosed).toBe(1009);
  } finally {
    await spike.close();
  }
});

test("room/member/client bounds and message rate are enforced without changing retained state", async () => {
  const spike = createRoomSpike();
  try {
    const url = await listen(spike),
      peers = await Promise.all(Array.from({ length: limits.members + 1 }, () => peer(url)));
    for (const member of peers.slice(0, limits.members)) await member.join("full");
    const spare = peers[limits.members];
    if (spare === undefined) throw new Error("missing spare");
    spare.send({ type: "join", projectId: "full" });
    expect(await spare.next("reject")).toMatchObject({ code: "member_limit" });
    for (let i = 1; i < limits.rooms; i++) await spare.join(`room-${i}`);
    spare.send({ type: "join", projectId: "overflow" });
    expect(await spare.next("reject")).toMatchObject({ code: "room_limit" });
    // Failure to join leaves its prior room usable.
    spare.send({ type: "move", requestId: 1, position: { x: 7, y: 8 } });
    await spare.next("ack");
    const rateClosed = disconnected(spare.socket);
    for (let i = 0; i <= limits.messagesPerSecond; i++) spare.send({ type: "leave" });
    expect(await rateClosed).toBe(1008);
    await vi.waitFor(async () => {
      const input: unknown = await (await fetch(`${url}/metrics`)).json();
      const metrics = v.parse(v.object({ clients: v.number() }), input);
      expect(metrics.clients).toBe(limits.members);
    });
    const remaining = limits.clients - limits.members;
    for (let i = 0; i < remaining; i++) await peer(url);
    const rejected = new WebSocket(url.replace(/^http/, "ws") + "/ws", { origin: url });
    rejected.on("error", () => {});
    expect(
      await new Promise<number>((resolve) =>
        rejected.once("unexpected-response", (_req, res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
          rejected.terminate();
        }),
      ),
    ).toBe(403);
  } finally {
    await spike.close();
  }
});

test("loopback HTTP Host and Origin and exact WS route guards apply before upgrade", async () => {
  const spike = createRoomSpike();
  try {
    const url = await listen(spike);
    expect((await fetch(url)).status).toBe(200);
    expect((await fetch(url, { headers: { origin: "https://example.invalid" } })).status).toBe(403);
    const hostStatus = await new Promise<number>((resolve, reject) => {
      const outgoing = request(url, { headers: { host: "attacker.invalid" } }, (incoming) => {
        incoming.resume();
        resolve(incoming.statusCode ?? 0);
      });
      outgoing.on("error", reject);
      outgoing.end();
    });
    expect(hostStatus).toBe(403);
    for (const [path, origin] of [
      ["/ws", undefined],
      ["/ws", "https://example.invalid"],
      ["/ws-other", url],
      ["/ws?x=1", url],
    ]) {
      const socket = new WebSocket(
        url.replace(/^http/, "ws") + (path ?? ""),
        origin === undefined ? {} : { origin },
      );
      socket.on("error", () => {});
      const status = await new Promise<number>((resolve, reject) => {
        socket.once("open", () => reject(new Error("unexpected upgrade")));
        socket.once("unexpected-response", (_req, response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
          socket.terminate();
        });
      });
      expect(status).toBe(403);
    }
  } finally {
    await spike.close();
  }
});

test("shutdown closes real sockets, stops heartbeat, and is idempotent", async () => {
  const spike = createRoomSpike({ heartbeatMs: 30 });
  const url = await listen(spike),
    one = await peer(url);
  await one.join("close");
  const gone = disconnected(one.socket);
  await Promise.all([spike.close(), spike.close(), gone]);
  expect(one.socket.readyState).toBe(WebSocket.CLOSED);
  expect(spike.server.listening).toBe(false);
});

test("same-client monotonic ack RTT measurement and frame counts exercise a 20 Hz drag-like trace", async () => {
  const spike = createRoomSpike();
  try {
    const url = await listen(spike),
      one = await peer(url),
      two = await peer(url);
    await one.join("trace");
    await two.join("trace");
    const before = { ...spike.metrics },
      rtt: number[] = [],
      start = performance.now();
    const count = 10;
    for (let i = 0; i < count; i++) {
      const at = performance.now();
      one.send({ type: "move", requestId: i, position: { x: 100 + i, y: 200 } });
      await one.next("ack");
      rtt.push(performance.now() - at);
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.max(0, 50 - (performance.now() - at))),
      );
    }
    const elapsedMs = performance.now() - start;
    expect(spike.metrics.received - before.received).toBe(count);
    expect(spike.metrics.sent - before.sent).toBe(count * 3); // sender position + peer position + sender ack
    expect(spike.metrics.moves - before.moves).toBe(count);
    expect(rtt).toHaveLength(count);
    expect(rtt.every((ms) => Number.isFinite(ms) && ms >= 0)).toBe(true);
    expect(elapsedMs).toBeGreaterThanOrEqual(400);
  } finally {
    await spike.close();
  }
});

test("a slow transport above the outbound byte threshold is terminated without retaining its membership", async () => {
  const spike = createRoomSpike();
  let buffered: { mockRestore: () => void } | undefined;
  let slowServer: WebSocket | undefined;
  // Preserve the original for the interceptor; .call(this, ...) explicitly supplies its receiver.
  // oxlint-disable-next-line typescript/unbound-method
  const originalUpgrade = WebSocketServer.prototype.handleUpgrade;
  const upgrades = vi
    .spyOn(WebSocketServer.prototype, "handleUpgrade")
    .mockImplementation(function (
      this: WebSocketServer,
      incomingRequest,
      transport,
      head,
      callback,
    ) {
      originalUpgrade.call(this, incomingRequest, transport, head, (accepted, incoming) => {
        slowServer ??= accepted;
        callback(accepted, incoming);
      });
    });
  try {
    const url = await listen(spike),
      one = await peer(url),
      two = await peer(url);
    upgrades.mockRestore();
    await one.join("slow");
    await two.join("slow");
    if (slowServer === undefined) throw new Error("missing server-side peer");
    const gone = disconnected(one.socket);
    // Congest exactly one server-side peer; the healthy peer keeps its real getter/transport.
    buffered = vi
      .spyOn(slowServer, "bufferedAmount", "get")
      .mockReturnValue(limits.bufferedBytes + 1);
    one.send({ type: "move", requestId: 0, position: { x: 10, y: 10 } });
    await gone;
    buffered.mockRestore();
    buffered = undefined;
    await vi.waitFor(() =>
      expect(
        two.messages.some((message) => message.type === "members" && message.members.length === 1),
      ).toBe(true),
    );
    expect(two.socket.readyState).toBe(WebSocket.OPEN);
    expect(spike.metrics.backpressure).toBe(1);
    two.send({ type: "move", requestId: 1, position: { x: 11, y: 12 } });
    expect(await two.next("ack")).toMatchObject({ revision: 2 });
    const fresh = await peer(url);
    expect(await fresh.join("slow")).toMatchObject({ revision: 2, position: { x: 11, y: 12 } });
  } finally {
    upgrades.mockRestore();
    buffered?.mockRestore();
    await spike.close();
  }
});
