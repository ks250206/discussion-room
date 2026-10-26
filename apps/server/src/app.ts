import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { validateBoundary } from "./boundary.ts";
import { devWebSocketPath } from "./config.ts";
import { writeLog, type Logger } from "./log.ts";
import { isNavigation, serveFile } from "./static.ts";

export type HealthResponse = { status: "ok" };
export type AppOptions = {
  development?: boolean;
  webRoot?: string;
  pyodideRoot?: string;
  logger?: Logger;
  shutdownTimeoutMs?: number;
};

export const createAppServer = (options: AppOptions = {}): Server => {
  const logger = options.logger ?? writeLog;
  const app = new Hono();
  app.get("/api/health", (context) => context.json({ status: "ok" } satisfies HealthResponse));
  app.all("/api/health", (context) => {
    context.header("Allow", "GET, HEAD");
    return context.json({ error: "method_not_allowed" }, 405);
  });
  app.all("*", async (context) => {
    const pathname = decodeURIComponent(new URL(context.req.url).pathname);
    const reserved = ["/api", "/ws"].some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
    if (reserved) return context.json({ error: "not_found" }, 404);
    if (context.req.method !== "GET" && context.req.method !== "HEAD") {
      context.header("Allow", "GET, HEAD");
      return context.json({ error: "method_not_allowed" }, 405);
    }
    const pyodide = pathname === "/pyodide" || pathname.startsWith("/pyodide/");
    if (pyodide) {
      const file =
        options.pyodideRoot === undefined
          ? undefined
          : await serveFile(context, options.pyodideRoot, pathname.slice("/pyodide/".length));
      return file ?? context.json({ error: "not_found" }, 404);
    }
    if (options.webRoot !== undefined) {
      const file = await serveFile(
        context,
        options.webRoot,
        pathname === "/" ? "index.html" : pathname.slice(1),
      );
      if (file !== undefined) return file;
      // Asset directories never become an HTML success, even for extension-less assets.
      if (
        pathname !== "/assets" &&
        !pathname.startsWith("/assets/") &&
        isNavigation(pathname, context.req.header("accept") ?? "")
      ) {
        const index = await serveFile(context, options.webRoot, "index.html");
        if (index !== undefined) return index;
      }
    }
    return context.json({ error: "not_found" }, 404);
  });
  app.onError((error, context) => {
    logger({ level: "error", event: "request_error", message: error.message });
    return context.json({ error: "internal_error" }, 500);
  });

  const listener = getRequestListener(app.fetch, { overrideGlobalObjects: false });
  let closing = false;
  const server = createServer((request, response) => {
    const address = server.address();
    const port = address !== null && typeof address !== "string" ? address.port : 0;
    const boundary = validateBoundary(request, port, options.development ?? false);
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (!boundary.ok || closing) {
      response.writeHead(closing ? 503 : boundary.ok ? 503 : boundary.status, {
        "content-type": "application/json; charset=utf-8",
        connection: "close",
      });
      response.end(
        JSON.stringify({ error: closing ? "closing" : boundary.ok ? "closing" : boundary.error }),
      );
      return;
    }
    void listener(request, response).catch((error: unknown) => {
      logger({ level: "error", event: "http_error", message: String(error) });
      response.destroy();
    });
  });
  const connections = new Set<Socket>();
  server.on("connection", (socket) => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on("upgrade", (request, socket, head) => {
    const onError = (error: Error): void => {
      logger({ level: "error", event: "upgrade_error", message: error.message });
      socket.destroy();
    };
    socket.on("error", onError);
    const address = server.address();
    const port = address !== null && typeof address !== "string" ? address.port : 0;
    const boundary = validateBoundary(request, port, options.development ?? false);
    if (closing || !boundary.ok || boundary.pathname !== devWebSocketPath) {
      const status = closing ? 503 : boundary.ok ? 404 : boundary.status;
      socket.end(
        `HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        () => socket.destroy(),
      );
      return;
    }
    socket.off("error", onError);
    sockets.handleUpgrade(request, socket, head, (client) =>
      sockets.emit("connection", client, request),
    );
  });
  sockets.on("connection", (socket) => {
    socket.on("error", (error: Error) =>
      logger({ level: "error", event: "websocket_error", message: error.message }),
    );
    socket.on("message", (data, binary) => {
      // Transport probe only; Room messages and persistence are later issues.
      socket.send(Array.isArray(data) ? Buffer.concat(data) : data, { binary });
    });
  });
  sockets.on("error", (error: Error) =>
    logger({ level: "error", event: "websocket_server_error", message: error.message }),
  );

  const closeHttp = server.close.bind(server);
  let closed: Promise<Error | undefined> | undefined;
  server.close = (callback) => {
    closed ??= new Promise((resolve) => {
      closing = true;
      const timeout = setTimeout(() => {
        for (const client of sockets.clients) client.terminate();
        server.closeAllConnections();
        for (const socket of connections) socket.destroy();
      }, options.shutdownTimeoutMs ?? 2_000);
      timeout.unref();
      const wsClosed = new Promise<void>((done) => sockets.close(() => done()));
      for (const client of sockets.clients) client.close(1001, "Server shutting down");
      closeHttp((error) => {
        void wsClosed.then(() => {
          clearTimeout(timeout);
          resolve(
            error && !("code" in error && error.code === "ERR_SERVER_NOT_RUNNING")
              ? error
              : undefined,
          );
        });
      });
    });
    if (callback !== undefined) void closed.then((error) => callback(error));
    return server;
  };
  return server;
};
