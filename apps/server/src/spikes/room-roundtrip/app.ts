import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import * as v from "valibot";
import { WebSocket, WebSocketServer } from "ws";
import { clientHtml } from "./client.ts";
import { inputSchema, type Output, type Position } from "./messages.ts";

export const limits = {
  clients: 32,
  rooms: 16,
  members: 8,
  payloadBytes: 2048,
  bufferedBytes: 64 * 1024,
  messagesPerSecond: 120,
  heartbeatMs: 5000,
} as const;

type Client = {
  id: string;
  socket: WebSocket;
  projectId: string | undefined;
  alive: boolean;
  windowStart: number;
  received: number;
  joined: boolean;
  connectedAt: number;
};
type Room = { position: Position; revision: number; members: Set<Client> };

// Disposable in-memory experiment, deliberately separate from the production protocol/domain.
export const createRoomSpike = (options: { heartbeatMs?: number } = {}) => {
  const clients = new Set<Client>();
  const rooms = new Map<string, Room>();
  const metrics = { received: 0, moves: 0, sent: 0, deadClients: 0, backpressure: 0 };
  const sockets = new WebSocketServer({ noServer: true, maxPayload: limits.payloadBytes });
  const app = new Hono();
  let closing: Promise<void> | undefined;

  const trusted = (host: string | undefined, origin: string | undefined): boolean => {
    const address = server.address();
    if (address === null || typeof address === "string") return false;
    return (
      (host === `127.0.0.1:${address.port}` || host === `localhost:${address.port}`) &&
      (origin === undefined || origin === `http://${host}`)
    );
  };
  app.use("*", async (context, next) => {
    if (!trusted(context.req.header("host"), context.req.header("origin"))) {
      return context.text("Loopback Host / same-origin required", 403);
    }
    if (closing !== undefined) return context.text("closing", 503);
    context.header("Cache-Control", "no-store");
    context.header("X-Content-Type-Options", "nosniff");
    context.header(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    await next();
    return undefined;
  });
  app.get("/", (context) => context.html(clientHtml));
  app.get("/metrics", (context) =>
    context.json({ ...metrics, clients: clients.size, rooms: rooms.size }),
  );
  const server = createAdaptorServer({ fetch: app.fetch, overrideGlobalObjects: false });

  const send = (client: Client, output: Output): void => {
    if (client.socket.readyState !== WebSocket.OPEN) return;
    if (client.socket.bufferedAmount > limits.bufferedBytes) {
      metrics.backpressure += 1;
      client.socket.terminate();
      return;
    }
    metrics.sent += 1;
    client.socket.send(JSON.stringify(output));
  };
  const broadcast = (room: Room, output: Output): void => {
    for (const client of room.members) send(client, output);
  };
  const memberIds = (room: Room): string[] => [...room.members].map((member) => member.id);
  const leave = (client: Client): void => {
    const projectId = client.projectId;
    client.projectId = undefined;
    if (projectId === undefined) return;
    const room = rooms.get(projectId);
    if (room === undefined) return;
    room.members.delete(client);
    broadcast(room, { type: "members", projectId, members: memberIds(room) });
    // Keep the last position while this process runs, including when the room becomes empty.
  };

  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const onError = (): void => {
      socket.destroy();
    };
    socket.on("error", onError);
    if (
      closing !== undefined ||
      request.url !== "/ws" ||
      request.headers.origin === undefined ||
      !trusted(request.headers.host, request.headers.origin) ||
      clients.size >= limits.clients
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    socket.off("error", onError);
    sockets.handleUpgrade(request, socket, head, (accepted) =>
      sockets.emit("connection", accepted),
    );
  });
  sockets.on("connection", (socket: WebSocket) => {
    const client: Client = {
      id: randomUUID(),
      socket,
      projectId: undefined,
      alive: true,
      windowStart: performance.now(),
      received: 0,
      joined: false,
      connectedAt: performance.now(),
    };
    clients.add(client);
    socket.on("error", () => {
      socket.terminate();
    });
    socket.on("close", () => {
      clients.delete(client);
      leave(client);
    });
    socket.on("pong", () => {
      client.alive = true;
    });
    socket.on("message", (bytes, binary) => {
      metrics.received += 1;
      const now = performance.now();
      if (now - client.windowStart >= 1000) {
        client.windowStart = now;
        client.received = 0;
      }
      client.received += 1;
      if (client.received > limits.messagesPerSecond) {
        socket.close(1008, "message rate");
        return;
      }
      if (binary) {
        socket.close(1003, "text JSON required");
        return;
      }
      let input: unknown;
      try {
        const buffer = Array.isArray(bytes)
          ? Buffer.concat(bytes)
          : Buffer.isBuffer(bytes)
            ? bytes
            : Buffer.from(bytes);
        input = JSON.parse(buffer.toString());
      } catch {
        send(client, { type: "reject", code: "invalid_json" });
        return;
      }
      const parsed = v.safeParse(inputSchema, input);
      if (!parsed.success) {
        send(client, { type: "reject", code: "invalid_message" });
        return;
      }
      const message = parsed.output;
      if (message.type === "leave") {
        leave(client);
        send(client, { type: "left" });
        return;
      }
      if (message.type === "join") {
        const existing = rooms.get(message.projectId);
        if (existing === undefined && rooms.size >= limits.rooms) {
          send(client, { type: "reject", code: "room_limit" });
          return;
        }
        if (
          existing !== undefined &&
          existing.members.size >= limits.members &&
          !existing.members.has(client)
        ) {
          send(client, { type: "reject", code: "member_limit" });
          return;
        }
        leave(client);
        const room: Room = existing ?? {
          position: { x: 100, y: 100 },
          revision: 0,
          members: new Set(),
        };
        rooms.set(message.projectId, room);
        client.projectId = message.projectId;
        client.joined = true;
        room.members.add(client);
        send(client, {
          type: "snapshot",
          projectId: message.projectId,
          revision: room.revision,
          position: room.position,
          members: memberIds(room),
        });
        broadcast(room, {
          type: "members",
          projectId: message.projectId,
          members: memberIds(room),
        });
        return;
      }
      const room = client.projectId === undefined ? undefined : rooms.get(client.projectId);
      if (room === undefined || client.projectId === undefined) {
        send(client, { type: "reject", code: "join_required" });
        return;
      }
      room.position = message.position;
      room.revision += 1;
      metrics.moves += 1;
      broadcast(room, {
        type: "position",
        projectId: client.projectId,
        revision: room.revision,
        position: room.position,
        actor: client.id,
      });
      send(client, { type: "ack", requestId: message.requestId, revision: room.revision });
    });
    send(client, { type: "ready", connectionId: client.id });
  });
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (
        !client.alive ||
        (!client.joined && performance.now() - client.connectedAt > limits.heartbeatMs)
      ) {
        metrics.deadClients += 1;
        client.socket.terminate();
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }, options.heartbeatMs ?? limits.heartbeatMs);
  heartbeat.unref();

  const close = (): Promise<void> => {
    closing ??= new Promise<void>((resolve, reject) => {
      clearInterval(heartbeat);
      sockets.close();
      for (const client of clients) client.socket.terminate();
      server.close((error) => {
        clients.clear();
        rooms.clear();
        if (error && !("code" in error && error.code === "ERR_SERVER_NOT_RUNNING")) reject(error);
        else resolve();
      });
    });
    return closing;
  };
  return { server, close, metrics };
};
