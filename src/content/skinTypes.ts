// Skin + theme registry types (spec §13). Content leaf — imports nothing
// outside shared/ content-safe leaves. Ids are UUIDs minted at authoring —
// never a small enum (collision-free across future packs).

/** Provenance record per asset (spec §13 license rules: CC0 only). */
export interface AssetProvenance {
  /** Source pack / author, e.g. "OGA Breakout set (Buch)". */
  source: string;
  /** License — must be "CC0" for committed assets. */
  license: "CC0";
  /** How the shipped asset was produced: "sourced" (downloaded) or "procedural" (generated). */
  production: "sourced" | "procedural";
}

/**
 * Paddle skin: shape/texture/trim variant, not just color. Rendered from a
 * descriptor (procedural geometry) or a sprite path once real assets land.
 */
export interface PaddleSkin {
  /** Body fill color (base, before any owner tint). */
  bodyColor: number;
  /** Trim (edge) color — the "not just color" variant signal. */
  trimColor: number;
  /** Trim thickness in logical units. */
  trimThickness: number;
  /** Optional texture: horizontal stripe count over the body. */
  stripes: number;
  /** Stripe color. */
  stripeColor: number;
  /** Shape variant: "rounded" | "beveled" | "notched". */
  shape: "rounded" | "beveled" | "notched";
  provenance: AssetProvenance;
}

/** Ball skin: white-base sprite tinted at render time for owner colors. */
export interface BallSkin {
  /** Base fill for the white-base sprite (kept near-white for tintability). */
  baseColor: number;
  /** Surface detail: "plain" | "panel" | "core". */
  pattern: "plain" | "panel" | "core";
  /** Radius in logical units (3 = classic). */
  radius: number;
  provenance: AssetProvenance;
}

/** A player skin = paddle skin + ball skin (spec §13). */
export interface PlayerSkin {
  id: string;
  name: string;
  paddle: PaddleSkin;
  ball: BallSkin;
}

/** Brick set entry: tier colors + crack overlay style for hit states. */
export interface BrickSet {
  id: string;
  name: string;
  /** Tier 1..6 → fill color. */
  tierColors: Record<number, number>;
  /** Silver fill. */
  silverColor: number;
  /** Gold fill. */
  goldColor: number;
  /** Crack overlay style for silver hit states. */
  crackStyle: "hairline" | "shatter" | "chip";
  provenance: AssetProvenance;
}

/** Field background descriptor (procedural until real assets land). */
export interface FieldBackground {
  /** Base fill color (must stay low-contrast — readability gate). */
  color: number;
  /** Optional starfield speckle density 0..1 (0 = flat). */
  starDensity: number;
  /** Darkening overlay alpha applied over the background (spec §13). */
  darkenAlpha: number;
}

/** Field theme (host-chosen, visual-only): brick set + background + UI chrome tint. */
export interface FieldTheme {
  id: string;
  name: string;
  brickSet: BrickSet;
  background: FieldBackground;
  /** UI chrome tint (HUD strip accents, menus). */
  chromeTint: number;
  provenance: AssetProvenance;
}

/** Capsule pill descriptor: letter + color coding per effect (spec §13). */
export interface CapsulePill {
  /** CapsuleTypeId letter — B C D E L M P S R ? (shared/protocol). */
  letter: string;
  /** Pill body color (classic-accurate coding). */
  color: number;
  /** Letter glyph color. */
  letterColor: number;
  provenance: AssetProvenance;
}

/** Doh boss sprite descriptor (behavior lands in ticket 49 — data only). */
export interface BossSprite {
  id: string;
  name: string;
  /** Body fill (moai head silhouette, procedural). */
  bodyColor: number;
  /** Eye/brow accent color. */
  accentColor: number;
  /** Width in logical units. */
  width: number;
  /** Height in logical units. */
  height: number;
  provenance: AssetProvenance;
}
