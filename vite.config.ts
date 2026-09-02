import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      sim: path.resolve(__dirname, "src/sim"),
      net: path.resolve(__dirname, "src/net"),
      signaling: path.resolve(__dirname, "src/signaling"),
      render: path.resolve(__dirname, "src/render"),
      input: path.resolve(__dirname, "src/input"),
      ui: path.resolve(__dirname, "src/ui"),
      content: path.resolve(__dirname, "src/content"),
      audio: path.resolve(__dirname, "src/audio"),
      persistence: path.resolve(__dirname, "src/persistence"),
      app: path.resolve(__dirname, "src/app"),
    },
  },
});
