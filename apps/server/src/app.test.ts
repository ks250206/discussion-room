import { connect } from "node:net";
import { WebSocket, type RawData } from "ws";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { createAppServer } from "./app.ts";
import { devWebSocketPath } from "./config.ts";

const server = createAppServer();
let port = 0;
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected the server to listen on a TCP port");
  }
  port = address.port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("GET /api/health returns ok", async () => {
  const res = await fetch(`${baseUrl}/api/health`);

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("unknown routes return 404", async () => {
  const res = await fetch(`${baseUrl}/nope`);

  expect(res.status).toBe(404);
});

test("an unparsable request target returns 400 and keeps the server alive", async () => {
  const rawResponse = await new Promise<string>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.end("GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    });
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      data += chunk;
    });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });

  expect(rawResponse.startsWith("HTTP/1.1 400")).toBe(true);
  expect((await fetch(`${baseUrl}/api/health`)).status).toBe(200);
});

const asBuffer = (data: RawData): Buffer => {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data);
};

const openSocket = (url: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const fail = (): void => {
      socket.terminate();
      reject(new Error(`websocket failed: ${url}`));
    };
    socket.once("error", fail);
    socket.once("open", () => {
      socket.off("error", fail);
      resolve(socket);
    });
  });

const closeSocket = (socket: WebSocket): Promise<void> =>
  new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    socket.once("close", () => resolve());
    socket.close();
  });

test("echoes text and binary frames on /ws, including a query string", async () => {
  const socket = await openSocket(`${baseUrl.replace(/^http/, "ws")}${devWebSocketPath}?probe=1`);
  try {
    const text = new Promise<RawData>((resolve) => {
      socket.once("message", (data) => resolve(data));
    });
    socket.send("hello");
    expect(asBuffer(await text).toString("utf8")).toBe("hello");

    const binary = new Promise<{ data: RawData; isBinary: boolean }>((resolve) => {
      socket.once("message", (data, isBinary) => resolve({ data, isBinary }));
    });
    const payload = Buffer.from([0, 1, 2, 255]);
    socket.send(payload);
    const echoed = await binary;
    expect(echoed.isBinary).toBe(true);
    expect(Buffer.compare(asBuffer(echoed.data), payload)).toBe(0);
  } finally {
    await closeSocket(socket);
  }
});

test("rejects websocket upgrades outside /ws", async () => {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/api/health`);
  let failed = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("upgrade was not rejected")), 2_000);
      const finish = (): void => {
        failed = true;
        clearTimeout(timer);
        resolve();
      };
      socket.once("open", () => {
        clearTimeout(timer);
        reject(new Error("expected the upgrade to fail"));
      });
      socket.once("error", finish);
      socket.once("unexpected-response", finish);
    });
  } finally {
    socket.terminate();
  }
  expect(failed).toBe(true);
});

test("server.close completes while a websocket client is still connected", async () => {
  const app = createAppServer();
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const address = app.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP port");
  }
  const socket = await openSocket(`ws://127.0.0.1:${address.port}/ws`);
  const disconnected = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  const closed = new Promise<void>((resolve, reject) => {
    app.close((error) => (error ? reject(error) : resolve()));
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([closed, disconnected]),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("active websocket blocked shutdown")), 1_000);
      }),
    ]);
    expect(app.listening).toBe(false);
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  } finally {
    clearTimeout(timer);
    socket.terminate();
    await closed;
  }
});
