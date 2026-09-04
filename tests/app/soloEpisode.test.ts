import { describe, expect, it } from "vitest";
import { createSoloEpisode, SOLO_MAX_ROUND, CONTINUE_SCORE_FACTOR } from "app/soloEpisode";
import { Storage, type StorageBackend } from "persistence/storage";
import { EMPTY_ACTIONS, isDestructibleCell, type InputFrame } from "shared/protocol";
import { BRICK_COLS } from "sim/constants";

function fakeBackend(): StorageBackend {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

function frame(tick: number, axisX = 0, launch = false): InputFrame {
  return { player: 0, tick, axisX, axisY: 0, launch, actions: EMPTY_ACTIONS };
}

/** Clear exactly one round, stopping when the episode advances. */
function clearRound(ep: ReturnType<typeof createSoloEpisode>): void {
  const roundBefore = ep.round();
  let guard = 0;
  while (guard < 3000 && ep.round() === roundBefore && ep.phase() === "playing") {
    const snap = ep.snapshot();
    // Boss round (ticket 49): defeat Doh — brick clearing never ends it.
    // Ball placed once per batch (needs ~12 ticks to reach the boss); the
    // paddle oscillates every step to dodge aimed projectiles.
    if (snap.boss !== undefined && !snap.boss.dead) {
      (ep as unknown as { debugSetBall: (x: number, y: number, vx: number, vy: number) => void }).debugSetBall(
        snap.boss.x,
        snap.boss.y + 40,
        0,
        -200,
      );
      for (let s = 0; s < 20; s++) {
        const axis = Math.sin(guard * 0.5) > 0 ? 1 : -1;
        ep.step([frame(guard, axis)]);
        guard++;
        if (ep.round() !== roundBefore) return;
        if (ep.phase() !== "playing") return;
      }
      continue;
    }
    let target = -1;
    for (let i = 0; i < snap.bricks.length; i++) {
      if (isDestructibleCell(snap.bricks[i] ?? 0)) {
        target = i;
        break;
      }
    }
    if (target < 0) return;
    const col = target % BRICK_COLS;
    const row = Math.floor(target / BRICK_COLS);
    (ep as unknown as { debugSetBall: (x: number, y: number, vx: number, vy: number) => void }).debugSetBall(
      col * 16 + 8 + 2,
      20 + (row + 1) * 8 + 6,
      0,
      -200,
    );
    for (let s = 0; s < 20; s++) {
      ep.step([frame(guard * 20 + s)]);
      guard++;
      if (ep.round() !== roundBefore) return;
      if (ep.phase() !== "playing") return;
    }
  }
}

describe("solo episode flow (ticket 36)", () => {
  it("starts at round 1, 3 lives, score 0", () => {
    const ep = createSoloEpisode({ storage: new Storage(fakeBackend()) });
    expect(ep.round()).toBe(1);
    expect(ep.snapshot().players[0]!.lives).toBe(3);
    expect(ep.score()).toBe(0);
    expect(ep.phase()).toBe("playing");
  });

  it("round advances on clear; score accumulates across rounds", () => {
    const ep = createSoloEpisode({ storage: new Storage(fakeBackend()) });
    clearRound(ep);
    expect(ep.round()).toBe(2);
    const scoreAfterR1 = ep.score();
    expect(scoreAfterR1).toBeGreaterThan(0);
    clearRound(ep);
    expect(ep.round()).toBe(3);
    expect(ep.score()).toBeGreaterThan(scoreAfterR1);
  });

  it("game over → Continue: same round, fresh 3 lives, score −60%", () => {
    const ep = createSoloEpisode({ storage: new Storage(fakeBackend()), startRound: 2 });
    // Force game over: drop the ball 3 times.
    const dbg = ep as unknown as { debugSetBall: (x: number, y: number, vx: number, vy: number) => void };
    for (let loss = 0; loss < 3; loss++) {
      dbg.debugSetBall(104, 300, 0, 60);
      for (let s = 0; s < 12; s++) ep.step([frame(loss * 12 + s)]);
    }
    expect(ep.phase()).toBe("gameOver");
    const scoreBefore = ep.score();
    ep.continueRun();
    expect(ep.phase()).toBe("playing");
    expect(ep.round()).toBe(2);
    expect(ep.snapshot().players[0]!.lives).toBe(3);
    expect(ep.score()).toBe(Math.floor(scoreBefore * CONTINUE_SCORE_FACTOR));
  });

  it("game over → Restart: round 1, score 0", () => {
    const ep = createSoloEpisode({ storage: new Storage(fakeBackend()), startRound: 3 });
    const dbg = ep as unknown as { debugSetBall: (x: number, y: number, vx: number, vy: number) => void };
    for (let loss = 0; loss < 3; loss++) {
      dbg.debugSetBall(104, 300, 0, 60);
      for (let s = 0; s < 12; s++) ep.step([frame(loss * 12 + s)]);
    }
    expect(ep.phase()).toBe("gameOver");
    ep.restartRun();
    expect(ep.phase()).toBe("playing");
    expect(ep.round()).toBe(1);
    expect(ep.score()).toBe(0);
  });

  it("high score + highest round persisted via storage", () => {
    const backend = fakeBackend();
    const storage = new Storage(backend);
    const ep = createSoloEpisode({ storage });
    clearRound(ep);
    clearRound(ep);
    const all = storage.loadAll();
    expect(all.soloHighestRound).toBeGreaterThanOrEqual(2);
    expect(all.soloHighScore).toBeGreaterThan(0);
  });

  it("pause freezes the sim; resume continues cleanly", () => {
    const ep = createSoloEpisode({ storage: new Storage(fakeBackend()) });
    ep.step([frame(0)]);
    const tickBefore = ep.currentTick;
    ep.pause();
    expect(ep.isPaused()).toBe(true);
    for (let i = 0; i < 10; i++) ep.step([frame(i)]);
    expect(ep.currentTick).toBe(tickBefore); // frozen
    ep.resume();
    ep.step([frame(99)]);
    expect(ep.currentTick).toBe(tickBefore + 1);
  });

  it("episode completes at the final round (SOLO_MAX_ROUND = 33)", () => {
    // Rounds 17–33 landed (ticket 35): clearing round 33 completes the
    // episode; clearing 16 now advances to 17 (no authored-content clamp).
    const ep = createSoloEpisode({ storage: new Storage(fakeBackend()), startRound: 16 });
    clearRound(ep);
    expect(ep.phase()).toBe("playing");
    expect(ep.round()).toBe(17);
    const epFinal = createSoloEpisode({ storage: new Storage(fakeBackend()), startRound: 33 });
    clearRound(epFinal);
    expect(epFinal.phase()).toBe("episodeComplete");
    expect(SOLO_MAX_ROUND).toBe(33);
  });
});
