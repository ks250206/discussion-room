import { mkdtemp, rm } from "node:fs/promises";
import { request, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer as createViteServer } from "vite-plus";
import { expect, test, vi } from "vite-plus/test";
import { WebSocket, type RawData } from "ws";
import { createStackSpike } from "./app.ts";

type Spike = ReturnType<typeof createStackSpike>;

const listen = async (spike: Spike): Promise<string> => {
  await new Promise<void>((resolve, reject) => {
    spike.server.once("error", reject);
    spike.server.listen(0, "127.0.0.1", resolve);
  });
  const address = spike.server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP port");
  return `http://127.0.0.1:${address.port}`;
};

const put = (value: string): RequestInit => ({
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ value }),
});

const openSocket = (url: URL): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("error", reject);
    socket.once("open", () => resolve(socket));
  });

const message = (socket: WebSocket): Promise<{ data: RawData; binary: boolean }> =>
  new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.once("message", (data, binary) => resolve({ data, binary }));
  });

const deferredVoid = () => {
  let resolve: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve() };
};

const toBuffer = (data: RawData): Buffer => {
  if (Buffer.isBuffer(data)) return data;
  return Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
};

test("Hono request tests validate JSON before binding SQL, preserving text literally", async () => {
  const spike = createStackSpike(":memory:");
  try {
    expect((await spike.app.request("/api/spike")).status).toBe(404);
    const value = "研究データ'); DROP TABLE spike_probe; --";
    expect((await spike.app.request("/api/spike", put(value))).status).toBe(200);
    for (const body of ['{"value":null}', '{"value":1}', "invalid", '{"value":"x","extra":1}']) {
      expect((await spike.app.request("/api/spike", { method: "PUT", body })).status).toBe(400);
    }
    expect((await spike.app.request("/api/spike", put("x".repeat(1025)))).status).toBe(400);
    expect(await (await spike.app.request("/api/spike")).json()).toEqual({ value });
    expect((await spike.app.request("/unknown")).status).toBe(404);
  } finally {
    await spike.close();
  }
});

test("an in-process PUT awaiting its body returns 503 after the database closes", async () => {
  const spike = createStackSpike(":memory:");
  const body = JSON.stringify({ value: "too-late" });
  const incoming = new Request("http://localhost/api/spike", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    },
    body,
  });
  const reading = deferredVoid();
  const resume = deferredVoid();
  const readText = incoming.text.bind(incoming);
  const delayed = vi.spyOn(incoming, "text").mockImplementation(async () => {
    reading.resolve();
    await resume.promise;
    return readText();
  });
  const pending = spike.app.request(incoming);
  try {
    // The initial closing middleware has passed; JSON consumption is still pending.
    await reading.promise;
    await spike.close();
    resume.resolve();
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "closing" });
  } finally {
    resume.resolve();
    await pending;
    delayed.mockRestore();
    await spike.close();
  }
});

test("SQLite persists through server recreation and shutdown closes connected WebSockets", async () => {
  const root = await mkdtemp(join(tmpdir(), "discussion-room-stack-"));
  const path = join(root, "probe.sqlite");
  const first = createStackSpike(path);
  let second: Spike | undefined;
  let socket: WebSocket | undefined;
  try {
    const url = await listen(first);
    expect((await fetch(`${url}/api/spike`, put("再起動後も保持"))).status).toBe(200);
    socket = await openSocket(new URL("/ws", url.replace(/^http/, "ws")));
    const disconnected = new Promise<void>((resolve) => socket?.once("close", () => resolve()));
    await Promise.all([first.close(), first.close(), disconnected]);
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect((await first.app.request("/api/spike")).status).toBe(503);

    second = createStackSpike(path);
    const restarted = await listen(second);
    expect(await (await fetch(`${restarted}/api/spike`)).json()).toEqual({
      value: "再起動後も保持",
    });
    expect((await fetch(`${restarted}/api/spike`, put("updated"))).status).toBe(200);
  } finally {
    socket?.terminate();
    await first.close();
    await second?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("the chosen SQLite driver rolls back an explicit transaction after a constraint error", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("INSERT INTO probe VALUES (?, ?)").run(1, "uncommitted");
      expect(() => database.prepare("INSERT INTO probe VALUES (?, ?)").run(1, "duplicate")).toThrow(
        "UNIQUE constraint failed",
      );
    } finally {
      database.exec("ROLLBACK");
    }
    expect(database.prepare("SELECT value FROM probe").all()).toEqual([]);
    database.prepare("INSERT INTO probe VALUES (?, ?)").run(1, "committed");
    expect(database.prepare("SELECT value FROM probe").get()).toEqual({ value: "committed" });
  } finally {
    database.close();
  }
});

test("Hono HTTP and direct ws preserve text and binary through Vite's HTTP/WS proxy", async () => {
  const root = await mkdtemp(join(tmpdir(), "discussion-room-stack-proxy-"));
  const spike = createStackSpike(":memory:");
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  let socket: WebSocket | undefined;
  try {
    const target = await listen(spike);
    vite = await createViteServer({
      configFile: false,
      root,
      envDir: false,
      logLevel: "silent",
      server: {
        host: "127.0.0.1",
        port: 0,
        proxy: { "/api": { target }, "^/ws(?:\\?.*)?$": { target, ws: true } },
      },
    });
    await vite.listen();
    const url = vite.resolvedUrls?.local?.[0];
    if (url === undefined) throw new Error("expected a Vite URL");
    expect((await fetch(new URL("/api/spike", url), put("proxied"))).status).toBe(200);
    expect(await (await fetch(new URL("/api/spike?probe=1", url))).json()).toEqual({
      value: "proxied",
    });
    socket = await openSocket(new URL("/ws?probe=1", url.replace(/^http/, "ws")));
    const textEcho = message(socket);
    socket.send("hello 研究");
    const text = await textEcho;
    expect(text.binary).toBe(false);
    expect(toBuffer(text.data).toString()).toBe("hello 研究");
    const binaryEcho = message(socket);
    const bytes = Buffer.from([0, 1, 2, 255]);
    socket.send(bytes);
    const binary = await binaryEcho;
    expect(binary.binary).toBe(true);
    expect(toBuffer(binary.data)).toEqual(bytes);
  } finally {
    socket?.terminate();
    await vite?.close();
    await spike.close();
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);

test("upgrade routing rejects paths other than the exact /ws route", async () => {
  const spike = createStackSpike(":memory:");
  try {
    const url = (await listen(spike)).replace(/^http/, "ws");
    for (const path of ["/api/spike", "/wsfoo", "/ws/subpath"]) {
      const socket = new WebSocket(`${url}${path}`);
      try {
        const status = await new Promise<number>((resolve, reject) => {
          socket.on("error", reject);
          socket.once("unexpected-response", (_request, response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
            socket.terminate();
          });
          socket.once("open", () => reject(new Error("unexpected upgrade")));
        });
        expect(status).toBe(404);
      } finally {
        socket.terminate();
      }
    }
  } finally {
    await spike.close();
  }
});

test("the JSON route rejects oversized declared and chunked bodies before storing", async () => {
  const spike = createStackSpike(":memory:");
  try {
    const url = await listen(spike);
    expect((await fetch(`${url}/api/spike`, put("preserved"))).status).toBe(200);
    const body = " ".repeat(8 * 1024) + JSON.stringify({ value: "oversized" });
    const declared = await fetch(`${url}/api/spike`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(declared.status).toBe(413);
    expect(await declared.json()).toEqual({ error: "probe_too_large" });

    const chunkedStatus = await new Promise<number>((resolve, reject) => {
      // No Content-Length: Node uses chunked transfer encoding for these writes.
      const outgoing = request(
        `${url}/api/spike`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
        },
        (incoming) => {
          incoming.resume();
          incoming.once("end", () => resolve(incoming.statusCode ?? 0));
          incoming.once("error", reject);
        },
      );
      outgoing.once("error", reject);
      outgoing.write(body.slice(0, 4096));
      outgoing.end(body.slice(4096));
    });
    expect(chunkedStatus).toBe(413);
    expect(await (await fetch(`${url}/api/spike`)).json()).toEqual({ value: "preserved" });

    // Even JSON escapes for all 1024 accepted code units fit in the byte cap.
    const escaped = `{"value":"${"\\u0061".repeat(1024)}"}`;
    expect((await spike.app.request("/api/spike", { method: "PUT", body: escaped })).status).toBe(
      200,
    );
  } finally {
    await spike.close();
  }
});

test("a socket error during upgrade rejection is handled and leaves HTTP available", async () => {
  const spike = createStackSpike(":memory:");
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  let client: ReturnType<typeof connect> | undefined;
  try {
    const url = new URL(await listen(spike));
    const rejectedError = new Promise<void>((resolve) => {
      // Inject an error deterministically after the application's rejection handler.
      // A real client TCP reset is timing dependent; without its listener this throws.
      spike.server.once("upgrade", (_request: IncomingMessage, socket: Duplex) => {
        socket.emit("error", new Error("simulated ECONNRESET"));
        resolve();
      });
    });
    client = connect(Number(url.port), "127.0.0.1");
    client.on("error", () => {});
    client.write(
      "GET /wrong HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
    await rejectedError;
    expect(logged).toHaveBeenCalledWith("spike upgrade error", "simulated ECONNRESET");
    expect((await fetch(new URL("/api/spike", url))).status).toBe(404);
  } finally {
    client?.destroy();
    await spike.close();
    logged.mockRestore();
  }
});
