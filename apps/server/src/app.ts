import { createServer, type RequestListener, type Server } from "node:http";
import { WebSocketServer, type RawData } from "ws";
import { devWebSocketPath } from "./config.ts";

export type HealthResponse = {
  status: "ok";
};

const sendJson = (res: Parameters<RequestListener>[1], statusCode: number, body: unknown): void => {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

export const handleRequest: RequestListener = (req, res) => {
  const url = URL.parse(req.url ?? "/", "http://localhost");

  if (!url) {
    sendJson(res, 400, { error: "bad_request" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    const body: HealthResponse = { status: "ok" };
    sendJson(res, 200, body);
    return;
  }

  sendJson(res, 404, { error: "not_found" });
};

const toSendable = (data: RawData): Buffer | ArrayBuffer => {
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return data;
};

export const createAppServer = (): Server => {
  const server = createServer(handleRequest);
  const sockets = new WebSocketServer({ server, path: devWebSocketPath });

  sockets.on("connection", (socket) => {
    socket.on("error", (error: Error) => {
      console.error(`websocket client: ${error.message}`);
    });
    socket.on("message", (data: RawData, isBinary: boolean) => {
      socket.send(toSendable(data), { binary: isBinary });
    });
  });

  sockets.on("error", (error: Error) => {
    console.error(`websocket server: ${error.message}`);
  });

  const closeHttpServer = server.close.bind(server);
  let closing = false;
  server.close = (callback) => {
    if (!closing) {
      closing = true;
      // Stop accepting upgrades before terminating clients. The dev echo server
      // has no pending application state that needs a graceful close handshake.
      sockets.close();
      for (const socket of sockets.clients) {
        socket.terminate();
      }
    }
    closeHttpServer(callback);
    return server;
  };

  return server;
};
