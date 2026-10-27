import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";
// Build-time Node config is shared so the dev proxy and server resolve one target.
// It stays outside packages/*, whose exports must remain platform-agnostic.
import {
  applyEnvFileIfPresent,
  devApiPrefix,
  devProxyTarget,
  devWebSocketPath,
  formatServerConfigError,
  loadServerConfig,
  webConfigLayout,
} from "../server/src/config.ts";

const layout = webConfigLayout(new URL(import.meta.url));

export default defineConfig(({ command, isPreview }) => {
  const shared = {
    envDir: layout.repoRoot,
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    plugins: lazyPlugins(() => [react(), tailwindcss()]) ?? [],
  };
  if (command !== "serve" || isPreview === true) {
    return shared;
  }

  applyEnvFileIfPresent(layout.envFile);
  const loaded = loadServerConfig(process.env, layout.repoRoot);
  if (!loaded.ok) {
    throw new Error(formatServerConfigError(loaded.error));
  }

  const target = devProxyTarget(loaded.value);
  return {
    ...shared,
    server: {
      proxy: {
        [`^${devApiPrefix}(?:/|$|\\?)`]: {
          target: target.http,
          changeOrigin: true,
        },
        [`^${devWebSocketPath}(?:\\?|$)`]: {
          target: target.ws,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
