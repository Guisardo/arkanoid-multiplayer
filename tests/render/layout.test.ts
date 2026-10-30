import { describe, expect, it } from "vitest";
import { capDpr, fieldCullRect, GUTTER_PX, HUD_STRIP_UNITS, layoutField, splitRegions } from "render/layout";
import { FIELD_H, FIELD_W } from "shared/gridConstants";

describe("dpr cap", () => {
  it("caps at 2 (spec §12)", () => {
    expect(capDpr(3)).toBe(2);
    expect(capDpr(1.5)).toBe(1.5);
    expect(capDpr(1)).toBe(1);
  });
});

describe("splitRegions (N-across equal columns, 8 px gutters)", () => {
  it("N=1 single centered region is whole viewport", () => {
    const r = splitRegions({ w: 800, h: 600 }, 1);
    expect(r).toEqual([{ x: 0, y: 0, w: 800, h: 600 }]);
  });
  it("N=2 equal columns with 8px gutter", () => {
    const r = splitRegions({ w: 808, h: 600 }, 2);
    expect(r).toHaveLength(2);
    expect(r[0]!.x).toBe(0);
    expect(r[1]!.x).toBe(400 + GUTTER_PX);
    expect(r[0]!.w).toBe(400);
    expect(r[1]!.w).toBe(400);
  });
  it("N=4 columns", () => {
    const r = splitRegions({ w: 1600 + 3 * GUTTER_PX, h: 600 }, 4);
    expect(r).toHaveLength(4);
    expect(r.map((x) => x.w)).toEqual([400, 400, 400, 400]);
  });
});

describe("layoutField (letterbox 208×256, fractional scale)", () => {
  it("exact-aspect region → scale fills, HUD above field inside region", () => {
    const region = { x: 0, y: 0, w: FIELD_W * 2, h: (FIELD_H + HUD_STRIP_UNITS) * 2 };
    const l = layoutField(region);
    expect(l.scale).toBeCloseTo(2);
    expect(l.field.w).toBeCloseTo(FIELD_W * 2);
    expect(l.hud.h).toBeCloseTo(HUD_STRIP_UNITS * 2);
    expect(l.hud.y).toBeCloseTo(l.field.y - HUD_STRIP_UNITS * 2);
  });

  it("wide region letterboxes horizontally centered", () => {
    // Height exactly fits field+HUD → scale=1, width letterboxed.
    const region = { x: 0, y: 0, w: 1000, h: FIELD_H + HUD_STRIP_UNITS };
    const l = layoutField(region);
    expect(l.field.h).toBeCloseTo(FIELD_H, 5);
    expect(l.field.x).toBeCloseTo((1000 - FIELD_W) / 2, 5);
  });

  it("tall region letterboxes vertically centered", () => {
    const region = { x: 0, y: 0, w: FIELD_W, h: 1000 };
    const l = layoutField(region);
    expect(l.field.w).toBeCloseTo(FIELD_W, 5);
    expect(l.field.y).toBeCloseTo((1000 - FIELD_H) / 2, 5);
  });

  it("fractional scale allowed (never rounds)", () => {
    const region = { x: 0, y: 0, w: 300, h: 700 };
    const l = layoutField(region);
    // scale = min(300/208, 700/276) = 300/208 = 1.4423...
    expect(l.scale).toBeCloseTo(300 / FIELD_W, 5);
    expect(Number.isInteger(l.scale)).toBe(false);
  });
});

describe("fieldCullRect (ticket 93: Pixi cullArea in the field view's local space)", () => {
  it("covers the letterboxed field plus the HUD strip above it, nothing of the empty region", () => {
    // 400×1000 region: scale = min(400/208, 1000/276) = 400/208, so the field
    // is letterboxed vertically inside a much taller region.
    const l = layoutField({ x: 100, y: 0, w: 400, h: 1000 });
    const r = fieldCullRect(l);
    expect(r.x).toBeCloseTo(l.field.x, 5);
    expect(r.y).toBeCloseTo(l.hud.y, 5);
    expect(r.width).toBeCloseTo(l.field.w, 5);
    expect(r.height).toBeCloseTo(l.hud.h + l.field.h, 5);
    expect(r.height).toBeLessThan(l.region.h);
  });

  it("exact-aspect region at scale 2: literal screen rect of HUD + field", () => {
    // The field is centred alone, so at scale 2 it sits at y=40 and its 40 px
    // HUD strip starts at y=0 — above the region's own top edge (y=20).
    const region = { x: 10, y: 20, w: FIELD_W * 2, h: (FIELD_H + HUD_STRIP_UNITS) * 2 };
    expect(fieldCullRect(layoutField(region))).toEqual({ x: 10, y: 0, width: 416, height: 552 });
  });
});
