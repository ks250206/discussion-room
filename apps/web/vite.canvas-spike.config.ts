import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

// Isolated spike: no product entry, API proxy, environment file or persistence.
export default defineConfig({
  plugins: lazyPlugins(() => [react()]) ?? [],
  server: { host: "127.0.0.1", port: 4174, strictPort: true, open: "/canvas-spike.html" },
  preview: { host: "127.0.0.1", port: 4174, strictPort: true },
  build: { outDir: "dist-canvas-spike", rolldownOptions: { input: "canvas-spike.html" } },
});
