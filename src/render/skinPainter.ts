// Skin painter (spec §13): draws paddle/ball/capsule/boss sprites from
// content descriptors — procedural geometry, no PNG assets. Owner-colored
// ball variants = render-time tint on white-base sprites (never per-owner
// PNGs). Pixi Graphics only — no DOM, safe in node tests.
import type { Graphics } from "pixi.js";
import type { BallSkin, BossSprite, CapsulePill, PaddleSkin } from "content/skinTypes";
import { CAPSULE_W, CAPSULE_H } from "shared/gridConstants";
import { glyphPixels } from "./pillGlyphs";

/** Draw a paddle skin at center (x, y) with logical w × h. */
export function paintPaddle(gfx: Graphics, skin: PaddleSkin, x: number, y: number, w: number, h: number): void {
  const t = skin.trimThickness;
  const left = x - w / 2;
  const top = y - h / 2;
  // Body
  gfx.rect(left, top, w, h).fill(skin.bodyColor);
  // Shape variants: notch a center gap; bevel = inset corners
  if (skin.shape === "notched") {
    const gap = w / 6;
    gfx.rect(x - gap / 2, top, gap, h).fill(0x000000);
  } else if (skin.shape === "beveled") {
    // corner cuts (dark = field bg shows through)
    gfx.rect(left, top, 1, 1).fill(0x000000);
    gfx.rect(left + w - 1, top, 1, 1).fill(0x000000);
    gfx.rect(left, top + h - 1, 1, 1).fill(0x000000);
    gfx.rect(left + w - 1, top + h - 1, 1, 1).fill(0x000000);
  }
  // Trim: top + bottom edges
  gfx.rect(left, top, w, t).fill(skin.trimColor);
  gfx.rect(left, top + h - t, w, t).fill(skin.trimColor);
  // Stripes: horizontal bands over the body
  if (skin.stripes > 0) {
    const bandH = (h - 2 * t) / (skin.stripes + 1);
    for (let i = 1; i <= skin.stripes; i++) {
      gfx.rect(left + t, top + t + bandH * i, w - 2 * t, Math.max(0.5, bandH * 0.4)).fill(skin.stripeColor);
    }
  }
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
 * Owner glow: ring in the owner color + white outline — the readability-gate
 * layer that renders over whatever skin the ball wears (spec §13). Never the
 * sole signal for Duel ownership; always drawn on top of the ball skin.
 * Draw order: owner ring (outermost) → white outline → ball skin on top.
 */
export function paintOwnerGlow(gfx: Graphics, x: number, y: number, r: number, owner: number): void {
  gfx.circle(x, y, r + 1).fill({ color: owner, alpha: 0.9 });
  gfx.circle(x, y, r + 0.5).fill(0xffffff);
}

/** Draw a lettered capsule pill at center (x, y) — pill body + glyph composite. */
export function paintCapsule(gfx: Graphics, pill: CapsulePill, x: number, y: number): void {
  const w = CAPSULE_W;
  const h = CAPSULE_H;
  const left = x - w / 2;
  const top = y - h / 2;
  // Pill body with rounded ends: body rect + two end caps (radius h/2)
  gfx.rect(left, top, w, h).fill(pill.color);
  gfx.circle(left + h / 2, y, h / 2).fill(pill.color);
  gfx.circle(left + w - h / 2, y, h / 2).fill(pill.color);
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
