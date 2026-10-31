import { pixiPipes } from "@assetpack/core/pixi";

/**
 * Ticket #151: gameplay frames (paddles, balls, particles) are authored at 4
 * texels per field unit. The field draws them ~4-15x enlarged, so 1:1 sources
 * were visibly blurry. AssetPack treats sources as the largest resolution and
 * records it as the frames' resolution, so every frame still measures the same
 * field units at runtime. The boot atlas (a large background) stays 1:1.
 */
const GAMEPLAY_TEXELS_PER_UNIT = 4;

/** Packer settings shared by every atlas (`texturePacker.texturePacker`). */
const PACKER_OPTIONS = {
  nameStyle: "short",
  padding: 2,
  allowRotation: false,
  allowTrim: true,
};

export default {
  entry: "./raw-assets",
  output: "./public/assets",
  assetSettings: [
    {
      files: ["gameplay*/gameplay-atlas*"],
      settings: {
        "texture-packer": {
          resolutionOptions: { resolutions: { default: GAMEPLAY_TEXELS_PER_UNIT } },
          // Issue #152: untrimmed frames. Pixi's NineSliceSprite lays its UVs
          // over the trim box in original units, then the texture matrix maps
          // them onto the trimmed frame, which shifts a trimmed Paddle's cap
          // seam ~1 unit off the art's. Gameplay frames carry little margin.
          texturePacker: { ...PACKER_OPTIONS, allowTrim: false },
        },
      },
    },
  ],
  pipes: [
    ...pixiPipes({
      cacheBust: true,
      resolutions: { default: 1 },
      compression: { jpg: true, png: true, webp: true },
      // Issue #152: packer options live one level down, under `texturePacker`.
      // At the top level they were silently ignored, so frames came out
      // rotated, which the three-slice Paddle and the hand-cut fallback reject.
      texturePacker: {
        texturePacker: PACKER_OPTIONS,
        resolutionOptions: { maximumTextureSize: 2048 },
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