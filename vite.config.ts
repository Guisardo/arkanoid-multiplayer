import { defineConfig, loadEnv } from "vite";
import { codecovVitePlugin } from "@codecov/vite-plugin";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const token = process.env.CODECOV_TOKEN ?? env.CODECOV_TOKEN;

  return {
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
