import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close();
        reject(new Error("expected a TCP port"));
        return;
      }
      const { port } = address;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });

const stopProcess = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.kill("SIGTERM");
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });

test("node --watch restarts the server when an imported source file changes", async () => {
  const port = await freePort();
  const root = await mkdtemp(join(tmpdir(), "discussion-room-watch-"));
  const serverRoot = join(root, "apps", "server");
  const appFile = join(serverRoot, "src", "app.ts");
  let child: ChildProcess | undefined;

  try {
    await cp(fileURLToPath(new URL("./", import.meta.url)), join(serverRoot, "src"), {
      recursive: true,
    });
    await writeFile(join(serverRoot, "package.json"), '{ "type": "module" }\n');
    const wsPackage = await realpath(fileURLToPath(new URL("../node_modules/ws", import.meta.url)));
    await mkdir(join(serverRoot, "node_modules"));
    await symlink(wsPackage, join(serverRoot, "node_modules", "ws"));

    child = spawn(process.execPath, ["--watch", "src/main.ts"], {
      cwd: serverRoot,
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DATA_DIR: ".data" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (stdout === null || stderr === null) {
      throw new Error("expected piped stdio");
    }
    stdout.setEncoding("utf8");
    stderr.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    stderr.on("data", (chunk: string) => {
      output += chunk;
    });

    const needle = `discussion-room server listening on http://127.0.0.1:${port}`;
    const waitForCount = (count: number): Promise<void> =>
      new Promise((resolve, reject) => {
        const started = Date.now();
        const timer = setInterval(() => {
          const seen = output.split(needle).length - 1;
          if (seen >= count) {
            clearInterval(timer);
            resolve();
            return;
          }
          if (Date.now() - started > 15_000) {
            clearInterval(timer);
            reject(new Error(`timed out waiting for ${count} listens\n${output}`));
          }
        }, 50);
      });

    await waitForCount(1);
    const original = await readFile(appFile);
    await writeFile(appFile, Buffer.concat([original, Buffer.from("\n")]));
    await waitForCount(2);

    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  } finally {
    if (child !== undefined) {
      await stopProcess(child);
    }
    await rm(root, { recursive: true, force: true });
  }
}, 25_000);
