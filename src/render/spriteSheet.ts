// Sprite loading for real CC0 assets (spec §13). Node-guarded like
// gameFont.ts: in node tests there is no DOM/fetch, so lookups resolve to
// null and painters fall back to procedural geometry. In the browser the
// Pixi Assets cache serves textures loaded once at boot via AssetPack manifest.
import { Assets } from "pixi.js";
import type { Texture } from "pixi.js";
import { assetUrl } from "./assetUrl";

/** Sprite descriptor paths — now using atlas frame names (AssetPack manifest). */
export const SPRITE_PATHS = {
  paddles: {
    red: "paddle-a-red.png",
    purple: "paddle-b-purple.png",
    blue: "paddle-c-blue.png",
  },
  balls: {
    red: "ball-red.png",
    yellow: "ball-yellow.png",
    green: "ball-green.png",
  },
  backgrounds: {
    pixelSpace: "pixel-space.png",
  },
} as const;

const loaded = new Map<string, Texture>();

/** Cache a loaded texture by path (called by the loader, not painters). */
export function rememberTexture(path: string, texture: Texture): void {
  loaded.set(path, texture);
}

/**
 * Look up a loaded texture. Null when unavailable (node tests, load failure,
 * or not yet loaded) — painters must fall back to procedural geometry.
 */
export function spriteTexture(path: string): Texture | null {
  if (typeof document === "undefined") return null;
  return loaded.get(path) ?? null;
}

/**
 * Initialize Pixi Assets with the AssetPack manifest and load the boot bundle.
 * Called once at app startup (src/app/main.ts).
 */
export async function initAssets(): Promise<void> {
  if (typeof document === "undefined") return;
  try {
    await Assets.init({ manifest: assetUrl("manifest.json") });
    await Assets.loadBundle("default");
    // Cache all sprite textures for painter lookups using known aliases
    const allAliases = [
      ...Object.values(SPRITE_PATHS.paddles),
      ...Object.values(SPRITE_PATHS.balls),
      ...Object.values(SPRITE_PATHS.backgrounds),
    ];
    for (const alias of allAliases) {
      try {
        const texture = Assets.get<Texture>(alias);
        rememberTexture(alias, texture);
      } catch {
        // Texture not in cache yet — will be loaded on demand
      }
    }
  } catch {
    // Missing manifest/bundle must never break the game — geometry fallback covers it.
  }
}

/** Preload every shipped sprite once at boot; failures degrade to geometry. */
export async function loadSkinSprites(): Promise<void> {
  // Kept for backward compatibility — now delegates to initAssets
  await initAssets();
}