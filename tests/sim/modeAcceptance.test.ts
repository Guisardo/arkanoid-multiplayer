// Ticket 108-112 acceptance traceability: behaviours the tickets name that no
// existing mode suite pinned down directly. Everything runs through the same
// public session seams the app uses (createMultiFieldSession,
// createSharedFieldSim, createAssistSession).
import { describe, expect, it } from "vitest";
import { createMultiFieldSession } from "sim/multiField";
import { createSharedFieldSim } from "sim/sharedField";
import { createAssistSession } from "sim/assistSession";
import { getLevelSync } from "content/levels";
import { BRICK_COLS } from "sim/constants";
import { EMPTY_ACTIONS, isDestructibleCell, type InputFrame, type Snapshot } from "shared/protocol";

function frame(player: number, tick: number, launch = false): InputFrame {
  return { player, tick, axisX: 0, axisY: 0, launch, primaryHeld: false, actions: EMPTY_ACTIONS };
}

function firstDestructible(snap: Snapshot): number {
  for (let i = 0; i < snap.bricks.length; i++) {
    if (isDestructibleCell(snap.bricks[i] ?? 0)) return i;
  }
  return -1;
}

describe("Race: identical capsule script per round (ticket 108)", () => {
  it("both fields drop the same capsules for the same break sequence", () => {
    const session = createMultiFieldSession({
      playerCount: 2,
      config: { structure: "continuous", bestOf: 1, levelSelection: "fixedOrder", timeCapTicks: null },
    });
    const observed: string[][] = [[], []];
    let tick = 0;
    for (let breaks = 0; breaks < 14; breaks++) {
      for (const p of [0, 1]) {
        const target = firstDestructible(session.snapshots()[p]!);
        expect(target).toBeGreaterThanOrEqual(0);
        const col = target % BRICK_COLS;
        const row = Math.floor(target / BRICK_COLS);
        session.debugSetBall(p, col * 16 + 8 + 2, 20 + (row + 1) * 8 + 6, 0, -200);
      }
      for (let s = 0; s < 6; s++) {
        session.step([frame(0, tick), frame(1, tick)]);
        tick++;
        session.snapshots().forEach((snap, p) => {
          observed[p]!.push(JSON.stringify(snap.capsules));
        });
      }
    }
    // The script must actually have dropped something, or equality is vacuous.
    expect(observed[0]!.some((c) => c !== "[]")).toBe(true);
    expect(observed[1]).toEqual(observed[0]);
  });

  it("round progression is shared: both fields sit on the same round and layout", () => {
    const session = createMultiFieldSession({
      playerCount: 3,
      config: { structure: "continuous", bestOf: 1, levelSelection: "fixedOrder", timeCapTicks: null },
    });
    const snaps = session.snapshots();
    expect(new Set(snaps.map((s) => s.round)).size).toBe(1);
    expect(snaps[1]!.bricks).toEqual(snaps[0]!.bricks);
    expect(snaps[2]!.bricks).toEqual(snaps[0]!.bricks);
  });
});

describe("Shared field: game over when the shared pool is exhausted (ticket 111)", () => {
  it("losing every life in the pool ends the game", () => {
    const sim = createSharedFieldSim(getLevelSync(1), { placement: "A", ballModel: "shared", playerCount: 2 });
    expect(sim.getTeamState().lives).toBe(6);
    let tick = 0;
    for (let lost = 1; lost <= 6; lost++) {
      sim.step([frame(0, tick++, true)]);
      sim.debugSetBall(104, 300, 0, 60);
      for (let i = 0; i < 12; i++) sim.step([frame(0, tick++)]);
      expect(sim.getTeamState().lives).toBe(6 - lost);
      if (lost < 6) expect(sim.snapshot().phase).toBe("serve");
    }
    expect(sim.snapshot().phase).toBe("gameOver");
  });
});

describe("Parallel assist: per-player lives (ticket 112)", () => {
  it("every player starts on their own 5 lives", () => {
    const session = createAssistSession({ playerCount: 3, startRound: 1, endRound: 3, seed: 7 });
    const lives = session.snapshots().map((s) => s.players[0]!.lives);
    expect(lives).toEqual([5, 5, 5]);
  });
});
