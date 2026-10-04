import { pixiPipes } from "@assetpack/core/pixi";

export default {
  entry: "./raw-assets",
  output: "./public/assets",
  pipes: [
    ...pixiPipes({
      cacheBust: true,
      resolutions: { default: 1 },
      compression: { jpg: true, png: true, webp: true },
      texturePacker: {
        nameStyle: "short",
        padding: 2,
        allowRotation: false,
        allowTrim: true,
        maximumTextureSize: 2048,
      },
      manifest: {
        createShortcuts: true,
        trimExtensions: true,
        includeFileSizes: "gzip",
        nameStyle: "short",
      },
    }),
  ],
};