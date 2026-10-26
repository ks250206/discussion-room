import { createAppServer } from "./app.ts";
import {
  applyEnvFileIfPresent,
  devProxyTarget,
  formatServerConfigError,
  loadServerConfig,
  serverEntryLayout,
} from "./config.ts";

const layout = serverEntryLayout(new URL(import.meta.url));
applyEnvFileIfPresent(layout.envFile);

const loaded = loadServerConfig(process.env, layout.repoRoot);
if (!loaded.ok) {
  console.error(formatServerConfigError(loaded.error));
  process.exit(1);
}

const server = createAppServer();
server.on("error", (error: Error) => {
  console.error(error.message);
  process.exit(1);
});

const { host, port, dataDir } = loaded.value;
server.listen(port, host, () => {
  console.log(`discussion-room server listening on ${devProxyTarget({ host, port }).http}`);
  console.log(`data directory: ${dataDir} (reserved; not created)`);
});
