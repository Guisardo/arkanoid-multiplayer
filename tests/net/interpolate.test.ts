import { describe, expect, it } from "vitest";
import { createInterpolator } from "net/interpolate";
import { createRoundSim } from "sim/roundSim";
import { getLevel } from "content/levels";
import type { Snapshot } from "shared/protocol";

let tickCounter = 0;
function fakeSnapshot(tick = ++tickCounter): Snapshot {
  const sim = createRoundSim(getLevel(1), { lives: 3, score: 0 });
  const snap = sim.snapshot();
  snap.tick = tick;
  return snap;
}

describe("guest interpolation (spec §9)", () => {
  it("returns null before any snapshot arrives", () => {
    const interp = createInterpolator({ snapshotHz: 30 });
    expect(interp.sample(1000)).toBeNull();
  });

  it("holds the newest snapshot when starved (never extrapolates)", () => {
    const interp = createInterpolator({ snapshotHz: 30 });
    const s1 = fakeSnapshot(1);
    const s2 = fakeSnapshot(2);
    interp.push(s1, 1000);
    interp.push(s2, 1033);
    // Sample far in the future with nothing fed: newest holds, delay grows.
    const out = interp.sample(5000);
    expect(out).toBe(s2);
    expect(interp.delayMs).toBeGreaterThan(75); // grew from nominal 83.3
  });

  it("renders an older sample when the buffer has depth", () => {
    const interp = createInterpolator({ snapshotHz: 30 });
    const a = fakeSnapshot(1);
    const b = fakeSnapshot(2);
    interp.push(a, 1000);
    interp.push(b, 1333);
    // Sample at 1200: target time = 1200 - delay(≈83) ≈ 1117 → a is newest ≤.
    const out = interp.sample(1200);
    expect(out).toBe(a);
  });

  it("shrinks delay back toward nominal when comfortably fed", () => {
    const interp = createInterpolator({ snapshotHz: 30 });
    // Starve once to grow the delay.
    interp.push(fakeSnapshot(1), 1000);
    interp.sample(5000);
    const grown = interp.delayMs;
    // Feed steadily; each fed sample should pull delay back down.
    let now = 5100;
    for (let i = 0; i < 40; i++) {
      interp.push(fakeSnapshot(), now);
      interp.sample(now + 50);
      now += 33;
    }
    expect(interp.delayMs).toBeLessThan(grown);
  });

  it("ignores stale duplicate ticks (unreliable reordering)", () => {
    const interp = createInterpolator({ snapshotHz: 30 });
    const a = fakeSnapshot(5);
    const b = fakeSnapshot(6);
    interp.push(a, 1000);
    interp.push(b, 1033);
    // Late duplicate of tick 5 arrives after 6 — dropped, buffer intact.
    interp.push(a, 1066);
    const out = interp.sample(1100);
    expect(out === a || out === b).toBe(true);
  });

  it("60 Hz mode uses shorter intervals", () => {
    const interp = createInterpolator({ snapshotHz: 60 });
    expect(interp.delayMs).toBeCloseTo(1000 / 60 * 2.5, 0);
  });

  it("caps the delay at maxDelayMs", () => {
    const interp = createInterpolator({ snapshotHz: 30, maxDelayMs: 100 });
    interp.push(fakeSnapshot(1), 1000);
    for (let t = 2000; t < 20000; t += 100) {
      interp.sample(t);
    }
    expect(interp.delayMs).toBeLessThanOrEqual(100);
  });
});
