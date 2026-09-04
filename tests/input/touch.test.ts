// Touch adapter tests (ticket 42): stick math (proportional, 0.2 deadzone),
// button edges, multi-touch ownership, cluster modes, Input frame parity.
import { describe, expect, it } from "vitest";
import {
  TouchAdapter,
  STICK_DEADZONE,
  STICK_BASE_RADIUS,
  clusterButtons,
  type TouchLayout,
} from "input/touch";
import { EMPTY_ACTIONS } from "shared/protocol";

const LAYOUT: TouchLayout = {
  stick: { x: 80, y: 400 },
  buttons: {
    launch: { x: 400, y: 400 },
    fire1: { x: 400, y: 340 },
    fire2: { x: 400, y: 280 },
    fire3: { x: 400, y: 220 },
    fire4: { x: 400, y: 160 },
    cycleForward: { x: 400, y: 100 },
    pause: { x: 400, y: 40 },
  },
  buttonRadius: 24,
};

function adapter(mode: "solo" | "attack" | "assist" = "solo"): TouchAdapter {
  return new TouchAdapter({ player: 0, mode, layout: LAYOUT });
}

describe("virtual stick", () => {
  it("deadzone: small offsets produce zero axis", () => {
    const a = adapter();
    a.pointerDown(1, 80 + STICK_BASE_RADIUS * STICK_DEADZONE, 400);
    expect(a.stickAxis().x).toBe(0);
    a.pointerUp(1);
  });

  it("full deflection right = axis 1", () => {
    const a = adapter();
    a.pointerDown(1, 80 + STICK_BASE_RADIUS, 400);
    expect(a.stickAxis().x).toBeCloseTo(1);
    expect(a.stickAxis().y).toBeCloseTo(0);
    a.pointerUp(1);
  });

  it("proportional: half deflection ≈ scaled axis", () => {
    const a = adapter();
    const dist = STICK_BASE_RADIUS * 0.6;
    a.pointerDown(1, 80 + dist, 400);
    // (dist - dz*max) / (max - dz*max)
    const expected = (dist - STICK_BASE_RADIUS * STICK_DEADZONE) / (STICK_BASE_RADIUS * (1 - STICK_DEADZONE));
    expect(a.stickAxis().x).toBeCloseTo(expected, 5);
    a.pointerUp(1);
  });

  it("diagonal deflection normalizes direction, keeps magnitude ≤1", () => {
    const a = adapter();
    const d = STICK_BASE_RADIUS / Math.SQRT2;
    a.pointerDown(1, 80 + d, 400 - d);
    const ax = a.stickAxis();
    expect(Math.hypot(ax.x, ax.y)).toBeLessThanOrEqual(1);
    expect(ax.x).toBeGreaterThan(0);
    expect(ax.y).toBeLessThan(0);
    a.pointerUp(1);
  });

  it("release zeroes the axis", () => {
    const a = adapter();
    a.pointerDown(1, 80 + STICK_BASE_RADIUS, 400);
    a.pointerUp(1);
    expect(a.stickAxis().x).toBe(0);
    expect(a.stickAxis().y).toBe(0);
  });
});

describe("button edges", () => {
  it("launch press queues a launch edge for exactly one frame", () => {
    const a = adapter();
    a.pointerDown(1, 400, 400); // launch button
    const f1 = a.sampleFrame(0);
    expect(f1.launch).toBe(true);
    const f2 = a.sampleFrame(1);
    expect(f2.launch).toBe(false);
    a.pointerUp(1);
  });

  it("attack cluster: fire2 maps to fire slot 1", () => {
    const a = adapter("attack");
    a.pointerDown(1, 400, 280); // fire2
    const f = a.sampleFrame(0);
    expect(f.actions.fire[1]).toBe(true);
    expect(f.actions.fire[0]).toBe(false);
    a.pointerUp(1);
  });

  it("cycle button queues cycleForward", () => {
    const a = adapter("attack");
    a.pointerDown(1, 400, 100); // cycleForward
    expect(a.sampleFrame(0).actions.cycleForward).toBe(true);
    a.pointerUp(1);
  });

  it("held buttons report for brighten-on-active", () => {
    const a = adapter("attack");
    a.pointerDown(1, 400, 340); // fire1
    expect(a.heldButtons()).toContain("fire1");
    a.pointerUp(1);
    expect(a.heldButtons()).toHaveLength(0);
  });
});

describe("multi-touch", () => {
  it("stick + button simultaneously (different pointers)", () => {
    const a = adapter("attack");
    a.pointerDown(1, 80 + STICK_BASE_RADIUS, 400); // stick
    a.pointerDown(2, 400, 340); // fire1
    const f = a.sampleFrame(0);
    expect(f.axisX).toBeCloseTo(1);
    expect(f.actions.fire[0]).toBe(true);
    a.pointerUp(1);
    a.pointerUp(2);
  });

  it("one pointer owns at most one control", () => {
    const a = adapter("attack");
    a.pointerDown(1, 400, 340); // fire1
    const claim = a.pointerDown(1, 80 + STICK_BASE_RADIUS, 400); // same id → ignored
    expect(claim).toBeNull();
    a.pointerUp(1);
  });

  it("releaseAll clears everything (context loss)", () => {
    const a = adapter("attack");
    a.pointerDown(1, 80 + STICK_BASE_RADIUS, 400);
    a.pointerDown(2, 400, 340);
    a.releaseAll();
    expect(a.stickAxis().x).toBe(0);
    expect(a.heldButtons()).toHaveLength(0);
  });
});

describe("cluster modes", () => {
  it("solo = launch only; attack = 4 fire + cycle; assist = 3 fire + cycle", () => {
    expect(clusterButtons("solo")).toEqual(["launch"]);
    expect(clusterButtons("attack")).toEqual(["fire1", "fire2", "fire3", "fire4", "cycleForward"]);
    expect(clusterButtons("assist")).toEqual(["fire1", "fire2", "fire3", "cycleForward"]);
  });

  it("mode swap live: solo buttons stop claiming, attack buttons start", () => {
    const a = adapter("solo");
    a.setMode("attack");
    a.pointerDown(1, 400, 160); // fire4 — only exists in attack mode
    expect(a.sampleFrame(0).actions.fire[3]).toBe(true);
    a.pointerUp(1);
  });
});

describe("pause + frame parity", () => {
  it("pause icon queues a pause edge, consumed once", () => {
    const a = adapter();
    a.pointerDown(1, 400, 40); // pause
    expect(a.consumePause()).toBe(true);
    expect(a.consumePause()).toBe(false);
    a.pointerUp(1);
  });

  it("emits the same Input frame shape as other devices", () => {
    const a = adapter();
    a.pointerDown(1, 80 + STICK_BASE_RADIUS, 400);
    const f = a.sampleFrame(42);
    expect(f.player).toBe(0);
    expect(f.tick).toBe(42);
    expect(f.axisX).toBeCloseTo(1);
    expect(f.axisY).toBeCloseTo(0);
    expect(f.launch).toBe(false);
    expect(f.actions).toEqual(EMPTY_ACTIONS);
    a.pointerUp(1);
  });

  it("idle frame = zero axis, no edges", () => {
    const a = adapter();
    const f = a.sampleFrame(0);
    expect(f.axisX).toBe(0);
    expect(f.axisY).toBe(0);
    expect(f.launch).toBe(false);
    expect(f.actions).toEqual(EMPTY_ACTIONS);
  });
});
