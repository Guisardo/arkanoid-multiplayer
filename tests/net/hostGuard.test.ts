import { describe, expect, it } from "vitest";
import { createHostInputGuard, guardGuestFrames, RATE_CAP_PER_TICK } from "net/hostGuard";
import { EMPTY_ACTIONS, type InputFrame } from "shared/protocol";

function frame(player: number, tick: number, axisX: number): InputFrame {
  return { player, tick, axisX, axisY: 0, launch: false, actions: EMPTY_ACTIONS };
}

describe("host input guard (spec §9, ADR 0003)", () => {
  it("passes well-formed frames with clamped axes", () => {
    const guard = createHostInputGuard();
    const r = guardGuestFrames(guard, [frame(0, 10, 0.5), frame(1, 10, -0.5)], 5);
    expect(r.accepted).toHaveLength(2);
    expect(r.accepted[0]!.axisX).toBe(0.5);
  });

  it("clamps axes outside [-1..1]", () => {
    const guard = createHostInputGuard();
    const r = guardGuestFrames(guard, [frame(0, 10, 5), frame(1, 11, -3)], 5);
    expect(r.accepted[0]!.axisX).toBe(1);
    expect(r.accepted[1]!.axisX).toBe(-1);
  });

  it("drops out-of-order and duplicate ticks", () => {
    const guard = createHostInputGuard();
    const r1 = guardGuestFrames(guard, [frame(0, 10, 1)], 5);
    expect(r1.accepted).toHaveLength(1);
    const r2 = guardGuestFrames(guard, [frame(0, 10, 1), frame(0, 9, 1)], 5);
    expect(r2.accepted).toHaveLength(0);
    expect(r2.dropped).toBe(2);
  });

  it("rate-caps a flooding player", () => {
    const guard = createHostInputGuard();
    const frames = Array.from({ length: RATE_CAP_PER_TICK + 3 }, (_, i) => frame(0, 100 + i, 1));
    const r = guardGuestFrames(guard, frames, 5);
    expect(r.accepted).toHaveLength(RATE_CAP_PER_TICK);
    expect(r.dropped).toBe(3);
  });

  it("rejects invalid player indices and non-integer ticks", () => {
    const guard = createHostInputGuard();
    const bad: InputFrame[] = [
      { ...frame(7, 10, 0), player: 7 },
      { ...frame(-1, 10, 0), player: -1 },
      { ...frame(0, 10.5, 0) },
    ];
    const r = guardGuestFrames(guard, bad, 5);
    expect(r.accepted).toHaveLength(0);
    expect(r.dropped).toBe(3);
  });

  it("sanitizes unknown action shapes to empty actions", () => {
    const guard = createHostInputGuard();
    const weird = {
      player: 0,
      tick: 10,
      axisX: 0,
      axisY: 0,
      launch: "yes" as unknown as boolean,
      actions: undefined as unknown as InputFrame["actions"],
    };
    const r = guardGuestFrames(guard, [weird], 5);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]!.launch).toBe(false);
    expect(r.accepted[0]!.actions.fire).toEqual([false, false, false, false]);
  });

  it("NaN axes clamp to 0", () => {
    const guard = createHostInputGuard();
    const r = guardGuestFrames(guard, [{ ...frame(0, 10, Number.NaN) }], 5);
    expect(r.accepted[0]!.axisX).toBe(0);
  });

  it("rate cap resets on the next host tick", () => {
    const guard = createHostInputGuard();
    guardGuestFrames(guard, [frame(0, 10, 1), frame(0, 11, 1)], 1);
    const next = guardGuestFrames(guard, [frame(0, 12, 1)], 2);
    expect(next.accepted).toHaveLength(1);
  });
});
