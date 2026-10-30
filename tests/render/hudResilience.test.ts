// Ticket 100: HUD strips survive resize/orientation; the remote progress strip
// reserves its own band and compacts on narrow or landscape-phone viewports.
import { BitmapText, type Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { getLevelSync } from "content/levels";
import { REMOTE_STRIP_HEIGHT_PX, splitRegions, stripCompact } from "render/layout";
import { SplitScreenView } from "render/splitScreen";
import { createRoundSim } from "sim/roundSim";
import type { Snapshot } from "shared/protocol";

function hudStrings(root: Container): string[] {
  return root.children
    .filter((c): c is BitmapText => c instanceof BitmapText)
    .map((c) => c.text);
}

describe("remote strip band (ticket 100)", () => {
  it("splitRegions reserves the top inset for the strip", () => {
    const regions = splitRegions({ w: 808, h: 600 }, 2, REMOTE_STRIP_HEIGHT_PX);
    for (const r of regions) {
      expect(r.y).toBe(28);
      expect(r.h).toBe(572);
    }
  });

  it("no inset leaves the regions untouched", () => {
    expect(splitRegions({ w: 800, h: 600 }, 1)).toEqual([{ x: 0, y: 0, w: 800, h: 600 }]);
  });

  it("SplitScreenView.regionOf reports the inset region (overlay anchor)", () => {
    const view = new SplitScreenView({
      viewport: { w: 800, h: 600 },
      players: [0],
      locale: "en-US",
      maxRound: 33,
      topInset: 28,
    });
    expect(view.regionOf(0)).toEqual({ x: 0, y: 28, w: 800, h: 572 });
    view.resize({ w: 400, h: 300 });
    expect(view.regionOf(0)).toEqual({ x: 0, y: 28, w: 400, h: 272 });
    view.container.destroy({ children: true });
  });
});

describe("compact strip rule (ticket 100)", () => {
  it.each([
    [{ w: 1600, h: 900 }, false],
    [{ w: 800, h: 600 }, false],
    [{ w: 360, h: 780 }, true], // portrait phone: too narrow for full rows
    [{ w: 780, h: 360 }, true], // landscape phone: too short
  ])("%j -> %s", (viewport, expected) => {
    expect(stripCompact(viewport)).toBe(expected);
  });
});

describe("HUD persistence across resize (ticket 100)", () => {
  // Levels load via the test setup, so resolve them lazily inside each test.
  const snaps = (n: number): Snapshot[] =>
    Array.from({ length: n }, () =>
      createRoundSim(getLevelSync(1), { lives: 3, score: 1234, playerName: "Zed" }).snapshot());

  it.each([1, 2, 4])("%i-player HUD text is repopulated right after a resize", (n) => {
    const view = new SplitScreenView({
      viewport: { w: 1600, h: 900 },
      players: Array.from({ length: n }, (_, i) => i),
      locale: "en-US",
      maxRound: 33,
    });
    view.sync(snaps(n));
    view.resize({ w: 700, h: 500 });
    // No further sync: the rebuilt fields must already show name + score.
    for (const field of view.views) {
      const text = hudStrings(field.container).join(" ");
      expect(text).toContain("Zed");
      expect(text).toContain("001234");
    }
    view.container.destroy({ children: true });
  });

  it("HUD stays anchored inside its field region after resize", () => {
    const view = new SplitScreenView({
      viewport: { w: 1600, h: 900 },
      players: [0, 1],
      locale: "en-US",
      maxRound: 33,
    });
    view.sync(snaps(2));
    view.resize({ w: 500, h: 800 });
    view.views.forEach((field, i) => {
      const region = view.regionOf(i);
      const hud = field.container.children.find((c): c is BitmapText => c instanceof BitmapText);
      expect(region).not.toBeNull();
      expect(hud).toBeDefined();
      expect(hud!.x).toBeGreaterThanOrEqual(region!.x);
      expect(hud!.x).toBeLessThanOrEqual(region!.x + region!.w);
      expect(hud!.y).toBeGreaterThanOrEqual(region!.y);
    });
    view.container.destroy({ children: true });
  });
});

