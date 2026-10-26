import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

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
  | { code: "invalid_data_dir"; value: string };

export type ServerConfigResult =
  | { ok: true; value: ServerConfig }
  | { ok: false; error: ServerConfigError };

export type DevProxyTarget = {
  http: string;
  ws: string;
};

const parsePort = (value: string): number | undefined => {
  if (!/^[0-9]{1,5}$/.test(value)) {
    return undefined;
  }
  const port = Number(value);
  if (port < 1 || port > 65535) {
    return undefined;
  }
  return port;
};

// LAN binding requires an explicit opt-in and Room token in #45.
const isValidHost = (value: string): boolean =>
  value === "127.0.0.1" || value === "::1" || value === "localhost";

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

export const loadServerConfig = (
  env: Readonly<Record<string, string | undefined>>,
  rootDir: string,
): ServerConfigResult => {
  const portRaw = env["PORT"];
  const port = portRaw === undefined ? defaultPort : parsePort(portRaw);
  if (port === undefined) {
    return { ok: false, error: { code: "invalid_port", value: portRaw ?? "" } };
  }

  const hostRaw = env["HOST"];
  const host = hostRaw === undefined ? defaultHost : hostRaw;
  if (!isValidHost(host)) {
    return { ok: false, error: { code: "invalid_host", value: hostRaw ?? "" } };
  }

  const dataDirRaw = env["DATA_DIR"];
  const dataDirInput = dataDirRaw === undefined ? defaultDataDir : dataDirRaw;
  if (dataDirInput.length === 0 || dataDirInput.includes("\0")) {
    return { ok: false, error: { code: "invalid_data_dir", value: dataDirInput } };
  }

  return {
    ok: true,
    value: {
      host,
      port,
      dataDir: resolve(rootDir, dataDirInput),
    },
  };
};

export const devProxyTarget = (config: Pick<ServerConfig, "host" | "port">): DevProxyTarget => {
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  return {
    http: `http://${host}:${config.port}`,
    ws: `ws://${host}:${config.port}`,
  };
};

export const formatServerConfigError = (error: ServerConfigError): string => {
  switch (error.code) {
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
