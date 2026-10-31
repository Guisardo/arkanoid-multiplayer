import { pixiPipes } from "@assetpack/core/pixi";

/**
 * Ticket #151: gameplay frames (paddles, balls, particles) are authored at 4
 * texels per field unit. The field draws them ~4-15x enlarged, so 1:1 sources
 * were visibly blurry. AssetPack treats sources as the largest resolution and
 * records it as the frames' resolution, so every frame still measures the same
 * field units at runtime. The boot atlas (a large background) stays 1:1.
 */
const GAMEPLAY_TEXELS_PER_UNIT = 4;

export default {
  entry: "./raw-assets",
  output: "./public/assets",
  assetSettings: [
    {
      files: ["gameplay*/gameplay-atlas*"],
      settings: {
        "texture-packer": {
          resolutionOptions: { resolutions: { default: GAMEPLAY_TEXELS_PER_UNIT } },
        },
      },
    },
  ],
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