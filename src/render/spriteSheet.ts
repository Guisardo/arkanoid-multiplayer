// Sprite loading for real CC0 assets (spec §13). Node-guarded like
// gameFont.ts: in node tests there is no DOM/fetch, so lookups resolve to
// null and painters fall back to procedural geometry. In the browser the
// Pixi Assets cache serves textures loaded once at boot (loadSkinSprites).
import { Assets } from "pixi.js";
import type { Texture } from "pixi.js";

/** Sprite descriptor paths shipped under public/assets (served verbatim). */
export const SPRITE_PATHS = {
  paddles: {
    red: "/assets/paddles/paddle-a-red.png",
    purple: "/assets/paddles/paddle-b-purple.png",
    blue: "/assets/paddles/paddle-c-blue.png",
  },
  balls: {
    red: "/assets/balls/ball-red.png",
    yellow: "/assets/balls/ball-yellow.png",
    green: "/assets/balls/ball-green.png",
  },
  backgrounds: {
    pixelSpace: "/assets/backgrounds/pixel-space.png",
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

/** Preload every shipped sprite once at boot; failures degrade to geometry. */
export async function loadSkinSprites(): Promise<void> {
  if (typeof document === "undefined") return;
  const paths = [
    ...Object.values(SPRITE_PATHS.paddles),
    ...Object.values(SPRITE_PATHS.balls),
    ...Object.values(SPRITE_PATHS.backgrounds),
  ];
  for (const path of paths) {
    try {
      rememberTexture(path, await Assets.load<Texture>(path));
    } catch {
      // Missing asset must never break the game — geometry fallback covers it.
    }
  }
}
