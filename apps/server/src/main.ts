import { existsSync } from "node:fs";
import { join } from "node:path";
import { createAppServer } from "./app.ts";
import {
  applyEnvFileIfPresent,
  devProxyTarget,
  formatServerConfigError,
  loadServerConfig,
  productionPaths,
  serverEntryLayout,
} from "./config.ts";
import { writeLog } from "./log.ts";

const layout = serverEntryLayout(new URL(import.meta.url));
try {
  applyEnvFileIfPresent(layout.envFile);
} catch (error) {
  writeLog({ level: "error", event: "config_error", message: String(error) });
  process.exit(1);
}
const loaded = loadServerConfig(process.env, layout.repoRoot, process.argv.slice(2));
if (!loaded.ok) {
  writeLog({
    level: "error",
    event: "config_error",
    message: formatServerConfigError(loaded.error),
  });
  process.exit(1);
}

// Source execution enables the loopback Vite origin. Bundles always use production policy.
const development =
  import.meta.url.endsWith("/src/main.ts") && process.env["NODE_ENV"] !== "production";
const paths = productionPaths(layout.repoRoot);
if (!development && !existsSync(join(paths.webRoot, "index.html"))) {
  writeLog({
    level: "error",
    event: "startup_error",
    message: "Web build missing. Run pnpm build before pnpm start.",
    webRoot: paths.webRoot,
  });
  process.exit(1);
}
const server = createAppServer({ development, ...paths });
let stopping = false;
let hasListened = false;
const shutdown = (reason: string): void => {
  if (stopping) return;
  stopping = true;
  writeLog({ level: "info", event: "shutdown_started", reason });
  server.close((error) => {
    if (error !== undefined) {
      writeLog({ level: "error", event: "shutdown_failed", message: error.message });
      process.exitCode = 1;
    } else writeLog({ level: "info", event: "shutdown_complete" });
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  });
};
const onInterrupt = (): void => shutdown("SIGINT");
const onTerminate = (): void => shutdown("SIGTERM");
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);
server.on("error", (error: Error) => {
  writeLog({
    level: "error",
    event: hasListened ? "server_error" : "startup_error",
    message: error.message,
  });
  process.exitCode = 1;
  shutdown("server_error");
});

const { host, port, dataDir } = loaded.value;
server.listen(port, host, () => {
  hasListened = true;
  const url = devProxyTarget({ host, port }).http;
  writeLog({
    level: "info",
    event: "server_listening",
    url,
    message: `discussion-room server listening on ${url}`,
    dataDir,
    dataDirStatus: "reserved_not_created",
    mode: development ? "development" : "production",
  });
});
