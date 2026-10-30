// Ticket 93: Pixi built-in culling for split-screen fields. Each FieldView
// opts its container into the culler with a cullArea covering only what it
// draws (letterboxed field + HUD strip), not the empty margin of its region.
import { Culler } from "pixi.js";
import { describe, expect, it } from "vitest";
import { FieldView } from "render/fieldView";
import { SplitScreenView } from "render/splitScreen";
import { fieldCullRect, layoutField } from "render/layout";

function makeFieldView(region = { x: 100, y: 0, w: 400, h: 1000 }): FieldView {
  return new FieldView({
    player: 0,
    locale: "en-US",
    maxRound: 33,
    layout: layoutField(region),
  });
}

describe("FieldView culling contract (ticket 93)", () => {
  it("opts its container into Pixi's culler", () => {
    const view = makeFieldView();
    expect(view.container.cullable).toBe(true);
  });

  it("culls against the letterboxed field + HUD rect, not the whole region", () => {
    const region = { x: 100, y: 0, w: 400, h: 1000 };
    const view = makeFieldView(region);
    const expected = fieldCullRect(layoutField(region));
    const area = view.container.cullArea;
    expect(area).toBeDefined();
    expect(area).toMatchObject(expected);
    expect(area!.height).toBeLessThan(region.h);
  });
});

describe("SplitScreenView with Pixi's real Culler (ticket 93)", () => {
  const viewport = { w: 808, h: 600 };

  function makeSplit(players: number[]): SplitScreenView {
    return new SplitScreenView({ viewport, players, locale: "en-US", maxRound: 33 });
  }

  function cullFlags(split: SplitScreenView): boolean[] {
    // skipUpdateTransform=false: no renderer here to refresh world transforms.
    Culler.shared.cull(split.container, { x: 0, y: 0, width: viewport.w, height: viewport.h }, false);
    return split.views.map((v) => v.container.culled);
  }

  it("culls nothing while every field is on screen (1-4 players)", () => {
    for (const n of [1, 2, 3, 4]) {
      const split = makeSplit(Array.from({ length: n }, (_, i) => i));
      expect(cullFlags(split)).toEqual(new Array(n).fill(false));
      split.container.destroy({ children: true });
    }
  });

  it("culls only the fields that moved fully off screen", () => {
    const split = makeSplit([0, 1]);
    // Field 0 spans x 0..400, field 1 spans 408..808. Pan left by 500 px:
    // field 0 ends at x<0, field 1 is still partly visible.
    split.container.position.x = -500;
    expect(cullFlags(split)).toEqual([true, false]);
    split.container.destroy({ children: true });
  });

  it("does not cull a field whose letterbox margin alone is off screen", () => {
    const split = makeSplit([0]);
    // The 800×600 region letterboxes a ~452 px wide field centred at x≈400.
    // Pan right so the region's right margin leaves the viewport but the
    // drawn field still overlaps it: the field must stay rendered.
    split.container.position.x = 500;
    expect(cullFlags(split)).toEqual([false]);
    split.container.position.x = 900;
    expect(cullFlags(split)).toEqual([true]);
    split.container.destroy({ children: true });
  });

  it("fields rebuilt on resize are cullable again", () => {
    const split = makeSplit([0, 1]);
    split.resize({ w: 400, h: 300 });
    for (const v of split.views) expect(v.container.cullable).toBe(true);
    split.container.destroy({ children: true });
  });
});
