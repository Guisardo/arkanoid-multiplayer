// Player skin registry (spec §13): UUID ids minted at authoring — never a
// small enum. Owner-colored ball variants = render-time tint on white-base
// sprites, never authored per-owner PNGs. All shipped skins pass the
// readability gate (content/readabilityGate).
import type { AssetProvenance, PlayerSkin } from "./skinTypes";

export type { PlayerSkin } from "./skinTypes";

const PROCEDURAL: AssetProvenance = {
  source: "authored in-repo (procedural descriptor)",
  license: "CC0",
  production: "procedural",
};

// UUIDs minted at authoring (crypto.randomUUID at mint time, pasted here).
const CLASSIC: PlayerSkin = {
  id: "6f2a1c34-9b8e-4d5a-8f21-0c4d7e9a1b20",
  name: "Classic Vaus",
  paddle: {
    bodyColor: 0xe8b04a,
    trimColor: 0xf8f8f8,
    trimThickness: 1,
    stripes: 0,
    stripeColor: 0xe8b04a,
    shape: "rounded",
    provenance: PROCEDURAL,
  },
  ball: {
    baseColor: 0xf8f8f8,
    pattern: "plain",
    radius: 3,
    provenance: PROCEDURAL,
  },
};

const NEON: PlayerSkin = {
  id: "a3d54b7e-1c2f-4e88-9a60-3b7f5d2c8e41",
  name: "Neon Runner",
  paddle: {
    bodyColor: 0x282838,
    trimColor: 0x00fcfc,
    trimThickness: 1,
    stripes: 3,
    stripeColor: 0x00fcfc,
    shape: "beveled",
    provenance: PROCEDURAL,
  },
  ball: {
    baseColor: 0xf0f0f0,
    pattern: "panel",
    radius: 3,
    provenance: PROCEDURAL,
  },
};

const RETRO: PlayerSkin = {
  id: "c8e91f2a-6d47-4b3c-b5a9-2e8f7c1d4a53",
  name: "Retro Arcade",
  paddle: {
    bodyColor: 0xd82800,
    trimColor: 0xfcbcd0,
    trimThickness: 1,
    stripes: 2,
    stripeColor: 0xfcbcd0,
    shape: "notched",
    provenance: PROCEDURAL,
  },
  ball: {
    baseColor: 0xf8f8f8,
    pattern: "core",
    radius: 3,
    provenance: PROCEDURAL,
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
