// Ticket 106: the simulation share of the frame budget (sim <= 2 ms per tick,
// spec §12) for the heaviest local case — four parallel Attack fields. The
// median of many ticks is gated, not the max, so one GC pause or a busy CI
// neighbour cannot fail the build, while a real regression (an O(n^2) probe,
// per-tick allocation storms) still does. The 2 ms limit is the device budget;
// a dev/CI machine is far faster, so this is a floor check, not a device claim.
import { describe, expect, it } from "vitest";
import { createAttackSession } from "sim/attackSession";
import { createRoundSim } from "sim/roundSim";
import { createSharedFieldSim } from "sim/sharedField";
import { Bolts } from "sim/bolts";
import { BRICK_COLS, PADDLE_H, PADDLE_W, PADDLE_Y } from "sim/constants";
import { getLevelSync } from "content/levels";
import {
  EMPTY_ACTIONS,
  LASER_BOLTS_PER_PADDLE,
  SNAPSHOT_PLAYERS_MAX,
  isArmedPlayer,
  type InputFrame,
} from "shared/protocol";

const SIM_BUDGET_MS = 2;
const TICKS = 600;

function frame(player: number, tick: number, axisX: number, launch: boolean, primaryHeld = false): InputFrame {
  return { player, tick, axisX, axisY: 0, launch, primaryHeld, actions: EMPTY_ACTIONS };
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

  it("four Armed Attack fields holding fire step in well under 2 ms (median per tick)", () => {
    // Ticket #149: every Paddle Armed and firing on cooldown. Re-arming after
    // a lost ball happens outside the timed step.
    const session = createAttackSession({
      playerCount: 4,
      seed: 3,
      config: { structure: "continuous", bestOf: 1, levelSelection: "fixedOrder", timeCapTicks: null, maxRound: 32 },
    });
    const samples: number[] = [];
    let peakBolts = 0;
    for (let tick = 0; tick < TICKS; tick++) {
      const snaps = session.snapshots();
      for (let p = 0; p < 4; p++) {
        const me = snaps[p]?.players[0];
        if (me !== undefined && !isArmedPlayer(me)) {
          session.race().simAt(p)?.debugDropCapsule(me.paddle.x, me.paddle.y, "L");
        }
        peakBolts = Math.max(peakBolts, snaps[p]?.bolts?.length ?? 0);
      }
      const sweep = Math.sin(tick / 30);
      const frames = [0, 1, 2, 3].map((p) => frame(p, tick, sweep, tick % 90 === 0, true));
      const t0 = performance.now();
      session.step(frames);
      samples.push(performance.now() - t0);
    }
    expect(peakBolts).toBeGreaterThan(0);
    expect(median(samples)).toBeLessThan(SIM_BUDGET_MS);
  });

  it("a 4-Paddle Shared Field, every Paddle Armed and holding fire, steps in well under 2 ms (median per tick)", () => {
    // Ticket #149: one sim carrying four Bolt flights at once (placement A:
    // four bottom Paddles). Re-arming after a lost ball happens untimed.
    const sim = createSharedFieldSim(getLevelSync(1), { placement: "A", ballModel: "perPlayer", playerCount: 4 });
    const samples: number[] = [];
    let peakBolts = 0;
    for (let tick = 0; tick < TICKS; tick++) {
      const snap = sim.snapshot();
      for (const me of snap.players) {
        if (!isArmedPlayer(me)) sim.debugDropCapsule(me.paddle.x, me.paddle.y, "L");
      }
      peakBolts = Math.max(peakBolts, snap.bolts?.length ?? 0);
      const sweep = Math.sin(tick / 30) * 0.5;
      const frames = [0, 1, 2, 3].map((p) => frame(p, tick, sweep, tick % 90 === 0, true));
      const t0 = performance.now();
      sim.step(frames);
      samples.push(performance.now() - t0);
    }
    // More than one Paddle's cap in flight: the flights really overlap.
    expect(peakBolts).toBeGreaterThan(LASER_BOLTS_PER_PADDLE);
    expect(median(samples)).toBeLessThan(SIM_BUDGET_MS);
  });

  it("the Bolt module at its cap (4 Paddles x 8 Bolts) steps in well under 2 ms (median per tick)", () => {
    // Real cooldowns keep a Paddle near 6 Bolts in flight; resetting the
    // cooldown every tick pins all four at the 8-Bolt cap. Bricks fill only
    // the top two rows, so every Bolt sweeps the whole grid before it lands.
    const bolts = new Bolts(SNAPSHOT_PLAYERS_MAX, {
      cellAt: (i) => (i < 2 * BRICK_COLS ? 1 : 0),
      hitBrick: () => undefined,
      goldHit: () => undefined,
      bossBox: () => null,
      hitBoss: () => undefined,
    });
    const boxes = Array.from({ length: SNAPSHOT_PLAYERS_MAX }, (_, p) => ({
      x: 20 + p * 56,
      y: PADDLE_Y,
      w: PADDLE_W,
      h: PADDLE_H,
    }));
    const samples: number[] = [];
    let atCap = 0;
    for (let tick = 0; tick < TICKS; tick++) {
      for (let p = 0; p < SNAPSHOT_PLAYERS_MAX; p++) {
        bolts.resetCooldown(p);
        bolts.tryFire(p, p, boxes[p]!);
      }
      // The load the step carries: every Paddle at the cap.
      if (bolts.count === SNAPSHOT_PLAYERS_MAX * LASER_BOLTS_PER_PADDLE) atCap++;
      const t0 = performance.now();
      bolts.step();
      samples.push(performance.now() - t0);
    }
    expect(atCap).toBeGreaterThan(TICKS / 2);
    expect(median(samples)).toBeLessThan(SIM_BUDGET_MS);
  });
});
