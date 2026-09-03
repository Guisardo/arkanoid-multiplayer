// Lettered capsule pills (spec §13): custom-authored — no free pack ships
// Arkanoid lettered capsules. One pill per CapsuleTypeId (10 letters,
// shared/protocol). Rendered procedurally from descriptor + bitmap-font
// letter composite (pill-template + glyph), readable at game scale (12×6
// logical units, letter ≥ 4 px tall).
import type { AssetProvenance, CapsulePill } from "./skinTypes";

const PROCEDURAL: AssetProvenance = {
  source: "authored in-repo (procedural descriptor)",
  license: "CC0",
  production: "procedural",
};

/** Classic-accurate color coding per capsule letter. */
const E_PILL: CapsulePill = {
  letter: "E",
  color: 0xf84828,
  letterColor: 0xf8f8f8,
  provenance: PROCEDURAL,
};

export const CAPSULE_PILLS: readonly CapsulePill[] = [
  { letter: "B", color: 0x3cbcfc, letterColor: 0x101018, provenance: PROCEDURAL }, // Break
  { letter: "C", color: 0x58d858, letterColor: 0x101018, provenance: PROCEDURAL }, // Catch
  { letter: "D", color: 0xf878f8, letterColor: 0x101018, provenance: PROCEDURAL }, // Disruption (Duel)
  E_PILL, // Expand
  { letter: "L", color: 0xf8b838, letterColor: 0x101018, provenance: PROCEDURAL }, // Laser
  { letter: "M", color: 0x00fcfc, letterColor: 0x101018, provenance: PROCEDURAL }, // Multiball
  { letter: "P", color: 0xe8b04a, letterColor: 0x101018, provenance: PROCEDURAL }, // Player (extra life)
  { letter: "S", color: 0x8878f8, letterColor: 0xf8f8f8, provenance: PROCEDURAL }, // Slow
  { letter: "R", color: 0x883828, letterColor: 0xf8f8f8, provenance: PROCEDURAL }, // Reduce (negative)
  { letter: "?", color: 0xd8d8e8, letterColor: 0x101018, provenance: PROCEDURAL }, // Mystery
];

/** Pill descriptor for a capsule type; E pill as fallback for unknown letters. */
export function pillFor(letter: string): CapsulePill {
  return CAPSULE_PILLS.find((p) => p.letter === letter) ?? E_PILL;
}
