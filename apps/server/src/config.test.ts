import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vite-plus/test";
import {
  applyEnvFileIfPresent,
  defaultDataDir,
  defaultHost,
  defaultPort,
  devProxyTarget,
  loadServerConfig,
  serverEntryLayout,
  webConfigLayout,
} from "./config.ts";

const repoRoot = "/repo";

test("uses the documented defaults when the environment is unset", () => {
  expect(loadServerConfig({}, repoRoot)).toEqual({
    ok: true,
    value: {
      host: defaultHost,
      port: defaultPort,
      dataDir: resolve(repoRoot, defaultDataDir),
    },
  });
});

test("resolves DATA_DIR from the repository root and keeps absolute paths", () => {
  expect(loadServerConfig({ DATA_DIR: "nested/dir" }, repoRoot)).toEqual({
    ok: true,
    value: {
      host: defaultHost,
      port: defaultPort,
      dataDir: resolve(repoRoot, "nested/dir"),
    },
  });
  expect(loadServerConfig({ DATA_DIR: "/var/discussion-room" }, repoRoot)).toMatchObject({
    ok: true,
    value: { dataDir: "/var/discussion-room" },
  });
});

test("rejects invalid PORT, HOST, and DATA_DIR instead of substituting defaults", () => {
  expect(loadServerConfig({ PORT: "nope" }, repoRoot)).toEqual({
    ok: false,
    error: { code: "invalid_port", value: "nope" },
  });
  expect(loadServerConfig({ PORT: "0" }, repoRoot).ok).toBe(false);
  expect(loadServerConfig({ PORT: "65536" }, repoRoot).ok).toBe(false);
  expect(loadServerConfig({ PORT: "" }, repoRoot).ok).toBe(false);
  expect(loadServerConfig({ HOST: "[::1]" }, repoRoot)).toEqual({
    ok: false,
    error: { code: "invalid_host", value: "[::1]" },
  });
  expect(loadServerConfig({ HOST: "http://localhost" }, repoRoot).ok).toBe(false);
  expect(loadServerConfig({ DATA_DIR: "" }, repoRoot)).toEqual({
    ok: false,
    error: { code: "invalid_data_dir", value: "" },
  });
});

test.each(["127.0.0.1", "::1", "localhost"])("accepts local-only HOST %s", (host) => {
  expect(loadServerConfig({ HOST: host }, repoRoot)).toMatchObject({ ok: true, value: { host } });
});

test.each(["0.0.0.0", "::", "192.168.1.10", "example.com", "127.0.0.2"])(
  "rejects unsupported HOST %s until authenticated LAN exposure is implemented",
  (host) => {
    expect(loadServerConfig({ HOST: host }, repoRoot)).toEqual({
      ok: false,
      error: { code: "invalid_host", value: host },
    });
  },
);

test("builds proxy targets and brackets IPv6 hosts", () => {
  expect(devProxyTarget({ host: "127.0.0.1", port: 8787 })).toEqual({
    http: "http://127.0.0.1:8787",
    ws: "ws://127.0.0.1:8787",
  });
  expect(devProxyTarget({ host: "::1", port: 8787 })).toEqual({
    http: "http://[::1]:8787",
    ws: "ws://[::1]:8787",
  });
});

test("server and web entrypoints resolve the same repository .env", () => {
  const serverSource = serverEntryLayout(pathToFileURL("/repo/apps/server/src/main.ts"));
  const serverBundle = serverEntryLayout(pathToFileURL("/repo/apps/server/dist/main.mjs"));
  const webConfig = webConfigLayout(pathToFileURL("/repo/apps/web/vite.config.ts"));

  expect(serverSource.envFile).toBe("/repo/.env");
  expect(serverBundle.envFile).toBe("/repo/.env");
  expect(webConfig.envFile).toBe("/repo/.env");
  expect(resolve(serverSource.repoRoot, ".data")).toBe("/repo/.data");
  expect(resolve(webConfig.repoRoot, ".data")).toBe("/repo/.data");
});

test("loads .env with Node's parser and does not override existing variables", async () => {
  const dir = await mkdtemp(join(tmpdir(), "discussion-room-env-"));
  const envFile = join(dir, ".env");
  await writeFile(envFile, '# note\nDR_CONFIG_HOST="127.0.0.1"\nDR_CONFIG_PORT=4242\n');
  const previousHost = process.env["DR_CONFIG_HOST"];
  const previousPort = process.env["DR_CONFIG_PORT"];
  delete process.env["DR_CONFIG_HOST"];
  process.env["DR_CONFIG_PORT"] = "1111";

  try {
    applyEnvFileIfPresent(envFile);
    expect(process.env["DR_CONFIG_HOST"]).toBe("127.0.0.1");
    expect(process.env["DR_CONFIG_PORT"]).toBe("1111");
    applyEnvFileIfPresent(join(dir, "missing.env"));
    expect(process.env["DR_CONFIG_PORT"]).toBe("1111");
  } finally {
    if (previousHost === undefined) {
      delete process.env["DR_CONFIG_HOST"];
    } else {
      process.env["DR_CONFIG_HOST"] = previousHost;
    }
    if (previousPort === undefined) {
      delete process.env["DR_CONFIG_PORT"];
    } else {
      process.env["DR_CONFIG_PORT"] = previousPort;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
