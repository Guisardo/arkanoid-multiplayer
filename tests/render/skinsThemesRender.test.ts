import { describe, expect, it } from "vitest";
import { Graphics } from "pixi.js";
import { brickDamage, crackSegments } from "render/brickCracks";
import { starPositions, paintFieldBackground } from "render/themeBackground";
import { glyphPixels, PILL_GLYPHS, PILL_LETTERS } from "render/pillGlyphs";
import { paintPaddle, paintBall, paintOwnerGlow, paintCapsule, paintBoss, paddleStripes } from "render/skinPainter";
import { SKINS, DEFAULT_SKIN } from "content/skins";
import { DEFAULT_THEME } from "content/themes";
import { pillFor } from "content/capsulePills";
import { DOH_BOSS } from "content/bosses";
import { silverCell } from "shared/protocol";

describe("brick crack overlays (spec §13)", () => {
  it("damage = max hits − hits remaining", () => {
    expect(brickDamage(silverCell(4))).toBe(0);
    expect(brickDamage(silverCell(3))).toBe(1);
    expect(brickDamage(silverCell(1))).toBe(3);
    expect(brickDamage(1)).toBe(0); // colored
    expect(brickDamage(13)).toBe(0); // gold
    expect(brickDamage(0)).toBe(0); // empty
  });

  it("segments scale with damage: 0 → none, 1..3 hits → 1..3 segments", () => {
    expect(crackSegments(silverCell(4), "hairline")).toHaveLength(0);
    expect(crackSegments(silverCell(3), "hairline")).toHaveLength(1);
    expect(crackSegments(silverCell(2), "hairline")).toHaveLength(2);
    expect(crackSegments(silverCell(1), "hairline")).toHaveLength(3);
  });

  it("deterministic: same cell + style → same segments", () => {
    for (const style of ["hairline", "shatter", "chip"] as const) {
      expect(crackSegments(silverCell(2), style)).toEqual(crackSegments(silverCell(2), style));
    }
  });

  it("segments stay inside the 16×8 brick-local box", () => {
    for (const style of ["hairline", "shatter", "chip"] as const) {
      for (const seg of crackSegments(silverCell(1), style)) {
        expect(seg.x1).toBeGreaterThanOrEqual(0);
        expect(seg.x2).toBeLessThanOrEqual(16);
        expect(seg.y1).toBeGreaterThanOrEqual(0);
        expect(seg.y2).toBeLessThanOrEqual(8);
      }
    }
  });
});

describe("theme background speckle (spec §13)", () => {
  it("zero density → no stars", () => {
    expect(starPositions(0)).toEqual([]);
  });

  it("deterministic LCG: same density → same positions", () => {
    expect(starPositions(0.5)).toEqual(starPositions(0.5));
  });

  it("positions stay inside the 208×256 field", () => {
    for (const s of starPositions(1)) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(208);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThan(256);
    }
  });

  it("paints without throwing (headless Graphics)", () => {
    const gfx = new Graphics();
    paintFieldBackground(gfx, DEFAULT_THEME.background);
    paintFieldBackground(gfx, { color: 0x080818, starDensity: 0.06, darkenAlpha: 0.15, sprite: null });
  });
});

describe("pill glyphs (spec §13)", () => {
  it("glyph table covers exactly the 10 capsule letters", () => {
    expect(Object.keys(PILL_GLYPHS).sort()).toEqual([...PILL_LETTERS].sort());
  });

  it("every glyph is 5 rows × 3 cols and non-empty", () => {
    for (const letter of PILL_LETTERS) {
      const glyph = PILL_GLYPHS[letter];
      expect(glyph).toHaveLength(5);
      for (const row of glyph) expect(row).toHaveLength(3);
      expect(glyphPixels(letter).length).toBeGreaterThan(0);
    }
  });

  it("unknown letter → no pixels (pill renders body only)", () => {
    expect(glyphPixels("X")).toEqual([]);
  });
});

describe("skin painter (spec §13, headless Graphics)", () => {
  it("paints paddle/ball/glow/capsule/boss without throwing", () => {
    const gfx = new Graphics();
    paintPaddle(gfx, DEFAULT_SKIN.paddle, 104, 242, 32, 6);
    paintBall(gfx, DEFAULT_SKIN.ball, 104, 100);
    paintBall(gfx, DEFAULT_SKIN.ball, 120, 100, 0xf84828); // owner tint (render-time)
    paintOwnerGlow(gfx, 104, 100, 3, 0xf84828);
    for (const pill of ["B", "C", "D", "E", "L", "M", "P", "S", "R", "?"]) {
      paintCapsule(gfx, pillFor(pill), 104, 120);
    }
    paintBoss(gfx, DOH_BOSS, 104, 60);
  });

  it("paints every shipped skin without throwing", () => {
    for (const skin of SKINS) {
      const gfx = new Graphics();
      paintPaddle(gfx, skin.paddle, 104, 242, 32, 6);
      paintBall(gfx, skin.ball, 104, 100);
    }
  });

  it("owner glow ring: 2px solid owner color over a white base (readability)", () => {
    // Regression (duel ownership unreadable): the old 1px alpha-0.9 ring
    // was too subtle to map the ball to its owner. The ring must be a
    // solid 2px owner-color band with a white inner base.
    const gfx = new Graphics();
    paintOwnerGlow(gfx, 104, 100, 3, 0x3cbcfc);
    const instructions = (gfx.context as unknown as { instructions: unknown[] }).instructions;
    expect(instructions.length).toBe(2); // ring + white base, no third layer
  });
});

describe("Paddle fallback painter matches the art (issue #152)", () => {
  const neon = SKINS.find((s) => s.paddle.shape === "beveled")!.paddle;
  const retro = SKINS.find((s) => s.paddle.shape === "notched")!.paddle;
  const classic = SKINS.find((s) => s.paddle.shape === "rounded")!.paddle;

  /** Fill colors a Graphics recorded, in order. */
  function fillColors(gfx: Graphics): number[] {
    const instructions = (gfx.context as unknown as {
      instructions: Array<{ action: string; data: { style: { color: number } } }>;
    }).instructions;
    return instructions.filter((i) => i.action === "fill").map((i) => i.data.style.color);
  }

  it("draws stripes as whole-unit rows, dropping the ones that do not fit", () => {
    // 32×6 Paddle, 1-unit trim: 4 interior rows hold one stripe with a body
    // row either side; Neon asks for 3, so 2 are dropped.
    expect(paddleStripes(neon, 88, 239, 32, 6)).toEqual([{ x: 90, y: 241, w: 28, h: 1 }]);
    // 10 tall: 8 interior rows hold all 3, one body row apart.
    const tall = paddleStripes(neon, 88, 235, 32, 10);
    expect(tall.map((r) => r.y)).toEqual([237, 239, 241]);
    for (const r of tall) expect(r.h).toBe(1);
    expect(paddleStripes(classic, 88, 239, 32, 6)).toEqual([]);
  });

  it("cuts corners and notches out of the shape instead of painting them black", () => {
    for (const skin of SKINS) {
      const gfx = new Graphics();
      paintPaddle(gfx, skin.paddle, 104, 242, 32, 6);
      expect(fillColors(gfx), skin.name).not.toContain(0x000000);
    }
    const corner = { x: 88.2, y: 239.2 };
    const centre = { x: 104, y: 242 };
    for (const skin of [neon, classic]) {
      const gfx = new Graphics();
      paintPaddle(gfx, skin, 104, 242, 32, 6);
      expect(gfx.containsPoint(corner), skin.shape).toBe(false);
      expect(gfx.containsPoint(centre), skin.shape).toBe(true);
    }
    const notched = new Graphics();
    paintPaddle(notched, retro, 104, 242, 32, 6);
    expect(notched.containsPoint({ x: 104, y: 239.2 })).toBe(false); // the notch
    expect(notched.containsPoint({ x: 92, y: 239.2 })).toBe(true); // top edge beside it
  });

  it("paints the art palette: gray body under the Skin's accent trim", () => {
    for (const skin of SKINS) {
      const gfx = new Graphics();
      paintPaddle(gfx, skin.paddle, 104, 242, 32, 6);
      const colors = fillColors(gfx);
      expect(colors[0], skin.name).toBe(skin.paddle.trimColor);
      expect(colors[1], skin.name).toBe(skin.paddle.bodyColor);
    }
  });
});
