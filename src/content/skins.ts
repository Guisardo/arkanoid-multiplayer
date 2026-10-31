// Player skin registry (spec §13): UUID ids minted at authoring — never a
// small enum. Owner-colored ball variants = render-time tint on white-base
// sprites, never authored per-owner PNGs. All shipped skins pass the
// readability gate (content/readabilityGate).
import { SPRITE_PATHS } from "./spriteFrames";
import type { AssetProvenance, PlayerSkin } from "./skinTypes";

export type { PlayerSkin } from "./skinTypes";

// Tiny Break-em Pack (Screaming Brain Studios, OGA) — CC0, sourced PNGs.
const TINY_BREAKEM: AssetProvenance = {
  source: 'OGA "Tiny Break-em Pack" (Screaming Brain Studios)',
  license: "CC0",
  production: "sourced",
};

/**
 * Gray pill body every Tiny Break-em paddle shares. Issue #152: the sprite art
 * is a Skin's canonical look, so the procedural fallback (node tests, atlas
 * load failure) paints from the same palette — gray body, the Skin's accent.
 */
const PADDLE_ART_BODY = 0xa9a9a9;

// UUIDs minted at authoring (crypto.randomUUID at mint time, pasted here).
const CLASSIC: PlayerSkin = {
  id: "6f2a1c34-9b8e-4d5a-8f21-0c4d7e9a1b20",
  name: "Classic Vaus",
  paddle: {
    bodyColor: PADDLE_ART_BODY,
    trimColor: 0xdf8080,
    trimThickness: 1,
    stripes: 0,
    stripeColor: 0xdf8080,
    shape: "rounded",
    sprite: SPRITE_PATHS.paddles.red,
    provenance: TINY_BREAKEM,
  },
  ball: {
    baseColor: 0xf8f8f8,
    pattern: "plain",
    radius: 3,
    sprite: SPRITE_PATHS.balls.base,
    provenance: TINY_BREAKEM,
  },
};

const NEON: PlayerSkin = {
  id: "a3d54b7e-1c2f-4e88-9a60-3b7f5d2c8e41",
  name: "Neon Runner",
  paddle: {
    bodyColor: PADDLE_ART_BODY,
    trimColor: 0xca4cff,
    trimThickness: 1,
    stripes: 3,
    stripeColor: 0xca4cff,
    shape: "beveled",
    sprite: SPRITE_PATHS.paddles.purple,
    provenance: TINY_BREAKEM,
  },
  ball: {
    baseColor: 0xf0f0f0,
    pattern: "panel",
    radius: 3,
    sprite: SPRITE_PATHS.balls.base,
    provenance: TINY_BREAKEM,
  },
};

const RETRO: PlayerSkin = {
  id: "c8e91f2a-6d47-4b3c-b5a9-2e8f7c1d4a53",
  name: "Retro Arcade",
  paddle: {
    bodyColor: PADDLE_ART_BODY,
    trimColor: 0x7070fe,
    trimThickness: 1,
    stripes: 2,
    stripeColor: 0x7070fe,
    shape: "notched",
    sprite: SPRITE_PATHS.paddles.blue,
    provenance: TINY_BREAKEM,
  },
  ball: {
    baseColor: 0xf8f8f8,
    pattern: "core",
    radius: 3,
    sprite: SPRITE_PATHS.balls.base,
    provenance: TINY_BREAKEM,
  },
};

export const SKINS: readonly PlayerSkin[] = [CLASSIC, NEON, RETRO];

/** Default skin (Settings Appearance default selection). */
export const DEFAULT_SKIN: PlayerSkin = CLASSIC;
export const DEFAULT_SKIN_ID: string = CLASSIC.id;

/** Look up a skin by UUID; null when unknown (caller falls back to default). */
export function getSkin(id: string | null): PlayerSkin | null {
  if (id === null) return null;
  return SKINS.find((s) => s.id === id) ?? null;
}

/** Skin for a compact per-session skin index (byte); default when out of range. */
export function skinByIndex(index: number): PlayerSkin {
  return SKINS[index] ?? DEFAULT_SKIN;
}
