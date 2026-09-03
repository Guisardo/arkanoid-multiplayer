import { BALL_R, PADDLE_H, PADDLE_W } from "./constants";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Box overlap test; edge contact counts (spec §5). Boxes are center-based:
 * (x, y) is the center, (w, h) full extents.
 */
export function aabbOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return (
    Math.abs(ax - bx) <= (aw + bw) / 2 &&
    Math.abs(ay - by) <= (ah + bh) / 2
  );
}

export interface CircleBoxResolution {
  x: number;
  y: number;
}

/**
 * Resolve a circle (center x/y, radius r) out of a box it overlaps, along the
 * axis of least penetration. Returns null if no overlap.
 */
export function resolveCircleBoxOverlap(
  cx: number, cy: number, r: number,
  bx: number, by: number, bw: number, bh: number,
): CircleBoxResolution | null {
  const dx = cx - bx;
  const dy = cy - by;
  const overlapX = bw / 2 + r - Math.abs(dx);
  const overlapY = bh / 2 + r - Math.abs(dy);
  // Edge contact counts (spec §5) — include the zero-overlap boundary.
  if (overlapX < 0 || overlapY < 0) return null;
  if (overlapX < overlapY) {
    return { x: bx + Math.sign(dx || 1) * (bw / 2 + r), y: cy };
  }
  return { x: cx, y: by + Math.sign(dy || 1) * (bh / 2 + r) };
}

/** Max deflect angle from vertical (radians) — classic ~60°. */
const MAX_DEFLECT = (60 * Math.PI) / 180;

/**
 * Classic offset-deflect: ball bounces off the paddle with horizontal velocity
 * proportional to where it hit relative to the paddle center, clamped to
 * ±60° from vertical. Speed preserved (spec §5).
 */
export function offsetDeflect(
  ballX: number, speed: number, paddle: Box, ballR: number,
): { vx: number; vy: number } {
  const halfW = paddle.w / 2 + ballR;
  // t in [-1..1]: contact offset from paddle center, normalized.
  const t = Math.max(-1, Math.min(1, (ballX - paddle.x) / halfW));
  const angle = t * MAX_DEFLECT;
  return {
    vx: speed * Math.sin(angle),
    vy: -speed * Math.cos(angle),
  };
}

/**
 * Edge-contact clamp: a ball striking a surface at a shallow angle (within 60°
 * of horizontal) is clamped to 60° up-and-away, preserving speed (spec §5).
 * vy must be negative (moving up) for the "up-and-away" semantics.
 */
export function clampEdgeAngle(
  vx: number, vy: number, speed: number,
): { vx: number; vy: number } {
  const angleFromVertical = Math.atan2(Math.abs(vx), Math.abs(vy));
  if (angleFromVertical <= MAX_DEFLECT) return { vx, vy };
  const dirX = Math.sign(vx) || 1;
  const dirY = vy >= 0 ? 1 : -1;
  return {
    vx: dirX * speed * Math.sin(MAX_DEFLECT),
    vy: dirY * speed * Math.cos(MAX_DEFLECT),
  };
}

/** Paddle box helper (center-based). */
export function paddleBox(x: number, y: number, w = PADDLE_W, h = PADDLE_H): Box {
  return { x, y, w, h };
}

/** Ball bounding box (center-based). */
export function ballBox(x: number, y: number, r = BALL_R): Box {
  return { x, y, w: r * 2, h: r * 2 };
}
