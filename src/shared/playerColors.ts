// Player identity colors (spec §13): used for the owner-colored outline
// glow (Duel ball ownership) and HUD color chips. Leaf module — imports
// nothing. Bright values chosen so the glow stays readable over every
// shipped field theme background (readability gate, content/readabilityGate).
export const PLAYER_COLORS: readonly number[] = [
  0xf84828, // P1 red
  0x3cbcfc, // P2 blue
  0x58d858, // P3 green
  0xf878f8, // P4 magenta
];

/** Owner color for a player index; P1 color for out-of-range indices. */
export function ownerColor(owner: number): number {
  return PLAYER_COLORS[owner] ?? PLAYER_COLORS[0] ?? 0xf84828;
}
