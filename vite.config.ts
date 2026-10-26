import { defineConfig } from "vite-plus";

export default defineConfig({
  defaultPackage: "./apps/web",
  fmt: {
    printWidth: 100,
    ignorePatterns: ["docs/**"],
  },
  lint: {
    plugins: ["typescript", "unicorn", "oxc", "import"],
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "discussion-room", specifier: "./tools/lint/plugin.ts" },
    ],
    categories: {
      correctness: "error",
      suspicious: "error",
    },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "no-unused-vars": "error",
      eqeqeq: "error",
      "no-console": "error",
      "typescript/no-explicit-any": "error",
      "typescript/no-non-null-assertion": "error",
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-promises": "error",
      "typescript/no-unsafe-argument": "error",
      "typescript/no-unsafe-assignment": "error",
      "typescript/no-unsafe-call": "error",
      "typescript/no-unsafe-member-access": "error",
      "typescript/no-unsafe-return": "error",
      "typescript/switch-exhaustiveness-check": "error",
    },
    overrides: [
      {
        files: ["apps/web/**"],
        plugins: ["react", "jsx-a11y"],
        env: { browser: true },
        rules: {
          "react/react-in-jsx-scope": "off",
          "react/only-export-components": ["error", { allowConstantExport: true }],
        },
      },
      {
        files: ["apps/server/**", "tools/**"],
        env: { node: true },
        rules: {
          "no-console": "off",
        },
      },
      {
        files: ["packages/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  regex: "^(node:|react(-dom)?($|/))",
                  message:
                    "Shared packages must stay platform-agnostic: no Node built-ins or React.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["packages/domain/**"],
        rules: {
          "discussion-room/no-class": "error",
        },
      },
      {
        files: ["**/*.test.{ts,tsx}"],
        plugins: ["vitest"],
        rules: {
          "vitest/no-focused-tests": "error",
          "vitest/no-disabled-tests": "error",
          "vitest/no-identical-title": "error",
        },
      },
    ],
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    include: ["{apps,packages}/*/src/**/*.test.{ts,tsx}", "tools/**/*.test.ts"],
  },
  run: {
    cache: true,
  },
});
