// Ticket 107: touch overlay hardening — every target fits, clears its
// neighbours and meets the 48 px minimum from small landscape phones up; the
// overlay arms the adapter with the layout it draws (so drawn buttons are
// tappable from the first frame); cluster mode switches re-arm hit areas;
// idle/active alpha follow the spec (0.25 / 0.6).
import type { Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import { TouchAdapter, BUTTON_MIN_PX, STICK_BASE_RADIUS, clusterButtons, type TouchClusterMode } from "input/touch";
import {
  TOUCH_ACTIVE_ALPHA,
  TOUCH_IDLE_ALPHA,
  TouchOverlay,
  overlayLayout,
} from "render/touchOverlay";
import { touchClusterFor } from "app/mobileLayout";

const MODES: TouchClusterMode[] = ["solo", "attack", "assist"];

/** Region sizes (CSS px): portrait phones, landscape phones, 2-local halves. */
const REGIONS = [
  { name: "portrait 360x640", w: 360, h: 640 },
  { name: "small portrait 320x568", w: 320, h: 568 },
  { name: "landscape 780x360", w: 780, h: 360 },
  { name: "2-local half 320x360", w: 320, h: 360 },
  { name: "2-local half SE 284x320", w: 284, h: 320 },
];

interface Circle {
  name: string;
  x: number;
  y: number;
  r: number;
}

function circles(region: { w: number; h: number }, mode: TouchClusterMode): Circle[] {
  const l = overlayLayout({ x: 0, y: 0, ...region }, mode);
  const out: Circle[] = [{ name: "stick", x: l.stick.x, y: l.stick.y, r: STICK_BASE_RADIUS }];
  for (const id of [...clusterButtons(mode), "pause" as const]) {
    const c = l.buttons[id];
    if (c === undefined) throw new Error(`layout lacks ${id}`);
    out.push({ name: id, x: c.x, y: c.y, r: l.buttonRadius });
  }
  return out;
}

describe.each(REGIONS)("overlay layout in $name", (region) => {
  it.each(MODES)("%s: every target lies fully inside the region", (mode) => {
    for (const c of circles(region, mode)) {
      expect(c.x - c.r, `${c.name} left`).toBeGreaterThanOrEqual(0);
      expect(c.y - c.r, `${c.name} top`).toBeGreaterThanOrEqual(0);
      expect(c.x + c.r, `${c.name} right`).toBeLessThanOrEqual(region.w);
      expect(c.y + c.r, `${c.name} bottom`).toBeLessThanOrEqual(region.h);
    }
  });

  it.each(MODES)("%s: buttons are at least 48 px across and nothing overlaps", (mode) => {
    const all = circles(region, mode);
    for (const c of all.filter((x) => x.name !== "stick")) {
      expect(c.r * 2, c.name).toBeGreaterThanOrEqual(BUTTON_MIN_PX);
    }
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!;
        const b = all[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.name} vs ${b.name}`).toBeGreaterThanOrEqual(a.r + b.r);
      }
    }
  });

  it.each(MODES)("%s: the pause icon sits outside the stick's drag zone", (mode) => {
    const all = circles(region, mode);
    const stick = all.find((c) => c.name === "stick")!;
    const pause = all.find((c) => c.name === "pause")!;
    // The adapter claims touches up to 1.5x the base radius for the stick.
    expect(Math.hypot(pause.x - stick.x, pause.y - stick.y) - pause.r).toBeGreaterThan(STICK_BASE_RADIUS * 1.5);
  });
});

describe("TouchOverlay arms its adapter (ticket 107)", () => {
  const STALE = { stick: { x: 80, y: 0 }, buttons: {}, buttonRadius: 24 };
  const region = { x: 0, y: 0, w: 360, h: 640 };

  it("drawn buttons are tappable straight after construction", () => {
    const adapter = new TouchAdapter({ player: 0, mode: "solo", layout: STALE });
    const overlay = new TouchOverlay(adapter, { ...region }, "solo");
    const l = overlayLayout(region, "solo");
    expect(adapter.pointerDown(1, l.buttons.launch!.x, l.buttons.launch!.y)).toBe("launch");
    expect(adapter.pointerDown(2, l.buttons.pause!.x, l.buttons.pause!.y)).toBe("pause");
    expect(adapter.pointerDown(3, l.stick.x, l.stick.y)).toBe("stick");
    overlay.container.destroy({ children: true });
  });

  it("switching the cluster mode re-arms the hit areas for the new buttons", () => {
    const adapter = new TouchAdapter({ player: 0, mode: "solo", layout: STALE });
    const overlay = new TouchOverlay(adapter, { ...region }, "solo");
    overlay.setMode("attack");
    const l = overlayLayout(region, "attack");
    expect(adapter.pointerDown(1, l.buttons.fire1!.x, l.buttons.fire1!.y)).toBe("fire1");
    expect(adapter.pointerDown(2, l.buttons.fire4!.x, l.buttons.fire4!.y)).toBe("fire4");
    overlay.container.destroy({ children: true });
  });
});

describe("touch feedback alpha (ticket 107)", () => {
  it("uses the spec values: idle 0.25, active 0.6", () => {
    expect(TOUCH_IDLE_ALPHA).toBe(0.25);
    expect(TOUCH_ACTIVE_ALPHA).toBe(0.6);
  });

  it("a held button is drawn brighter than the same button idle", () => {
    const region = { x: 0, y: 0, w: 360, h: 640 };
    const layout = overlayLayout(region, "solo");
    const adapter = new TouchAdapter({ player: 0, mode: "solo", layout });
    const overlay = new TouchOverlay(adapter, { ...region }, "solo");
    const alphas = (): number[] =>
      (overlay.container.children[0] as Graphics).context.instructions
        .filter((i) => i.action === "fill")
        .map((i) => (i.data as { style: { alpha: number } }).style.alpha);
    const count = (list: number[], v: number): number => list.filter((a) => a === v).length;
    const idle = alphas();
    adapter.pointerDown(1, layout.buttons.launch!.x, layout.buttons.launch!.y);
    overlay.redraw();
    const held = alphas();
    expect(count(held, TOUCH_ACTIVE_ALPHA)).toBeGreaterThan(count(idle, TOUCH_ACTIVE_ALPHA));
    expect(count(held, TOUCH_IDLE_ALPHA)).toBeLessThan(count(idle, TOUCH_IDLE_ALPHA));
    overlay.container.destroy({ children: true });
  });
});

describe("cluster per match mode (ticket 107)", () => {
  it.each([
    ["race", "solo"],
    ["duel", "solo"],
    ["sharedField", "solo"],
    ["attack", "attack"],
    ["parallelAssist", "assist"],
  ] as const)("%s match -> %s cluster", (mode, cluster) => {
    expect(touchClusterFor(mode)).toBe(cluster);
  });
});
