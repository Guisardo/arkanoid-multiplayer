// Doh boss sprite registry (spec §13): data only — behavior lands in ticket 49.
// No free CC0 moai-head boss exists (research §4.6); authored procedurally
// as a moai-silhouette descriptor until real art lands.
import type { AssetProvenance, BossSprite } from "./skinTypes";

const PROCEDURAL: AssetProvenance = {
  source: "authored in-repo (procedural descriptor)",
  license: "CC0",
  production: "procedural",
};

export const DOH_BOSS: BossSprite = {
  id: "d5a3b8e1-7f42-4c69-a2d8-9e1b5c7f3a60",
  name: "Doh",
  bodyColor: 0x9a8a78,
  accentColor: 0x28c828,
  width: 48,
  height: 32,
  provenance: PROCEDURAL,
};

export const BOSSES: readonly BossSprite[] = [DOH_BOSS];

/** Boss sprite by UUID; null when unknown. */
export function getBoss(id: string): BossSprite | null {
  return BOSSES.find((b) => b.id === id) ?? null;
}
