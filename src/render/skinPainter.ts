// Skin painter (spec §13): draws paddle/ball/capsule/boss sprites from
// content descriptors — procedural geometry, no PNG assets. For Paddles and
// balls this is the fallback when the Skin's sprite frame is unavailable. Owner-colored
// ball variants = render-time tint on white-base sprites (never per-owner
// PNGs). Pixi Graphics only — no DOM, safe in node tests.
import type { Graphics } from "pixi.js";
import type { BallSkin, BossSprite, CapsulePill, PaddleSkin } from "content/skinTypes";
import { CAPSULE_W, CAPSULE_H } from "shared/gridConstants";
import { glyphPixels } from "./pillGlyphs";
import { darken, lighten } from "./colorMix";

/** Axis-aligned rect in field units. */
export interface PaintRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Depth of a bevel corner cut or a notch, in field units. */
const PADDLE_CUT = 1;

/** How far a capsule's top band mixes toward white, its bottom band toward black. */
const CAPSULE_HIGHLIGHT_MIX = 0.4;
const CAPSULE_SHADE_MIX = 0.35;

/**
 * Draw a paddle skin at center (x, y) with logical w × h: the procedural
 * stand-in for the Skin's sprite art (issue #152), in the same palette. The
 * shape is traced, filled with the trim color, then inset by the trim and
 * filled with the body, so corners and notches are cut out of the shape —
 * the field shows through them — never painted over in black.
 */
export function paintPaddle(gfx: Graphics, skin: PaddleSkin, x: number, y: number, w: number, h: number): void {
  const t = skin.trimThickness;
  const left = x - w / 2;
  const top = y - h / 2;
  tracePaddle(gfx, skin.shape, left, top, w, h).fill(skin.trimColor);
  tracePaddle(gfx, skin.shape, left + t, top + t, w - 2 * t, h - 2 * t).fill(skin.bodyColor);
  for (const r of paddleStripes(skin, left, top, w, h)) {
    gfx.rect(r.x, r.y, r.w, r.h).fill(skin.stripeColor);
  }
}

/**
 * Stripe rows for a paddle whose top-left is (left, top). Stripes are whole
 * 1-unit rows with a body row between them and against the trim: a fractional
 * band is sub-pixel at game scale and reads as a barcode. Stripes that do not
 * fit are dropped; the ones that do are centred in the interior.
 */
export function paddleStripes(skin: PaddleSkin, left: number, top: number, w: number, h: number): PaintRect[] {
  const t = skin.trimThickness;
  const rows = Math.floor(h - 2 * t);
  const count = Math.min(skin.stripes, Math.floor((rows - 1) / 2));
  if (count <= 0) return [];
  const first = Math.floor((rows - (2 * count - 1)) / 2);
  // Keep stripes off the shaped ends: the pill's round caps, the bevel cuts.
  const inset = skin.shape === "rounded" ? h / 2 : t + (skin.shape === "beveled" ? PADDLE_CUT : 0);
  const out: PaintRect[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ x: left + inset, y: top + t + first + 2 * i, w: w - 2 * inset, h: 1 });
  }
  return out;
}

/** Trace (not fill) a paddle outline; the caller fills it. */
function tracePaddle(gfx: Graphics, shape: PaddleSkin["shape"], left: number, top: number, w: number, h: number): Graphics {
  const right = left + w;
  const bottom = top + h;
  if (shape === "rounded") return gfx.roundRect(left, top, w, h, h / 2);
  if (shape === "beveled") {
    const c = Math.min(PADDLE_CUT, h / 2, w / 2);
    return gfx.poly([
      left + c, top, right - c, top, right, top + c, right, bottom - c,
      right - c, bottom, left + c, bottom, left, bottom - c, left, top + c,
    ]);
  }
  // Notched: a centre notch cut into the top and bottom edges.
  const cx = left + w / 2;
  const half = w / 12;
  const d = Math.min(PADDLE_CUT, h / 4);
  return gfx.poly([
    left, top, cx - half, top, cx - half, top + d, cx + half, top + d, cx + half, top, right, top,
    right, bottom, cx + half, bottom, cx + half, bottom - d, cx - half, bottom - d, cx - half, bottom, left, bottom,
  ]);
}

/**
 * Draw a ball skin at (x, y). White-base circle + pattern detail. Owner
 * colors are a render-time tint over the white base (spec §13 — never
 * authored per-owner PNGs): pass `tint` to recolor the body; the pattern
 * detail stays visible through it.
 */
export function paintBall(gfx: Graphics, skin: BallSkin, x: number, y: number, tint?: number): void {
  const r = skin.radius;
  gfx.circle(x, y, r).fill(tint ?? skin.baseColor);
  if (skin.pattern === "panel") {
    // horizontal seam
    gfx.rect(x - r, y - 0.5, 2 * r, 1).fill(0xc8c8d8);
  } else if (skin.pattern === "core") {
    // inner core dot
    gfx.circle(x, y, r * 0.4).fill(0xc8c8d8);
  }
}

/**
 * Owner glow: ring in the owner color — the readability-gate layer that
 * renders over whatever skin the ball wears (spec §13). Never the sole
 * signal for Duel ownership; always drawn on top of the ball skin.
 * 2px solid ring (readability: 1px alpha rings were too subtle to map
 * the ball to its owner at gameplay speed).
 */
export function paintOwnerGlow(gfx: Graphics, x: number, y: number, r: number, owner: number): void {
  gfx.circle(x, y, r + 2).fill(owner);
  gfx.circle(x, y, r).fill(0xffffff);
}

/** A filled rect: a band of a procedural sprite. */
export interface PaintBand {
  rect: PaintRect;
  color: number;
}

/**
 * Cylinder bands for a capsule whose top-left is (left, top): a 1-unit
 * highlight row along the top and a 1-unit shade row along the bottom, both
 * tones derived from the body color. Without them a 6-unit pill in a Brick
 * color reads as a Brick (issue #160). Bands stop where the round caps begin
 * so the caps keep their curve.
 */
export function capsuleBands(pill: CapsulePill, left: number, top: number): PaintBand[] {
  const cap = CAPSULE_H / 2;
  const x = left + cap;
  const w = CAPSULE_W - 2 * cap;
  return [
    { rect: { x, y: top, w, h: 1 }, color: lighten(pill.color, CAPSULE_HIGHLIGHT_MIX) },
    { rect: { x, y: top + CAPSULE_H - 1, w, h: 1 }, color: darken(pill.color, CAPSULE_SHADE_MIX) },
  ];
}

/** Draw a lettered capsule pill at center (x, y) — pill body + glyph composite. */
export function paintCapsule(gfx: Graphics, pill: CapsulePill, x: number, y: number): void {
  const w = CAPSULE_W;
  const h = CAPSULE_H;
  const left = x - w / 2;
  const top = y - h / 2;
  // One rounded shape: a full rect under end-cap circles hides the caps (issue #160)
  gfx.roundRect(left, top, w, h, h / 2).fill(pill.color);
  for (const band of capsuleBands(pill, left, top)) {
    gfx.rect(band.rect.x, band.rect.y, band.rect.w, band.rect.h).fill(band.color);
  }
  // Letter glyph: 3×5 pixels centered, 1 unit per pixel → 3×5 of the 12×6 pill
  const pixels = glyphPixels(pill.letter);
  const gx = x - 1.5;
  const gy = y - 2.5;
  for (const p of pixels) {
    gfx.rect(gx + p.x, gy + p.y, 1, 1).fill(pill.letterColor);
  }
}

/** Draw the Doh boss sprite (moai silhouette) at center (x, y). Data-only — behavior in ticket 49. */
export function paintBoss(gfx: Graphics, boss: BossSprite, x: number, y: number): void {
  const w = boss.width;
  const h = boss.height;
  const left = x - w / 2;
  const top = y - h / 2;
  // Head block with brow overhang
  gfx.rect(left, top, w, h).fill(boss.bodyColor);
  gfx.rect(left + w * 0.2, top - 2, w * 0.6, 4).fill(boss.bodyColor);
  // Eyes + nose + mouth (moai features)
  gfx.rect(left + w * 0.25, top + h * 0.25, w * 0.12, h * 0.15).fill(boss.accentColor);
  gfx.rect(left + w * 0.63, top + h * 0.25, w * 0.12, h * 0.15).fill(boss.accentColor);
  gfx.rect(left + w * 0.46, top + h * 0.35, w * 0.08, h * 0.3).fill(0x000000);
  gfx.rect(left + w * 0.3, top + h * 0.75, w * 0.4, h * 0.1).fill(0x000000);
}
