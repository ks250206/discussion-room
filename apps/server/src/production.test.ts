import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { request, type Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { createAppServer } from "./app.ts";

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("expected TCP port");
      resolve(address.port);
    });
  });
const close = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
let root = "";
let port = 0;
let base = "";
let server: Server;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "discussion-room-static-"));
  const webRoot = join(root, "web");
  const pyodideRoot = join(root, "pyodide");
  await mkdir(join(webRoot, "assets"), { recursive: true });
  await mkdir(pyodideRoot);
  await writeFile(join(webRoot, "index.html"), "<!doctype html><title>Fixture UI</title>");
  await writeFile(join(webRoot, "assets", "main.js"), "export const ready = true;");
  await writeFile(join(webRoot, "assets", "style.css"), "body { color: black }");
  await writeFile(join(pyodideRoot, "pyodide.mjs"), "export const fixtureOnly = true;");
  await writeFile(join(pyodideRoot, "pyodide.asm.wasm"), Buffer.from([0, 97, 115, 109]));
  await writeFile(join(root, "secret.txt"), "PRIVATE fixture");
  await writeFile(join(webRoot, ".env"), "SECRET=hidden");
  await symlink(join(root, "secret.txt"), join(webRoot, "linked.txt"));
  await symlink(root, join(webRoot, "linked-dir"));
  await symlink(join(root, "secret.txt"), join(pyodideRoot, "linked.data"));
  server = createAppServer({ webRoot, pyodideRoot });
  port = await listen(server);
  base = `http://127.0.0.1:${port}`;
});
afterAll(async () => {
  await close(server);
  await rm(root, { recursive: true, force: true });
});

const rawGet = (
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number | undefined; body: string }> =>
  new Promise((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", port, path, headers, agent: false },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode, body }));
      },
    );
    req.setTimeout(2_000, () => req.destroy(new Error("request timed out")));
    req.once("error", reject);
    req.end();
  });

test("one port serves health, web index, Vite assets and local Pyodide fixtures", async () => {
  const health = await fetch(`${base}/api/health`);
  expect(await health.json()).toEqual({ status: "ok" });
  const index = await fetch(base);
  expect(index.headers.get("content-type")).toContain("text/html");
  expect(await index.text()).toContain("Fixture UI");
  for (const [path, mime] of [
    ["/assets/main.js", "text/javascript"],
    ["/assets/style.css", "text/css"],
    ["/pyodide/pyodide.mjs", "text/javascript"],
    ["/pyodide/pyodide.asm.wasm", "application/wasm"],
  ]) {
    const response = await fetch(`${base}${path}?cache=1`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(mime);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  }
});

test("HEAD retains MIME and length but has no body; writes never serve static files", async () => {
  const head = await fetch(`${base}/assets/main.js`, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.headers.get("content-length")).toBe(
    String(Buffer.byteLength("export const ready = true;")),
  );
  expect(await head.text()).toBe("");
  expect((await fetch(`${base}/api/health`, { method: "HEAD" })).status).toBe(200);
  for (const path of ["/", "/assets/main.js", "/pyodide/pyodide.mjs", "/api/health"]) {
    const response = await fetch(`${base}${path}`, { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  }
});

test("SPA fallback is limited to HTML navigation and excludes reserved and missing asset routes", async () => {
  const navigation = await fetch(`${base}/projects/example`, { headers: { accept: "text/html" } });
  expect(navigation.status).toBe(200);
  expect(await navigation.text()).toContain("Fixture UI");
  for (const path of [
    "/api",
    "/api/missing",
    "/ws",
    "/ws/missing",
    "/pyodide",
    "/pyodide/missing",
    "/assets",
    "/assets/missing",
    "/missing.js",
    "/missing.wasm",
    "/.env",
  ]) {
    const response = await fetch(`${base}${path}`, { headers: { accept: "text/html" } });
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Fixture UI");
  }
  expect((await fetch(`${base}/projects/example`)).status).toBe(404);
});

test.each([
  "/../secret.txt",
  "/%2e%2e/secret.txt",
  "/assets/%2E%2E/secret.txt",
  "/%2fsecret.txt",
  "/assets%5c..%5csecret.txt",
  "/%00",
  "/%zz",
  "//example.com/secret.txt",
])("rejects raw traversal/malformed paths before URL normalization: %s", async (path) => {
  const response = await rawGet(path);
  expect(response.status).toBe(400);
  expect(response.body).not.toContain("PRIVATE");
});

test.each(["/linked.txt", "/linked-dir/secret.txt", "/pyodide/linked.data", "/%2eenv"])(
  "does not read symlinks or dotfiles: %s",
  async (path) => {
    const response = await rawGet(path);
    expect(response.status).toBe(404);
    expect(response.body).not.toContain("PRIVATE");
    expect(response.body).not.toContain("SECRET");
  },
);

test("validates HTTP Host and Origin even on loopback and ignores spoofed forwarding headers", async () => {
  for (const host of [
    `evil.example:${port}`,
    `127.0.0.1:${port + 1}`,
    `127.1:${port}`,
    `localhost.:${port}`,
  ]) {
    expect((await rawGet("/api/health", { host })).status).toBe(403);
  }
  for (const origin of [
    "https://evil.example",
    "null",
    `http://localhost:${port}`,
    "http://127.0.0.1:5173",
  ]) {
    expect((await rawGet("/api/health", { origin })).status).toBe(403);
  }
  expect((await rawGet("/api/health", { origin: base })).status).toBe(200);
  expect(
    (await rawGet("/api/health", { host: "evil.example", "x-forwarded-host": `127.0.0.1:${port}` }))
      .status,
  ).toBe(403);
  expect(
    (await rawGet("/api/health", { origin: "https://evil.example", "x-forwarded-origin": base }))
      .status,
  ).toBe(403);
});

const rejectedUpgrade = (
  path: string,
  headers: Record<string, string>,
): Promise<number | undefined> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base.replace("http", "ws")}${path}`, { headers });
    socket.on("error", () => undefined);
    socket.once("open", () => {
      socket.terminate();
      reject(new Error("unexpected accepted upgrade"));
    });
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      socket.terminate();
      resolve(response.statusCode);
    });
  });

test("WebSocket validates Host and Origin before upgrading, including a query string", async () => {
  expect(await rejectedUpgrade("/ws?probe=1", { origin: "https://evil.example" })).toBe(403);
  expect(await rejectedUpgrade("/ws", { origin: "null" })).toBe(403);
  expect(await rejectedUpgrade("/ws", { origin: "http://127.0.0.1:5173" })).toBe(403);
  expect(await rejectedUpgrade("/ws", { host: `evil.example:${port}`, origin: base })).toBe(403);
  expect(await rejectedUpgrade("/ws/other", { origin: base })).toBe(404);
  const socket = new WebSocket(`${base.replace("http", "ws")}/ws?probe=1`, { origin: base });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  socket.close();
  await closed;
});

test("shutdown closes active WS gracefully, bounds incomplete HTTP clients and is idempotent", async () => {
  const app = createAppServer({ shutdownTimeoutMs: 80 });
  const localPort = await listen(app);
  const socket = new WebSocket(`ws://127.0.0.1:${localPort}/ws`);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const code = new Promise<number>((resolve) => socket.once("close", resolve));
  const stalled = connect(localPort, "127.0.0.1");
  stalled.on("error", () => undefined);
  await new Promise<void>((resolve) => stalled.once("connect", resolve));
  stalled.write("GET /api/health HTTP/1.1\r\nHost:");
  const stalledClosed = new Promise<void>((resolve) => stalled.once("close", () => resolve()));
  const started = Date.now();
  await Promise.all([close(app), close(app), stalledClosed]);
  expect(await code).toBe(1001);
  expect(Date.now() - started).toBeLessThan(1_000);
  expect(app.listening).toBe(false);
  await close(app);
});

test("a static asset with an overlong path segment returns 404 and health remains available", async () => {
  const response = await rawGet(`/assets/${"a".repeat(300)}.js`);
  expect(response.status).toBe(404);
  expect(response.body).toBe('{"error":"not_found"}');
  expect((await fetch(`${base}/api/health`)).status).toBe(200);
});
