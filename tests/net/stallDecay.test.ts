// Host input stall decay (spec §9, ticket 46; Laser held-fire ticket #141):
// silent guest players get synthetic frames that HOLD the last axis for
// STALL_HOLD ticks, then DECAY it to 0. Held fire never survives a stall.
import { describe, expect, it } from "vitest";
import {
  createStallDecay,
  STALL_DECAY,
  STALL_FLOOR,
  STALL_HOLD,
} from "net/stallDecay";
import { EMPTY_ACTIONS, type InputFrame } from "shared/protocol";

function frame(player: number, tick: number, axisX: number, primaryHeld = false): InputFrame {
  return { player, tick, axisX, axisY: 0, launch: false, primaryHeld, actions: EMPTY_ACTIONS };
}

const never = (): boolean => false;

describe("stall decay (spec §9)", () => {
  it("emits nothing while every guest player has a due frame", () => {
    const stall = createStallDecay([1, 2], never);
    expect(stall.frames([frame(1, 0, 1), frame(2, 0, -1)], 0)).toEqual([]);
  });

  it("holds the last axis for STALL_HOLD silent ticks", () => {
    const stall = createStallDecay([1], never);
    stall.frames([frame(1, 0, 0.5)], 0);
    for (let t = 1; t <= STALL_HOLD; t++) {
      const out = stall.frames([], t);
      expect(out).toHaveLength(1);
      expect(out[0]!.player).toBe(1);
      expect(out[0]!.tick).toBe(t);
      expect(out[0]!.axisX).toBe(0.5);
    }
  });

  it("decays the axis after the hold window, then floors to 0", () => {
    const stall = createStallDecay([1], never);
    stall.frames([frame(1, 0, 1)], 0);
    for (let t = 1; t <= STALL_HOLD; t++) stall.frames([], t);
    const first = stall.frames([], STALL_HOLD + 1)[0]!;
    expect(first.axisX).toBeCloseTo(STALL_DECAY, 10);
    let last = first.axisX;
    for (let t = STALL_HOLD + 2; t < STALL_HOLD + 40; t++) last = stall.frames([], t)[0]!.axisX;
    expect(last).toBe(0);
    expect(STALL_FLOOR).toBeGreaterThan(0);
  });

  it("synthesized frames never carry held fire, even when the last real frame held it", () => {
    const stall = createStallDecay([1], never);
    stall.frames([frame(1, 0, 1, true)], 0);
    for (let t = 1; t < STALL_HOLD + 20; t++) {
      for (const f of stall.frames([], t)) {
        expect(f.primaryHeld).toBe(false);
        expect(f.launch).toBe(false);
        expect(f.actions).toEqual(EMPTY_ACTIONS);
      }
    }
  });

  it("an idle (axis 0) silent player stays idle: no synthetic frame", () => {
    const stall = createStallDecay([1], never);
    stall.frames([frame(1, 0, 0, true)], 0);
    expect(stall.frames([], 1)).toEqual([]);
  });

  it("a due frame resets the miss counter (hold window restarts)", () => {
    const stall = createStallDecay([1], never);
    stall.frames([frame(1, 0, 1)], 0);
    for (let t = 1; t <= STALL_HOLD + 3; t++) stall.frames([], t);
    stall.frames([frame(1, 20, -1)], 20);
    expect(stall.frames([], 21)[0]!.axisX).toBe(-1);
  });

  it("removed players get no synthetic input", () => {
    const removed = new Set<number>();
    const stall = createStallDecay([1, 2], (p) => removed.has(p));
    stall.frames([frame(1, 0, 1), frame(2, 0, 1)], 0);
    removed.add(2);
    const out = stall.frames([], 1);
    expect(out.map((f) => f.player)).toEqual([1]);
  });

  it("forget() drops a player's held axis", () => {
    const stall = createStallDecay([1], never);
    stall.frames([frame(1, 0, 1)], 0);
    stall.forget(1);
    expect(stall.frames([], 1)).toEqual([]);
  });

  it("no guest players: always empty", () => {
    const stall = createStallDecay([], never);
    expect(stall.frames([frame(0, 0, 1)], 0)).toEqual([]);
  });
});
