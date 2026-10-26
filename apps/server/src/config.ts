import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import * as v from "valibot";

export const defaultHost = "127.0.0.1";
export const defaultPort = 8787;
export const defaultDataDir = ".data";

export const devApiPrefix = "/api";
export const devWebSocketPath = "/ws";

export type ServerConfig = {
  host: string;
  port: number;
  dataDir: string;
};

export type ServerConfigError =
  | { code: "invalid_port"; value: string }
  | { code: "invalid_host"; value: string }
  | { code: "invalid_data_dir"; value: string }
  | { code: "invalid_cli"; value: string };

export type ServerConfigResult =
  | { ok: true; value: ServerConfig }
  | { ok: false; error: ServerConfigError };

export type DevProxyTarget = {
  http: string;
  ws: string;
};

const configSchema = v.strictObject({
  port: v.pipe(
    v.string(),
    v.regex(/^[0-9]{1,5}$/),
    v.transform(Number),
    v.minValue(1),
    v.maxValue(65535),
  ),
  // LAN binding requires an explicit opt-in and Room token in #45.
  host: v.picklist(["127.0.0.1", "::1", "localhost"]),
  dataDir: v.pipe(
    v.string(),
    v.check((value) => value.trim().length > 0 && !value.includes("\0")),
  ),
});

const cliNames = new Map([
  ["--port", "PORT"],
  ["--host", "HOST"],
  ["--data-dir", "DATA_DIR"],
]);

/**
 * `apps/server/src/main.ts` and the bundled `apps/server/dist/main.mjs` are the
 * same depth, so both resolve the repository root with three `..` segments.
 */
export const serverEntryLayout = (moduleUrl: URL): { repoRoot: string; envFile: string } => ({
  repoRoot: fileURLToPath(new URL("../../..", moduleUrl)),
  envFile: fileURLToPath(new URL("../../../.env", moduleUrl)),
});

export const webConfigLayout = (moduleUrl: URL): { repoRoot: string; envFile: string } => ({
  repoRoot: fileURLToPath(new URL("../..", moduleUrl)),
  envFile: fileURLToPath(new URL("../../.env", moduleUrl)),
});

/**
 * Loads the repository `.env` with Node's env-file parser.
 * Variables already present in the environment are left unchanged.
 * A missing file is ignored.
 */
export const applyEnvFileIfPresent = (envFile: string): void => {
  if (!existsSync(envFile)) {
    return;
  }
  loadEnvFile(envFile);
};

/** CLI > process environment > repository .env > defaults. No positional/unknown/duplicate flags. */
export const loadServerConfig = (
  env: Readonly<Record<string, string | undefined>>,
  rootDir: string,
  args: readonly string[] = [],
): ServerConfigResult => {
  const overrides: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    const separator = arg.indexOf("=");
    const name = separator < 0 ? arg : arg.slice(0, separator);
    const key = cliNames.get(name);
    if (key === undefined || overrides[key] !== undefined) {
      return { ok: false, error: { code: "invalid_cli", value: arg } };
    }
    const value = separator < 0 ? args[++index] : arg.slice(separator + 1);
    if (value === undefined || value.startsWith("--")) {
      return { ok: false, error: { code: "invalid_cli", value: arg } };
    }
    overrides[key] = value;
  }
  const input = {
    port: overrides["PORT"] ?? env["PORT"] ?? String(defaultPort),
    host: overrides["HOST"] ?? env["HOST"] ?? defaultHost,
    dataDir: overrides["DATA_DIR"] ?? env["DATA_DIR"] ?? defaultDataDir,
  };
  const parsed = v.safeParse(configSchema, input);
  if (!parsed.success) {
    const key = parsed.issues[0].path?.[0]?.key;
    if (key === "port") return { ok: false, error: { code: "invalid_port", value: input.port } };
    if (key === "host") return { ok: false, error: { code: "invalid_host", value: input.host } };
    return { ok: false, error: { code: "invalid_data_dir", value: input.dataDir } };
  }
  return {
    ok: true,
    value: { ...parsed.output, dataDir: resolve(rootDir, parsed.output.dataDir) },
  };
};

export const productionPaths = (repoRoot: string): { webRoot: string; pyodideRoot: string } => ({
  webRoot: resolve(repoRoot, "apps/web/dist"),
  pyodideRoot: resolve(repoRoot, "apps/web/dist/pyodide"),
});

export const devProxyTarget = (config: Pick<ServerConfig, "host" | "port">): DevProxyTarget => {
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  return {
    http: `http://${host}:${config.port}`,
    ws: `ws://${host}:${config.port}`,
  };
};

export const formatServerConfigError = (error: ServerConfigError): string => {
  switch (error.code) {
    case "invalid_cli":
      return `Invalid argument ${JSON.stringify(error.value)}. Use --port, --host, or --data-dir once with a value.`;
    case "invalid_port":
      return `Invalid PORT ${JSON.stringify(error.value)}. Use an integer from 1 to 65535.`;
    case "invalid_host":
      return `Invalid HOST ${JSON.stringify(error.value)}. Use 127.0.0.1, ::1, or localhost; LAN binding is not supported yet.`;
    case "invalid_data_dir":
      return `Invalid DATA_DIR ${JSON.stringify(error.value)}. Use a non-empty path.`;
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
};
