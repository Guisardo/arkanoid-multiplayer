import { defineConfig, loadEnv } from "vite";
import { codecovVitePlugin } from "@codecov/vite-plugin";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const token = process.env.CODECOV_TOKEN ?? env.CODECOV_TOKEN;

  return {
    // GH Pages project site serves under /arkanoid-multiplayer/ (ticket 55);
    // dev/e2e keep the root base. VITE_BASE="" → "/".
    base: env.VITE_BASE || "/",
    build: {
      // Cache-busting for assets (ADR 0004): AssetPack generates content-hash filenames
      rollupOptions: {
        output: {
          assetFileNames: "assets/[name]-[hash][extname]",
          // ADR 0007: one chunk per game mode, so a player downloads the mode
          // they picked instead of every variant. Session creators import
          // these modules dynamically (app/soloEpisode, app/hostGame,
          // sim/versusBots), which is what keeps them out of the entry chunk.
          // Keyed by module id, not by a static name map: Rollup keeps the
          // chunk boundaries the dynamic imports already define, so there are
          // no empty facade chunks and no code duplicated between a facade
          // and its target.
          manualChunks(id) {
            if (!id.includes("/src/") && !id.includes("\\src\\")) return;
            const normalized = id.replaceAll("\\", "/");
            if (normalized.includes("src/sim/duel.ts")) return "mode-duel";
            if (normalized.includes("src/sim/sharedField.ts")) return "mode-sharedfield";
            if (normalized.includes("src/sim/attackSession.ts") || normalized.includes("src/sim/attack.ts")) {
              return "mode-attack";
            }
            if (normalized.includes("src/sim/assistSession.ts")) return "mode-assist";
            if (normalized.includes("src/sim/multiField.ts")) return "mode-race";
            if (normalized.includes("src/sim/versusBots.ts")) return "mode-bots";
            if (normalized.includes("src/sim/roundSim.ts")) return "mode-solo";
          },
        },
      },
    },
    plugins: [
      // Put the Codecov vite plugin after all other plugins
      codecovVitePlugin({
        enableBundleAnalysis: token !== undefined,
        bundleName: "arkanoid-multiplayer",
        ...(token !== undefined ? { uploadToken: token } : {}),
      }),
    ],
    resolve: {
      alias: {
        shared: path.resolve(__dirname, "src/shared"),
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
  };
});
