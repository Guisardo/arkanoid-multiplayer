import { describe, expect, it } from "vitest";
import { Graphics, Point } from "pixi.js";
import { capsuleBands, paintCapsule } from "render/skinPainter";
import { darken, lighten } from "render/colorMix";
import { CAPSULE_PILLS } from "content/capsulePills";
import { CAPSULE_H, CAPSULE_W } from "shared/gridConstants";

const CX = 104;
const CY = 120;
const LEFT = CX - CAPSULE_W / 2;
const TOP = CY - CAPSULE_H / 2;
const RIGHT = LEFT + CAPSULE_W;
const BOTTOM = TOP + CAPSULE_H;

describe("capsule pill shape (issue #160)", () => {
  for (const pill of CAPSULE_PILLS) {
    it(`pill ${pill.letter} has round ends, not square corners`, () => {
      const gfx = new Graphics();
      paintCapsule(gfx, pill, CX, CY);
      const inside = (x: number, y: number): boolean => gfx.containsPoint(new Point(x, y));
      for (const [x, y] of [
        [LEFT + 0.2, TOP + 0.2],
        [RIGHT - 0.2, TOP + 0.2],
        [LEFT + 0.2, BOTTOM - 0.2],
        [RIGHT - 0.2, BOTTOM - 0.2],
      ] as const) {
        expect(inside(x, y), `corner (${String(x)}, ${String(y)})`).toBe(false);
      }
      expect(inside(CX, CY)).toBe(true);
      expect(inside(LEFT + 0.2, CY)).toBe(true);
      expect(inside(RIGHT - 0.2, CY)).toBe(true);
    });
  }
});

describe("capsule cylinder bands (issue #160)", () => {
  it("lays a 1-unit highlight on top and a 1-unit shade on the bottom, off the caps", () => {
    const pill = CAPSULE_PILLS[0]!;
    const [highlight, shade] = capsuleBands(pill, LEFT, TOP);
    const cap = CAPSULE_H / 2;
    expect(highlight!.rect).toEqual({ x: LEFT + cap, y: TOP, w: CAPSULE_W - 2 * cap, h: 1 });
    expect(shade!.rect).toEqual({ x: LEFT + cap, y: BOTTOM - 1, w: CAPSULE_W - 2 * cap, h: 1 });
  });

  it("derives band tones from each pill's body color", () => {
    for (const pill of CAPSULE_PILLS) {
      const [highlight, shade] = capsuleBands(pill, LEFT, TOP);
      expect(highlight!.color).toBe(lighten(pill.color, 0.4));
      expect(shade!.color).toBe(darken(pill.color, 0.35));
      expect(highlight!.color).not.toBe(pill.color);
      expect(shade!.color).not.toBe(pill.color);
    }
  });
});
