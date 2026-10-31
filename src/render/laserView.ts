// Laser geometry (ticket #148, spec #140 Variant C: quiet and readable). Pure
// snapshot → rectangles, so FieldView only paints and the look is testable
// without Pixi: each Bolt is a thin yellow bar with no trail, and an Armed
// Paddle shows two tiny yellow ready-ticks over its ends while off cooldown
// (no glow). Readiness is the host's `laserReady`, so guests match the host
// and a shared Paddle (Shared Field mode C) shows its own cooldown.
import { isArmedPlayer, laserBoltXs, type Snapshot } from "shared/protocol";

/** Bolt and ready-tick yellow. */
export const LASER_COLOR = 0xffe040;
/** Drawn Bolt: 1 unit wide, 8 long, hanging down from the tip. */
export const BOLT_DRAW_W = 1;
export const BOLT_DRAW_LEN = 8;
/** Ready-tick: 1×2, a 1-unit gap above the Paddle top. */
export const READY_TICK_W = 1;
export const READY_TICK_H = 2;
export const READY_TICK_GAP = 1;

export interface DrawRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LaserShapes {
  bolts: DrawRect[];
  readyTicks: DrawRect[];
}

/** Rectangles for this frame: every Bolt, and ticks on Armed, ready Paddles. */
export function laserShapes(snap: Snapshot): LaserShapes {
  const bolts: DrawRect[] = [];
  for (const b of snap.bolts ?? []) {
    bolts.push({ x: b.x - BOLT_DRAW_W / 2, y: b.y, w: BOLT_DRAW_W, h: BOLT_DRAW_LEN });
  }
  const readyTicks: DrawRect[] = [];
  for (const p of snap.players) {
    if (!isArmedPlayer(p) || p.laserReady !== true) continue;
    const { x, y, w, h } = p.paddle;
    const top = y - h / 2 - READY_TICK_GAP - READY_TICK_H;
    for (const end of laserBoltXs(x, w)) {
      readyTicks.push({ x: end - READY_TICK_W / 2, y: top, w: READY_TICK_W, h: READY_TICK_H });
    }
  }
  return { bolts, readyTicks };
}
