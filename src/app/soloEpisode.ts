// Solo episode flow (ticket 36, spec §6.1): rounds 1–33, 3 lives, score
// accumulates, round advances on clear, Continue (fresh 3 lives, score −60%)
// or Restart (score 0, round 1), localStorage records, pause freely.
//
// Ticket 89 adds mid-episode persistence: the run's round/score/lives/phase is
// written on every round clear, game over, pause, and a 30 s heartbeat, so a
// crash or a closed tab offers a **Continue** instead of restarting. Per
// CONTEXT.md, Continue is "resume the episode from the current round with a
// fresh set of lives" — the same deal whether it follows a game over or a
// reload, so a player can never dodge the score penalty by reloading.
// App-level composition — the sim stays a pure round engine.
import type { RoundSim } from "sim/roundSim";
import { availableRounds, getLevelSync, preloadLevels } from "content/levels";
import type { InputFrame, Snapshot } from "shared/protocol";
import type { Storage } from "persistence/storage";
import type { EpisodeState } from "persistence/saveDocument";

export const SOLO_MAX_ROUND = 33;
export const SOLO_START_LIVES = 3;
/** Continue: resume from current round with fresh lives, score −60%. */
export const CONTINUE_SCORE_FACTOR = 0.4;
/**
 * Heartbeat: how often a long round writes the episode record, so a crash costs
 * at most 30 s of progress. In ticks, not wall-clock ms, so the cadence does
 * not stretch under slow-motion.
 */
export const EPISODE_SAVE_INTERVAL_TICKS = 30 * 60;

export type SoloPhase = "playing" | "gameOver" | "episodeComplete";

export interface SoloEpisode {
  readonly currentTick: number;
  step(inputs: InputFrame[]): void;
  snapshot(): Snapshot;
  phase(): SoloPhase;
  round(): number;
  score(): number;
  /** Game-over choice: Continue (current round, fresh 3 lives, score −60%). */
  continueRun(): void;
  /** Game-over choice: Restart (round 1, score 0). */
  restartRun(): void;
  /** Pause freely (coop semantics). Writes the episode record before freezing. */
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  /**
   * Write the episode record now, so the run can be Continued after a reload.
   * Called on pause, on quit-to-teardown, and on the heartbeat.
   */
  persist(): void;
  /** Drop the record — the run was abandoned, so it must not be Continued. */
  abandon(): void;
  /** Test hook: place the ball. */
  debugSetBall(x: number, y: number, vx: number, vy: number): void;
}

export interface SoloEpisodeOptions {
  storage: Storage;
  playerName?: string;
  /** Test hook: start mid-episode. */
  startRound?: number;
  /** Ticket 89: a persisted in-progress run to Continue from. */
  savedEpisode?: EpisodeState;
  /** Epoch-ms clock, injected so persisted timestamps are test-deterministic. */
  now?: () => number;
}

/**
 * ADR 0007: the episode is an async creator now. It lazy-imports the round
 * sim (the solo player never downloads the multiplayer variants) and
 * preloads every round the run can still reach, so the sim can be rebuilt
 * synchronously on a round clear without an await on the hot path.
 */
export async function createSoloEpisode(opts: SoloEpisodeOptions): Promise<SoloEpisode> {
  const storage = opts.storage;
  const now = opts.now ?? (() => Date.now());
  const saved = opts.savedEpisode;
  let round =
    saved === undefined
      ? (opts.startRound ?? 1)
      : Math.max(1, Math.min(SOLO_MAX_ROUND, Math.round(saved.round)));
  // Continuing a crashed run costs the same score as continuing a lost one.
  let score = saved === undefined ? 0 : Math.floor(Math.max(0, saved.score) * CONTINUE_SCORE_FACTOR);
  let phase: SoloPhase = "playing";
  let paused = false;
  let tick = 0;
  /** Tick of the last heartbeat write (0 = never). */
  let lastSaveTick = 0;

  // Round sim (ADR 0007): loaded on demand, then reused for the run.
  const { createRoundSim } = await import("sim/roundSim");
  // Rounds this run can still reach — fetched up front so a round clear
  // rebuilds the sim synchronously. Restart jumps back to round 1, so the
  // whole episode range is warmed, not just the tail from the start round.
  await preloadLevels(availableRounds());

  let sim: RoundSim = makeSim();

  function makeSim(): RoundSim {
    return createRoundSim(getLevelSync(round), {
      lives: SOLO_START_LIVES,
      score,
      playerName: opts.playerName ?? "Player 1",
    });
  }

  function record(): void {
    storage.recordSolo(score, round);
  }

  /** One atomic write of the in-progress run, inside the composite save key. */
  function write(at: SoloPhase = phase): void {
    storage.writeEpisode({
      round,
      score,
      lives: sim.snapshot().players[0]?.lives ?? SOLO_START_LIVES,
      phase: at,
      timestamp: now(),
    });
    lastSaveTick = tick;
  }

  return {
    get currentTick() {
      return tick;
    },
    step(inputs) {
      if (phase !== "playing" || paused) return;
      sim.step(inputs);
      tick++;
      const snap = sim.snapshot();
      if (snap.phase === "roundClear") {
        score = snap.players[0]?.score ?? score;
        record();
        if (round >= SOLO_MAX_ROUND) {
          phase = "episodeComplete";
          // Keep the record, marked terminal: the boot prompt must not offer to
          // Continue a finished run, but the document still describes it.
          write("episodeComplete");
          return;
        }
        round++;
        sim = makeSim();
        // Round clear is a natural write: the next round is exactly what a
        // Continue restores.
        write();
      } else if (snap.phase === "gameOver") {
        // Sync the run's score from the sim before recording — Continue
        // applies −60% to the score actually reached (ticket 36/53 e2e).
        score = snap.players[0]?.score ?? score;
        record();
        phase = "gameOver";
        write("gameOver");
      } else if (tick - lastSaveTick >= EPISODE_SAVE_INTERVAL_TICKS) {
        // Heartbeat: a crash mid-round costs at most this much progress.
        write();
      }
    },
    snapshot() {
      return sim.snapshot();
    },
    phase() {
      return phase;
    },
    round() {
      return round;
    },
    score() {
      return sim.snapshot().players[0]?.score ?? score;
    },
    continueRun() {
      if (phase !== "gameOver") return;
      score = Math.floor(score * CONTINUE_SCORE_FACTOR);
      phase = "playing";
      sim = makeSim();
      write();
    },
    restartRun() {
      round = 1;
      score = 0;
      phase = "playing";
      sim = makeSim();
      // A restart abandons the old record: a later reload must not Continue a
      // run the player already walked away from.
      storage.clearEpisode();
    },
    pause() {
      if (paused) return;
      paused = true;
      if (phase === "playing") write();
    },
    resume() {
      paused = false;
    },
    isPaused() {
      return paused;
    },
    persist() {
      write();
    },
    abandon() {
      storage.clearEpisode();
    },
    debugSetBall(x, y, vx, vy) {
      sim.debugSetBall(x, y, vx, vy);
    },
  };
}
