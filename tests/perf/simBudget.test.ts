// Ticket 106: the simulation share of the frame budget (sim <= 2 ms per tick,
// spec §12) for the heaviest local case — four parallel Attack fields. The
// median of many ticks is gated, not the max, so one GC pause or a busy CI
// neighbour cannot fail the build, while a real regression (an O(n^2) probe,
// per-tick allocation storms) still does. The 2 ms limit is the device budget;
// a dev/CI machine is far faster, so this is a floor check, not a device claim.
import { describe, expect, it } from "vitest";
import { createAttackSession } from "sim/attackSession";
import { createRoundSim } from "sim/roundSim";
import { getLevelSync } from "content/levels";
import { EMPTY_ACTIONS, type InputFrame } from "shared/protocol";

const SIM_BUDGET_MS = 2;
const TICKS = 600;

function frame(player: number, tick: number, axisX: number, launch: boolean): InputFrame {
  return { player, tick, axisX, axisY: 0, launch, actions: EMPTY_ACTIONS };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe("sim frame budget (ticket 106)", () => {
  it("four Attack fields step in well under 2 ms (median per tick)", () => {
    const session = createAttackSession({
      playerCount: 4,
      seed: 3,
      config: { structure: "continuous", bestOf: 1, levelSelection: "fixedOrder", timeCapTicks: null, maxRound: 32 },
    });
    const samples: number[] = [];
    for (let tick = 0; tick < TICKS; tick++) {
      const sweep = Math.sin(tick / 30);
      const frames = [0, 1, 2, 3].map((p) => frame(p, tick, sweep, tick % 90 === 0));
      const t0 = performance.now();
      session.step(frames);
      samples.push(performance.now() - t0);
    }
    expect(median(samples)).toBeLessThan(SIM_BUDGET_MS);
  });

  it("a solo round sim steps in well under 2 ms (median per tick)", () => {
    const sim = createRoundSim(getLevelSync(1), { lives: 3, score: 0 });
    const samples: number[] = [];
    for (let tick = 0; tick < TICKS; tick++) {
      const t0 = performance.now();
      sim.step([frame(0, tick, Math.sin(tick / 25), tick % 60 === 0)]);
      samples.push(performance.now() - t0);
    }
    expect(median(samples)).toBeLessThan(SIM_BUDGET_MS);
  });
});
