import type { Server } from "node:http";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, type RawData } from "ws";
import { createServer as createViteServer } from "vite-plus";
import { expect, test } from "vite-plus/test";
import { createAppServer } from "./app.ts";
import { devApiPrefix, devWebSocketPath } from "./config.ts";
import webConfig from "../../web/vite.config.ts";

const asBuffer = (data: RawData): Buffer => {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data);
};

const listen = (server: Server): Promise<number> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("expected the server to listen on a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const restoreEnv = (previous: Readonly<NodeJS.ProcessEnv>): void => {
  for (const name of Object.keys(process.env)) {
    if (!(name in previous)) {
      delete process.env[name];
    }
  }
  Object.assign(process.env, previous);
};

test("static build and preview config ignore invalid development-only settings", () => {
  const previous = { ...process.env };
  try {
    process.env["PORT"] = "invalid";
    process.env["HOST"] = "0.0.0.0";
    process.env["DATA_DIR"] = "";
    const build = webConfig({ command: "build", mode: "production" });
    const preview = webConfig({ command: "serve", mode: "production", isPreview: true });
    expect(build).not.toHaveProperty("server");
    expect(preview).not.toHaveProperty("server");
    expect(build).toHaveProperty("envDir");
    expect(build).toHaveProperty("plugins");
  } finally {
    restoreEnv(previous);
  }
});

test("Vite proxies only /api paths and exact /ws, preserving query strings", async () => {
  const app = createAppServer();
  const previous = { ...process.env };
  const fixtureRoot = await mkdtemp(join(tmpdir(), "discussion-room-proxy-"));
  const webRoot = join(fixtureRoot, "apps", "web");
  const serverRoot = join(fixtureRoot, "apps", "server");
  const backendRequests: (string | undefined)[] = [];
  app.on("request", (request) => backendRequests.push(request.url));
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;

  try {
    // Run the real config in an isolated repository layout, so neither Vite nor
    // process.loadEnvFile reads the developer's actual .env files.
    await mkdir(webRoot, { recursive: true });
    await mkdir(join(serverRoot, "src"), { recursive: true });
    await cp(new URL("../../web/vite.config.ts", import.meta.url), join(webRoot, "vite.config.ts"));
    await cp(new URL("./config.ts", import.meta.url), join(serverRoot, "src", "config.ts"));
    await writeFile(join(fixtureRoot, "package.json"), '{ "type": "module" }\n');
    await writeFile(join(fixtureRoot, ".env"), "DISCUSSION_ROOM_PROXY_FIXTURE=loaded\n");
    await symlink(
      fileURLToPath(new URL("../../web/node_modules", import.meta.url)),
      join(webRoot, "node_modules"),
    );
    const port = await listen(app);
    process.env["HOST"] = "127.0.0.1";
    process.env["PORT"] = String(port);
    process.env["DATA_DIR"] = ".data";
    delete process.env["DISCUSSION_ROOM_PROXY_FIXTURE"];

    vite = await createViteServer({
      configFile: join(webRoot, "vite.config.ts"),
      root: fileURLToPath(new URL("../../web", import.meta.url)),
      logLevel: "silent",
      server: { port: 0 },
    });
    await vite.listen();
    expect(process.env["DISCUSSION_ROOM_PROXY_FIXTURE"]).toBe("loaded");

    const localUrl = vite.resolvedUrls?.local?.[0];
    if (localUrl === undefined) {
      throw new Error("Vite did not report a local URL");
    }

    const health = await fetch(new URL(`${devApiPrefix}/health?probe=1`, localUrl), {
      signal: AbortSignal.timeout(5_000),
    });
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    for (const path of ["/api", "/api?probe=1"]) {
      const response = await fetch(new URL(path, localUrl), { signal: AbortSignal.timeout(5_000) });
      expect(response.status).toBe(404);
    }
    for (const path of ["/apiary", "/wsfoo", "/ws/subpath"]) {
      await fetch(new URL(path, localUrl), { signal: AbortSignal.timeout(5_000) });
    }
    expect(backendRequests).toEqual(["/api/health?probe=1", "/api", "/api?probe=1"]);

    const wsUrl = new URL(`${devWebSocketPath}?probe=1`, localUrl);
    wsUrl.protocol = "ws:";
    const socket = new WebSocket(wsUrl);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("open", () => resolve());
        socket.once("error", () => reject(new Error(`websocket failed: ${wsUrl.href}`)));
      });
      const echoed = new Promise<{ data: RawData; isBinary: boolean }>((resolve) => {
        socket.once("message", (data, isBinary) => resolve({ data, isBinary }));
      });
      const payload = Buffer.from([9, 8, 7]);
      socket.send(payload);
      const message = await echoed;
      expect(message.isBinary).toBe(true);
      expect(Buffer.compare(asBuffer(message.data), payload)).toBe(0);
    } finally {
      socket.close();
    }
  } finally {
    try {
      await vite?.close();
      if (app.listening) await closeServer(app);
    } finally {
      restoreEnv(previous);
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }
  expect(process.env).toEqual(previous);
}, 45_000);
