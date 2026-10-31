// Touch overlay render tests (ticket 42): layout math (≥48 px targets,
// stick bottom-left, cluster bottom-right, pause top corner out of drag
// zone), redraw from adapter state, mode/region swaps.
import { describe, expect, it } from "vitest";
import { TouchAdapter, BUTTON_MIN_PX, STICK_BASE_RADIUS, clusterButtons } from "input/touch";
import {
  LASER_BADGE_FONT_PX,
  TouchOverlay,
  laserBadgeStyle,
  overlayLayout,
} from "render/touchOverlay";
import { launchGlyphFor } from "render/launchGlyph";
import type { Snapshot } from "shared/protocol";

const REGION = { x: 0, y: 0, w: 480, h: 800 };

describe("overlay layout math", () => {
  it("buttons ≥48 px (radius ≥ 24)", () => {
    for (const mode of ["solo", "attack", "assist"] as const) {
      const l = overlayLayout(REGION, mode);
      expect(l.buttonRadius).toBeGreaterThanOrEqual(BUTTON_MIN_PX / 2);
    }
  });

  it("stick bottom-left, cluster bottom-right, pause top corner", () => {
    const l = overlayLayout(REGION, "attack");
    expect(l.stick.x).toBeLessThan(REGION.w / 2);
    expect(l.stick.y).toBeGreaterThan(REGION.h / 2);
    for (const id of clusterButtons("attack")) {
      const c = l.buttons[id];
      expect(c).toBeDefined();
      expect(c!.x).toBeGreaterThan(REGION.w / 2);
      expect(c!.y).toBeGreaterThan(REGION.h / 4);
    }
    const p = l.buttons.pause;
    expect(p).toBeDefined();
    expect(p!.y).toBeLessThan(REGION.h / 8); // top corner
    // Out of the drag zone: far from the stick.
    expect(Math.hypot(p!.x - l.stick.x, p!.y - l.stick.y)).toBeGreaterThan(STICK_BASE_RADIUS * 2);
  });

  it("cluster stacks without overlapping (≥ button diameter apart)", () => {
    const l = overlayLayout(REGION, "attack");
    const centers = clusterButtons("attack")
      .map((id) => l.buttons[id])
      .filter((c): c is { x: number; y: number } => c !== undefined);
    for (let i = 1; i < centers.length; i++) {
      const prev = centers[i - 1]!;
      const cur = centers[i]!;
      expect(Math.abs(prev.y - cur.y)).toBeGreaterThanOrEqual(l.buttonRadius * 2);
    }
  });
});

describe("TouchOverlay", () => {
  it("constructs, redraws, and swaps mode + region live", () => {
    const adapter = new TouchAdapter({
      player: 0,
      mode: "solo",
      layout: overlayLayout(REGION, "solo"),
    });
    const overlay = new TouchOverlay(adapter, REGION, "solo");
    overlay.redraw();
    overlay.setMode("attack");
    expect(adapter.activeButtons()).toEqual(clusterButtons("attack"));
    overlay.setRegion({ x: 10, y: 10, w: 400, h: 600 });
    overlay.redraw();
    expect(overlay.container.position.x).toBe(10);
    overlay.container.destroy({ children: true });
  });

  it("active touch brightens: held button renders in held set", () => {
    const layout = overlayLayout(REGION, "attack");
    const adapter = new TouchAdapter({ player: 0, mode: "attack", layout });
    // Press fire1 (bottom cluster slot).
    const fire1 = layout.buttons.fire1!;
    adapter.pointerDown(7, fire1.x, fire1.y);
    expect(adapter.heldButtons()).toContain("fire1");
    adapter.pointerUp(7);
  });
});

// ---- Laser (ticket #148): launch triangle vs twin-bar glyph + LASER badge ----

describe("touch launch button: Laser glyph swap", () => {
  const armedSnap = (stuck: boolean, armed: boolean): Snapshot =>
    ({
      tick: 0,
      phase: stuck ? "serve" : "play",
      round: 1,
      players: [
        {
          player: 0,
          name: "P1",
          skinIndex: 0,
          paddle: { x: 104, y: 242, w: 32, h: 6, edge: "bottom" },
          lives: 3,
          score: 0,
          meter: 0,
          target: -1,
          chain: 0,
          state: "playing",
          effects: armed ? { L: 1 } : {},
        },
      ],
      balls: [{ x: 104, y: 236, vx: 0, vy: 0, attachedTo: stuck ? 0 : null, owner: 0 }],
      capsules: [],
      bricks: [],
      events: [],
      inputAcks: [0],
    });

  it("stuck ball → launch triangle, even while Armed", () => {
    expect(launchGlyphFor(armedSnap(true, true), 0)).toBe("launch");
    expect(launchGlyphFor(armedSnap(true, false), 0)).toBe("launch");
  });

  it("Armed with no stuck ball → laser glyph; unarmed in play → launch", () => {
    expect(launchGlyphFor(armedSnap(false, true), 0)).toBe("laser");
    expect(launchGlyphFor(armedSnap(false, false), 0)).toBe("launch");
  });

  it("another player's stuck ball does not count", () => {
    const snap = armedSnap(false, true);
    const ball = snap.balls[0]!;
    snap.balls[0] = { ...ball, attachedTo: 1 };
    expect(launchGlyphFor(snap, 0)).toBe("laser");
  });

  it("the overlay swaps glyph and shows the constant LASER badge only when armed", () => {
    const adapter = new TouchAdapter({ player: 0, mode: "solo", layout: overlayLayout(REGION, "solo") });
    const overlay = new TouchOverlay(adapter, REGION, "solo");
    expect(overlay.launchGlyph).toBe("launch");
    expect(overlay.laserBadge).toBeNull();
    overlay.setLaunchGlyph("laser");
    overlay.redraw();
    expect(overlay.launchGlyph).toBe("laser");
    expect(overlay.laserBadge).toBe("text");
    overlay.setLaunchGlyph("launch");
    overlay.redraw();
    expect(overlay.laserBadge).toBeNull();
    overlay.container.destroy({ children: true });
  });

  it("badge legibility: text on any ≥48 px button; glyph-only fallback below", () => {
    // Small phones still get 48 px targets (BUTTON_MIN_PX), so the text badge
    // always fits; the fallback guards any smaller button.
    expect(laserBadgeStyle(BUTTON_MIN_PX / 2)).toBe("text");
    expect(laserBadgeStyle(16)).toBe("glyph");
    expect(LASER_BADGE_FONT_PX).toBeGreaterThanOrEqual(8);
    const smallPhone = overlayLayout({ x: 0, y: 0, w: 320, h: 568 }, "solo");
    expect(laserBadgeStyle(smallPhone.buttonRadius)).toBe("text");
  });
});
