import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

// Separate entry and output: product App and its default build stay unchanged.
export default defineConfig({
  plugins: lazyPlugins(() => [react()]) ?? [],
  worker: { format: "es" },
  build: {
    outDir: "dist-pyodide-spike",
    rolldownOptions: { input: "pyodide-spike.html" },
  },
  server: { host: "127.0.0.1", port: 4175, strictPort: true },
  preview: { host: "127.0.0.1", port: 4275, strictPort: true },
});
