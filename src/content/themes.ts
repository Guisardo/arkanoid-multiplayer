// Field theme registry (spec §13): host-chosen, visual-only. UUID ids minted
// at authoring — never a small enum. Brick sets + background + UI chrome tint.
// All shipped themes pass the readability gate (content/readabilityGate).
import type { AssetProvenance, FieldTheme } from "./skinTypes";

export type { FieldTheme } from "./skinTypes";

const PROCEDURAL: AssetProvenance = {
  source: "authored in-repo (procedural descriptor)",
  license: "CC0",
  production: "procedural",
};

const ARCADE_CLASSIC: FieldTheme = {
  id: "1e4a9c7b-3f52-4d68-9c81-a5b3e7f2d904",
  name: "Arcade Classic",
  brickSet: {
    id: "brickset-arcade-classic",
    name: "Arcade Classic bricks",
    tierColors: {
      1: 0xd82800,
      2: 0xfc9838,
      3: 0xfcbcd0,
      4: 0x58f898,
      5: 0x00fcfc,
      6: 0x00b8fc,
    },
    silverColor: 0xbcbcbc,
    goldColor: 0xdca850,
    crackStyle: "hairline",
    provenance: PROCEDURAL,
  },
  background: { color: 0x101018, starDensity: 0, darkenAlpha: 0, sprite: null },
  chromeTint: 0xe8b04a,
  provenance: PROCEDURAL,
};

const DEEP_SPACE: FieldTheme = {
  id: "7b2c8d4e-1a63-4f9b-8e2d-6c4a9f3b7e15",
  name: "Deep Space",
  brickSet: {
    id: "brickset-deep-space",
    name: "Deep Space bricks",
    tierColors: {
      1: 0xc84838,
      2: 0xe88848,
      3: 0xf8c890,
      4: 0x78c878,
      5: 0x48c8e8,
      6: 0x4878e8,
    },
    silverColor: 0xa8a8b8,
    goldColor: 0xd8a840,
    crackStyle: "shatter",
    provenance: PROCEDURAL,
  },
  background: { color: 0x080818, starDensity: 0.06, darkenAlpha: 0.15, sprite: "/assets/backgrounds/pixel-space.png" },
  chromeTint: 0x00fcfc,
  provenance: PROCEDURAL,
};

const SUNSET: FieldTheme = {
  id: "9d6e2f1a-8c74-4a3e-b1d5-0f9a8c3e6b27",
  name: "Sunset Drive",
  brickSet: {
    id: "brickset-sunset-drive",
    name: "Sunset Drive bricks",
    tierColors: {
      1: 0xf85838,
      2: 0xf88848,
      3: 0xf8b878,
      4: 0xc87858,
      5: 0xe878b8,
      6: 0xb85898,
    },
    silverColor: 0xc0c0c0,
    goldColor: 0xe8b850,
    crackStyle: "chip",
    provenance: PROCEDURAL,
  },
  background: { color: 0x1a0a14, starDensity: 0, darkenAlpha: 0.1, sprite: null },
  chromeTint: 0xf878f8,
  provenance: PROCEDURAL,
};

export const THEMES: readonly FieldTheme[] = [ARCADE_CLASSIC, DEEP_SPACE, SUNSET];

/** Default theme (Settings Appearance default selection). */
export const DEFAULT_THEME: FieldTheme = ARCADE_CLASSIC;
export const DEFAULT_THEME_ID: string = ARCADE_CLASSIC.id;

/** Look up a theme by UUID; null when unknown (caller falls back to default). */
export function getTheme(id: string | null): FieldTheme | null {
  if (id === null) return null;
  return THEMES.find((t) => t.id === id) ?? null;
}
