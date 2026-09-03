import { describe, expect, it } from "vitest";
import {
  aabbOverlap,
  clampEdgeAngle,
  offsetDeflect,
  resolveCircleBoxOverlap,
} from "sim/collision";
import { FIELD_W, PADDLE_Y, BALL_R } from "sim/constants";

describe("box overlap (edge contact counts)", () => {
  it("overlapping boxes collide", () => {
    expect(aabbOverlap(0, 0, 10, 10, 5, 5, 10, 10)).toBe(true);
  });
  it("edge contact counts as overlap", () => {
    expect(aabbOverlap(0, 0, 10, 10, 10, 0, 10, 10)).toBe(true);
  });
  it("corner contact counts as overlap", () => {
    // A: center (0,0) 10×10 → extends -5..5. B: 5×5 with left/bottom edges
    // at exactly (5,5) → corner touches corner.
    expect(aabbOverlap(0, 0, 10, 10, 7.5, 2.5, 5, 5)).toBe(true);
  });
  it("separated boxes do not collide", () => {
    expect(aabbOverlap(0, 0, 10, 10, 11, 0, 10, 10)).toBe(false);
  });
  it("negative gap fails", () => {
    expect(aabbOverlap(0, 0, 10, 10, 10.0001, 0, 10, 10)).toBe(false);
  });
});

describe("resolveCircleBoxOverlap", () => {
  it("circle overlapping box resolves along least-penetration axis", () => {
    // circle near box's bottom edge → pushed down out of the box
    const r = resolveCircleBoxOverlap(42, 11, 5, 40, 10, 20, 10);
    expect(r).not.toBeNull();
    expect(r?.x).toBe(42);
    expect(r?.y).toBe(10 + 10); // box center + (h/2 + r)
  });
  it("edge-touching circle counts and holds position", () => {
    const r = resolveCircleBoxOverlap(50, 20, 5, 40, 10, 20, 10);
    expect(r).not.toBeNull();
  });
  it("returns null when no overlap", () => {
    expect(resolveCircleBoxOverlap(0, 0, 3, 100, 100, 10, 10)).toBeNull();
  });
});

describe("offset-deflect (classic paddle bounce)", () => {
  const paddle = { x: FIELD_W / 2, y: PADDLE_Y, w: 32, h: 6 };
  const speed = 110;

  it("center hit reflects straight up", () => {
    const { vx, vy } = offsetDeflect(paddle.x, speed, paddle, BALL_R);
    expect(vx).toBeCloseTo(0);
    expect(vy).toBeCloseTo(-speed);
  });

  it("edge hit deflects toward that side", () => {
    const right = offsetDeflect(paddle.x + paddle.w / 2, speed, paddle, BALL_R);
    expect(right.vx).toBeGreaterThan(0);
    expect(right.vy).toBeLessThan(0);
    const left = offsetDeflect(paddle.x - paddle.w / 2, speed, paddle, BALL_R);
    expect(left.vx).toBeLessThan(0);
    expect(left.vy).toBeLessThan(0);
  });

  it("max offset clamps to ~60 degrees from vertical", () => {
    // Past the far edge of the paddle: t clamps to 1 → 60° from vertical.
    const { vx, vy } = offsetDeflect(paddle.x + paddle.w / 2 + BALL_R + 1, speed, paddle, BALL_R);
    // 60° from vertical: |vx| = speed * sin(60°)
    expect(vx).toBeCloseTo(speed * Math.sin((60 * Math.PI) / 180), 5);
    expect(vy).toBeCloseTo(-speed * Math.cos((60 * Math.PI) / 180), 5);
    // speed preserved
    expect(Math.hypot(vx, vy)).toBeCloseTo(speed, 5);
  });

  it("speed is preserved across the full offset range", () => {
    for (let i = -6; i <= 6; i++) {
      const { vx, vy } = offsetDeflect(paddle.x + i * 3, speed, paddle, BALL_R);
      expect(Math.hypot(vx, vy)).toBeCloseTo(speed, 5);
    }
  });
});

describe("edge clamp", () => {
  it("shallow angle clamps to ~60° up-and-away", () => {
    // nearly horizontal downward-left ball
    const cl = clampEdgeAngle(-110, -5, 110);
    expect(cl.vx).toBeLessThan(0);
    expect(cl.vy).toBeLessThan(0);
    expect(Math.abs(cl.vx)).toBeCloseTo(110 * Math.sin((60 * Math.PI) / 180), 5);
    expect(Math.abs(cl.vy)).toBeCloseTo(110 * Math.cos((60 * Math.PI) / 180), 5);
  });
  it("angle within range passes through unchanged", () => {
    const cl = clampEdgeAngle(50, -80, 100);
    expect(cl.vx).toBeCloseTo(50);
    expect(cl.vy).toBeCloseTo(-80);
  });
  it("preserves speed", () => {
    const cl = clampEdgeAngle(-109, -12, 111);
    expect(Math.hypot(cl.vx, cl.vy)).toBeCloseTo(111, 5);
  });
});
