import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as v from "valibot";
import { expect, test } from "vite-plus/test";

const logSchema = v.object({ event: v.string(), level: v.picklist(["info", "error"]) });
const getEvents = (output: string): string[] =>
  output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const input: unknown = JSON.parse(line);
      return v.parse(logSchema, input).event;
    });
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("expected port");
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "discussion-room-cli-"));
  const serverRoot = join(root, "apps/server");
  await mkdir(serverRoot, { recursive: true });
  await cp(new URL("./", import.meta.url), join(serverRoot, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await symlink(
    fileURLToPath(new URL("../node_modules", import.meta.url)),
    join(serverRoot, "node_modules"),
  );
  await mkdir(join(root, "apps/web/dist/assets"), { recursive: true });
  await mkdir(join(root, "apps/web/dist/pyodide"), { recursive: true });
  await writeFile(join(root, "apps/web/dist/index.html"), "<!doctype html><title>CLI UI</title>");
  await writeFile(join(root, "apps/web/dist/assets/app.js"), "export const smoke = true;");
  await writeFile(join(root, "apps/web/dist/pyodide/fixture.wasm"), Buffer.from([0, 97, 115, 109]));
  return root;
};
const run = (root: string, args: string[] = [], extraEnv: Record<string, string> = {}) => {
  const child = spawn(process.execPath, [join(root, "apps/server/src/main.ts"), ...args], {
    cwd: tmpdir(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "8787",
      DATA_DIR: ".data",
      NODE_ENV: "production",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => (output += chunk));
  child.stderr.on("data", (chunk: string) => (errors += chunk));
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  const waitListening = async (): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (!output.includes('"event":"server_listening"')) {
      if (Date.now() > deadline || child.exitCode !== null)
        throw new Error(`CLI did not start: ${output}${errors}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  return { child, output: () => output, errors: () => errors, exited, waitListening };
};
const stop = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 3_000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
};

test.each(["SIGTERM", "SIGINT"] as const)(
  "CLI serves assets from its own layout outside cwd and exits on %s",
  async (signal) => {
    const root = await fixture();
    const port = await freePort();
    const envFile = join(root, ".env");
    const envContent = "PORT=invalid\nHOST=0.0.0.0\nDATA_DIR=env-data\n";
    await writeFile(envFile, envContent);
    const app = run(root, ["--port", String(port), "--host=127.0.0.1", "--data-dir=CLI data"], {
      PORT: "bad",
      HOST: "0.0.0.0",
    });
    try {
      await app.waitListening();
      const base = `http://127.0.0.1:${port}`;
      expect(await (await fetch(base)).text()).toContain("CLI UI");
      expect((await fetch(`${base}/api/health`)).status).toBe(200);
      expect((await fetch(`${base}/assets/app.js`)).status).toBe(200);
      expect((await fetch(`${base}/pyodide/fixture.wasm`)).headers.get("content-type")).toBe(
        "application/wasm",
      );
      // Source execution without --watch follows the production origin policy too.
      expect(
        (await fetch(`${base}/api/health`, { headers: { origin: "http://127.0.0.1:5173" } }))
          .status,
      ).toBe(403);
      app.child.kill(signal);
      expect(await app.exited).toBe(0);
      expect(getEvents(app.output())).toEqual([
        "server_listening",
        "shutdown_started",
        "shutdown_complete",
      ]);
      expect(app.output()).toContain(join(root, "CLI data"));
      expect(app.errors()).toBe("");
      expect(await readFile(envFile, "utf8")).toBe(envContent);
      await expect(readFile(join(root, "CLI data"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await stop(app.child);
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("invalid CLI fails before listening with a structured config error", async () => {
  const root = await fixture();
  const app = run(root, ["--port=0"]);
  try {
    expect(await app.exited).toBe(1);
    expect(app.output()).toBe("");
    expect(getEvents(app.errors())).toEqual(["config_error"]);
  } finally {
    await stop(app.child);
    await rm(root, { recursive: true, force: true });
  }
});

test("listen failure closes resources and returns a structured startup error", async () => {
  const root = await fixture();
  const occupied = createServer();
  await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  const address = occupied.address();
  if (address === null || typeof address === "string") throw new Error("expected port");
  const app = run(root, ["--port", String(address.port)]);
  try {
    expect(await app.exited).toBe(1);
    expect(getEvents(app.errors())).toEqual(["startup_error"]);
    expect(getEvents(app.output())).toEqual(["shutdown_started", "shutdown_complete"]);
  } finally {
    await stop(app.child);
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("production startup reports a missing web build before listening", async () => {
  const root = await fixture();
  await rm(join(root, "apps/web/dist"), { recursive: true });
  const app = run(root);
  try {
    expect(await app.exited).toBe(1);
    expect(app.output()).toBe("");
    expect(getEvents(app.errors())).toEqual(["startup_error"]);
    expect(app.errors()).toContain("pnpm build");
  } finally {
    await stop(app.child);
    await rm(root, { recursive: true, force: true });
  }
});

test("repeated server errors after listening are structured and retain bounded shutdown", async () => {
  const root = await fixture();
  const port = await freePort();
  const preload = join(root, "server-error-probe.mjs");
  await writeFile(
    preload,
    `
    import http from "node:http";
    import { syncBuiltinESMExports } from "node:module";
    const original = http.createServer;
    http.createServer = (...args) => {
      const server = original(...args);
      server.once("listening", () => setImmediate(() => {
        server.emit("error", new Error("EMFILE probe one"));
        server.emit("error", new Error("EMFILE probe two"));
      }));
      return server;
    };
    syncBuiltinESMExports();
  `,
  );
  const app = run(root, ["--port", String(port)], { NODE_OPTIONS: `--import=${preload}` });
  try {
    expect(await app.exited).toBe(1);
    expect(getEvents(app.errors())).toEqual(["server_error", "server_error"]);
    expect(getEvents(app.output())).toEqual([
      "server_listening",
      "shutdown_started",
      "shutdown_complete",
    ]);
  } finally {
    await stop(app.child);
    await rm(root, { recursive: true, force: true });
  }
});
