import { describe, expect, it } from "vitest";
import { createInterpolator } from "net/interpolate";
import { createRoundSim } from "sim/roundSim";
import { getLevelSync } from "content/levels";
import type { Snapshot } from "shared/protocol";

let tickCounter = 0;
function fakeSnapshot(tick = ++tickCounter): Snapshot {
  const sim = createRoundSim(getLevelSync(1), { lives: 3, score: 0 });
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

describe("guest interpolation across Sim epochs (ticket #151)", () => {
  function epochSnapshot(epoch: number, tick: number): Snapshot {
    return { ...fakeSnapshot(tick), epoch };
  }

  it("follows the host into a new epoch even though its ticks restarted", () => {
    // Regression: the buffer dropped every snapshot at or below its newest
    // tick, so after a host round advance the guest froze on Round 1's last
    // frame until Round 2 outlasted it.
    const interp = createInterpolator({ snapshotHz: 60 });
    for (let t = 1; t <= 600; t++) interp.push(epochSnapshot(0, t), t * 16.7);
    for (let t = 0; t <= 300; t++) interp.push(epochSnapshot(1, t), (601 + t) * 16.7);
    const out = interp.sample(902 * 16.7);
    expect(out?.epoch).toBe(1);
    // Within the normal buffer delay of the newest Round 2 sample.
    expect(out?.tick).toBeGreaterThanOrEqual(295);
  });

  it("never renders the old epoch again once the new one arrived", () => {
    const interp = createInterpolator({ snapshotHz: 60 });
    interp.push(epochSnapshot(0, 500), 1000);
    interp.push(epochSnapshot(0, 501), 1016);
    interp.push(epochSnapshot(1, 0), 1033);
    // Even a deep sample (target time before the new epoch arrived) stays in it.
    expect(interp.sample(1040)?.epoch).toBe(1);
  });

  it("drops a late packet from an older epoch", () => {
    const interp = createInterpolator({ snapshotHz: 60 });
    interp.push(epochSnapshot(1, 5), 1000);
    interp.push(epochSnapshot(0, 900), 1010);
    expect(interp.size).toBe(1);
    expect(interp.sample(5000)?.epoch).toBe(1);
  });

  it("an epoch flush is not starvation: the delay stays nominal while the new epoch fills", () => {
    // Regression (#155): after the flush the lone new snapshot is younger than
    // the target time, so every render frame read as starved and grew the
    // delay to the cap: up to 150 ms of extra lag after every round advance.
    const interp = createInterpolator({ snapshotHz: 30 });
    const intervalMs = 1000 / 30;
    const renderMs = 1000 / 60;
    let next = 0;
    let now = 0;
    const run = (epoch: number, firstTick: number, untilMs: number): void => {
      let tick = firstTick;
      for (; now < untilMs; now += renderMs) {
        while (next <= now) {
          interp.push(epochSnapshot(epoch, tick++), next);
          next += intervalMs;
        }
        interp.sample(now);
      }
    };
    run(0, 1, 2000);
    const steady = interp.delayMs;
    run(1, 0, 2300);
    expect(interp.delayMs).toBeLessThanOrEqual(steady);
    expect(interp.sample(now)?.epoch).toBe(1);
  });
});
