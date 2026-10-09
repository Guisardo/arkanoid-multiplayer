// Solo episode resume (ticket 89): the run survives a crash, a closed tab and a
// reload. Covers the atomic record in storage and the persist/restore cycle in
// the episode; the boot prompt's DOM lives in tests/ui/continueEpisode.test.ts.
import { describe, expect, it } from "vitest";
import {
  CONTINUE_SCORE_FACTOR,
  createSoloEpisode,
  EPISODE_SAVE_INTERVAL_TICKS,
  SOLO_MAX_ROUND,
  SOLO_START_LIVES,
} from "app/soloEpisode";
import { Storage, type StorageBackend } from "persistence/storage";
import { COMPOSITE_KEY, isContinuableEpisode, type EpisodeState } from "persistence/saveDocument";
import { EMPTY_ACTIONS, isDestructibleCell, type InputFrame } from "shared/protocol";
import { BRICK_COLS } from "sim/constants";

function backend(): StorageBackend & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

/** Same backend, a second `Storage` — i.e. what a reload sees. */
function reloaded(store: ReturnType<typeof backend>): Storage {
  return new Storage(store, { deviceId: "dev-1" });
}

function frame(tick: number, axisX = 0, launch = false): InputFrame {
  return { player: 0, tick, axisX, axisY: 0, launch, actions: EMPTY_ACTIONS };
}

async function episodeOf(store: ReturnType<typeof backend>, clock: { t: number }) {
  return await createSoloEpisode({
    storage: reloaded(store),
    now: () => {
      clock.t += 1;
      return clock.t;
    },
  });
}

/** Drop the ball three times → game over. */
function forceGameOver(ep: Awaited<ReturnType<typeof createSoloEpisode>>): void {
  for (let loss = 0; loss < SOLO_START_LIVES && ep.phase() === "playing"; loss++) {
    ep.debugSetBall(104, 300, 0, 60);
    for (let s = 0; s < 12; s++) ep.step([frame(loss * 12 + s)]);
  }
}

/** Clear one round (drives the round-advance checkpoint). */
function clearRound(ep: Awaited<ReturnType<typeof createSoloEpisode>>): void {
  const roundBefore = ep.round();
  let guard = 0;
  while (guard < 3000 && ep.round() === roundBefore && ep.phase() === "playing") {
    const snap = ep.snapshot();
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
    ep.debugSetBall(col * 16 + 10, 20 + (row + 1) * 8 + 6, 0, -200);
    for (let s = 0; s < 20; s++) {
      ep.step([frame(guard * 20 + s)]);
      guard++;
      if (ep.round() !== roundBefore || ep.phase() !== "playing") return;
    }
  }
}

function record(round: number, score: number, phase: EpisodeState["phase"] = "playing"): EpisodeState {
  return { round, score, lives: SOLO_START_LIVES, phase, timestamp: 1 };
}

/** Episode wired to whatever the store currently holds, resuming if it can. */
async function resumed(store: ReturnType<typeof backend>): Promise<Awaited<ReturnType<typeof createSoloEpisode>>> {
  const storage = reloaded(store);
  const pending = storage.readEpisode();
  return await createSoloEpisode({
    storage,
    ...(pending !== null ? { savedEpisode: pending } : {}),
  });
}

describe("isContinuableEpisode", () => {
  it("only an in-progress run is resumable", async () => {
    expect(isContinuableEpisode(record(3, 100))).toBe(true);
    expect(isContinuableEpisode(record(3, 100, "gameOver"))).toBe(false);
    expect(isContinuableEpisode(record(3, 100, "episodeComplete"))).toBe(false);
  });

  it("null / undefined are never resumable", async () => {
    expect(isContinuableEpisode(null)).toBe(false);
    expect(isContinuableEpisode(undefined)).toBe(false);
  });
});

describe("Storage episode record (ADR 0008, ticket 89)", () => {
  it("reads null when nothing was ever written", async () => {
    expect(reloaded(backend()).readEpisode()).toBeNull();
  });

  it("round-trips the record through the composite key", async () => {
    const store = backend();
    const storage = reloaded(store);
    storage.writeEpisode(record(7, 4200));
    expect(reloaded(store).readEpisode()).toMatchObject({ round: 7, score: 4200, phase: "playing" });
  });

  it("writes inside the same atomic document as the settings", async () => {
    const store = backend();
    const storage = reloaded(store);
    storage.savePartial({ name: "Ada" });
    storage.writeEpisode(record(2, 10));
    expect([...store.map.keys()]).toEqual([COMPOSITE_KEY]);
    const doc = JSON.parse(store.map.get(COMPOSITE_KEY) ?? "{}") as {
      settings: { name: string };
      soloEpisode: EpisodeState;
    };
    expect(doc.settings.name).toBe("Ada");
    expect(doc.soloEpisode.round).toBe(2);
  });

  it("clearEpisode drops the record but keeps everything else", async () => {
    const store = backend();
    const storage = reloaded(store);
    storage.savePartial({ name: "Ada" });
    storage.recordSolo(1234, 5);
    storage.writeEpisode(record(3, 100));
    storage.clearEpisode();
    const after = reloaded(store);
    expect(after.readEpisode()).toBeNull();
    expect(after.loadAll()).toMatchObject({ name: "Ada", soloHighScore: 1234, soloHighestRound: 5 });
  });

  it("a corrupt record reads as no episode rather than throwing", async () => {
    const store = backend();
    const storage = reloaded(store);
    storage.savePartial({ name: "Ada" });
    const doc = JSON.parse(store.map.get(COMPOSITE_KEY) ?? "{}") as Record<string, unknown>;
    doc["soloEpisode"] = { round: 4, score: "lots", lives: null, phase: "somewhere", timestamp: {} };
    store.map.set(COMPOSITE_KEY, JSON.stringify(doc));
    expect(reloaded(store).readEpisode()).toBeNull();
    expect(reloaded(store).loadAll().name).toBe("Ada");
  });

  it("an out-of-range round in a hand-edited record is clamped on resume", async () => {
    const store = backend();
    const storage = reloaded(store);
    storage.writeEpisode({ round: 9999, score: 1000, lives: 1, phase: "playing", timestamp: 1 });
    expect((await resumed(store)).round()).toBe(SOLO_MAX_ROUND);
  });
});

describe("episode persist/restore cycle (ticket 89)", () => {
  it("checkpoints on round clear, and the record names the NEW round", async () => {
    const store = backend();
    const ep = await episodeOf(store, { t: 0 });
    expect(reloaded(store).readEpisode()).toBeNull();
    clearRound(ep);
    expect(ep.round()).toBe(2);
    expect(reloaded(store).readEpisode()).toMatchObject({ round: 2, phase: "playing" });
  });

  it("checkpoints on pause, so a tab closed from the pause menu resumes", async () => {
    const store = backend();
    const ep = await episodeOf(store, { t: 0 });
    for (let i = 0; i < 5; i++) ep.step([frame(i)]);
    expect(reloaded(store).readEpisode()).toBeNull();
    ep.pause();
    expect(reloaded(store).readEpisode()).toMatchObject({ round: 1, phase: "playing" });
    expect(isContinuableEpisode(reloaded(store).readEpisode())).toBe(true);
  });

  it("checkpoints on game over, marked terminal so the boot prompt stays quiet", async () => {
    const store = backend();
    const ep = await episodeOf(store, { t: 0 });
    forceGameOver(ep);
    expect(ep.phase()).toBe("gameOver");
    const saved = reloaded(store).readEpisode();
    expect(saved?.phase).toBe("gameOver");
    expect(isContinuableEpisode(saved)).toBe(false);
  });

  it("checkpoints every 30 s of ticks, not on every tick", async () => {
    const store = backend();
    const ep = await episodeOf(store, { t: 0 });
    for (let i = 0; i < EPISODE_SAVE_INTERVAL_TICKS - 1; i++) ep.step([frame(i)]);
    expect(reloaded(store).readEpisode()).toBeNull();
    ep.step([frame(EPISODE_SAVE_INTERVAL_TICKS - 1)]);
    expect(reloaded(store).readEpisode()).toMatchObject({ round: 1, phase: "playing" });
  });

  it("save() forces a checkpoint (the session calls it on quit)", async () => {
    const store = backend();
    const ep = await episodeOf(store, { t: 0 });
    ep.step([frame(0)]);
    ep.persist();
    expect(reloaded(store).readEpisode()).toMatchObject({ round: 1, phase: "playing" });
  });

  it("the record carries round, score, lives, phase and a timestamp", async () => {
    const store = backend();
    const clock = { t: 0 };
    const ep = await episodeOf(store, clock);
    clearRound(ep);
    const saved = reloaded(store).readEpisode();
    expect(saved).not.toBeNull();
    expect(saved?.round).toBe(ep.round());
    expect(saved?.score).toBe(ep.score());
    expect(saved?.lives).toBe(SOLO_START_LIVES);
    expect(saved?.phase).toBe("playing");
    expect(typeof saved?.timestamp).toBe("number");
    expect(saved?.timestamp).toBeGreaterThan(0);
  });

  it("abandon() drops the record — an abandoned run must not be Continuable", async () => {
    const store = backend();
    const ep = await episodeOf(store, { t: 0 });
    for (let i = 0; i < 3; i++) ep.step([frame(i)]);
    ep.persist();
    expect(isContinuableEpisode(reloaded(store).readEpisode())).toBe(true);
    ep.abandon();
    expect(reloaded(store).readEpisode()).toBeNull();
  });
});

describe("Continue from a persisted run (ticket 89)", () => {
  it("resumes the saved round with fresh 3 lives and score × 0.4", async () => {
    const store = backend();
    reloaded(store).writeEpisode(record(9, 5000));
    const ep = await resumed(store);
    expect(ep.round()).toBe(9);
    expect(ep.score()).toBe(Math.floor(5000 * CONTINUE_SCORE_FACTOR));
    expect(ep.snapshot().players[0]?.lives).toBe(SOLO_START_LIVES);
    expect(ep.phase()).toBe("playing");
  });

  it("resuming starts a fresh round — no bricks carried over", async () => {
    const store = backend();
    reloaded(store).writeEpisode(record(9, 5000));
    const ep = await resumed(store);
    expect(ep.snapshot().round).toBe(9);
    expect(ep.snapshot().bricks.filter((c) => isDestructibleCell(c)).length).toBeGreaterThan(0);
    expect(ep.snapshot().phase).toBe("serve");
  });

  it("a reloaded run is playable to the next round clear", async () => {
    const store = backend();
    reloaded(store).writeEpisode(record(2, 1000));
    const ep = await resumed(store);
    clearRound(ep);
    expect(ep.round()).toBe(3);
  });

  it("a negative score in a hand-edited record floors to 0", async () => {
    const store = backend();
    reloaded(store).writeEpisode({ round: 4, score: -50, lives: 2, phase: "playing", timestamp: 1 });
    expect((await resumed(store)).score()).toBe(0);
  });

  it("restart drops the record so a later crash cannot resurrect the old run", async () => {
    const store = backend();
    reloaded(store).writeEpisode(record(5, 900));
    const ep = await resumed(store);
    forceGameOver(ep);
    ep.restartRun();
    expect(ep.round()).toBe(1);
    expect(ep.score()).toBe(0);
    expect(reloaded(store).readEpisode()).toBeNull();
  });

  it("Continue after a game over re-checkpoints the live run", async () => {
    const store = backend();
    const ep = await episodeOf(store, { t: 0 });
    forceGameOver(ep);
    expect(isContinuableEpisode(reloaded(store).readEpisode())).toBe(false);
    ep.continueRun();
    const saved = reloaded(store).readEpisode();
    expect(saved?.phase).toBe("playing");
    expect(isContinuableEpisode(saved)).toBe(true);
  });
});
