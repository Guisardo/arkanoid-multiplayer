// Touch launch button glyph (ticket #148, spec #140): which icon the launch
// button shows for a player. Pure and Pixi-free so sessions (and their jsdom
// tests) can compute it from the snapshot; `TouchOverlay` draws it.
import { isArmedPlayer, type Snapshot } from "shared/protocol";

/** What the launch button shows. */
export type LaunchGlyph = "launch" | "laser";

/**
 * Launch button glyph for a player: a ball stuck to their Paddle always wins
 * (the button launches it), otherwise Armed shows the laser glyph.
 */
export function launchGlyphFor(snap: Snapshot, player: number): LaunchGlyph {
  if (snap.balls.some((b) => b.attachedTo === player)) return "launch";
  const me = snap.players.find((p) => p.player === player);
  return me !== undefined && isArmedPlayer(me) ? "laser" : "launch";
}
