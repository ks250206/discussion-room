import { defineConfig } from "vite-plus";

export default defineConfig({
  defaultPackage: "./apps/web",
  fmt: {
    ignorePatterns: ["docs/**"],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    include: ["{apps,packages}/*/src/**/*.test.{ts,tsx}"],
  },
  run: {
    cache: true,
  },
});
