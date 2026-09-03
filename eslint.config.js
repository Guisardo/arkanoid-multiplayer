import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "playwright-report/**", "test-results/**", "workers-dist/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { import: importPlugin },
    settings: {
      "import/resolver": { typescript: { project: "./tsconfig.json" } },
    },
    rules: {
      ...importPlugin.configs.recommended.rules,
      "import/no-default-export": "error",
      // ---- Seam rules (spec §2) ----
      // sim/ never imports DOM, Pixi, or network
      "import/no-restricted-paths": ["error", {
        zones: [
          // sim never imports render/input/net/signaling/audio/ui/persistence/app (direct DOM/Pixi/network owners)
          { target: "./src/sim", from: ["./src/render", "./src/input", "./src/net", "./src/signaling", "./src/audio", "./src/ui", "./src/persistence", "./src/app"] },
          // render reads snapshots only, never sim internals
          { target: "./src/render", from: ["./src/sim"] },
          // net moves Input frames + snapshots, not sim internals
          { target: "./src/net", from: ["./src/sim"] },
          // input emits Input frames only — never reads sim/render/ui
          { target: "./src/input", from: ["./src/sim", "./src/render", "./src/ui"] },
          // audio never touches sim
          { target: "./src/audio", from: ["./src/sim"] },
          // signaling never touches sim
          { target: "./src/signaling", from: ["./src/sim"] },
          // persistence is a leaf
          { target: "./src/persistence", from: ["./src/sim", "./src/render", "./src/ui", "./src/net", "./src/app"] },
          // content is a leaf
          { target: "./src/content", from: ["./src/sim", "./src/render", "./src/ui", "./src/net", "./src/app", "./src/input"] },
          // shared is the protocol leaf — imports nothing from modules
          { target: "./src/shared", from: ["./src/sim", "./src/render", "./src/ui", "./src/net", "./src/app", "./src/input", "./src/content", "./src/audio", "./src/signaling", "./src/persistence"] },
        ],
      }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    },
  },
  {
    files: ["src/sim/**"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          { name: "pixi.js", message: "sim must stay headless — no renderer imports." },
          { name: "ws", message: "sim is net-agnostic — no network imports." },
        ],
      }],
    },
  },
  {
    files: ["tests/**", "e2e/**"],
    rules: {
      // tests may import anything — seam tests deliberately violate boundaries to prove the lint catches them
      "import/no-restricted-paths": "off",
      // test fixtures/arrays are asserted non-empty by construction
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["**/*.cjs", "**/*.cts", "vite.config.ts", "vitest.config.ts", "eslint.config.*", "playwright.config.ts"],
    rules: {
      "import/no-default-export": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-deprecated": "off",
    },
  },
);
