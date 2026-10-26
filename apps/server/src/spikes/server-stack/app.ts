import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import * as v from "valibot";
import { WebSocketServer } from "ws";

const probeSchema = v.strictObject({ value: v.pipe(v.string(), v.maxLength(1024)) });

// Deliberately separate from the production server and domain repositories.
export const createStackSpike = (databasePath: string) => {
  const database = new DatabaseSync(databasePath);
  database.exec(
    "CREATE TABLE IF NOT EXISTS spike_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT",
  );
  const write = database.prepare(
    "INSERT INTO spike_probe (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
  );
  const read = database.prepare("SELECT value FROM spike_probe WHERE id = 1");
  const sockets = new WebSocketServer({ noServer: true });
  const app = new Hono();
  let closing: Promise<void> | undefined;

  app.use("*", async (context, next) => {
    if (closing !== undefined) return context.json({ error: "closing" }, 503);
    await next();
    return undefined;
  });
  app.get("/api/spike", (context) => {
    const row: unknown = read.get();
    if (row === undefined) return context.json({ error: "not_found" }, 404);
    const result = v.safeParse(probeSchema, row);
    if (!result.success) return context.json({ error: "invalid_stored_probe" }, 500);
    return context.json(result.output);
  });
  app.put(
    "/api/spike",
    bodyLimit({
      // 1024 JSON-escaped UTF-16 code units plus the surrounding object fit in 8 KiB.
      maxSize: 8 * 1024,
      onError: (context) => context.json({ error: "probe_too_large" }, 413),
    }),
    async (context) => {
      const input: unknown = await context.req.json().catch(() => undefined);
      const result = v.safeParse(probeSchema, input);
      if (!result.success) return context.json({ error: "invalid_probe" }, 400);
      if (closing !== undefined) return context.json({ error: "closing" }, 503);
      write.run(result.output.value);
      return context.json(result.output);
    },
  );
  const server = createAdaptorServer({ fetch: app.fetch, overrideGlobalObjects: false });
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const onSocketError = (error: Error): void => {
      console.error("spike upgrade error", error.message);
      socket.destroy();
    };
    // Node's HTTP parser no longer owns this socket after the upgrade event.
    socket.on("error", onSocketError);
    const path = URL.parse(request.url ?? "/", "http://localhost")?.pathname;
    if (closing !== undefined || path !== "/ws") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    socket.off("error", onSocketError);
    sockets.handleUpgrade(request, socket, head, (client) => {
      sockets.emit("connection", client, request);
    });
  });
  sockets.on("connection", (socket) => {
    socket.on("error", (error: Error) => console.error("spike websocket error", error.message));
    socket.on("message", (data, binary) => {
      // Transport echo only; this is not the Room protocol.
      socket.send(Array.isArray(data) ? Buffer.concat(data) : data, { binary });
    });
  });

  const close = (): Promise<void> => {
    closing ??= new Promise<void>((resolve, reject) => {
      sockets.close();
      for (const socket of sockets.clients) socket.terminate();
      server.close((error) => {
        database.close();
        if (error && !("code" in error && error.code === "ERR_SERVER_NOT_RUNNING")) reject(error);
        else resolve();
      });
    });
    return closing;
  };

  return { app, server, close };
};
