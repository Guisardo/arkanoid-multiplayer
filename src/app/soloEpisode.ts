// Solo episode flow (ticket 36, spec §6.1): rounds 1–33, 3 lives, score
// accumulates, round advances on clear, Continue (fresh 3 lives, score −60%)
// or Restart (score 0, round 1), localStorage records, pause freely.
// App-level composition — the sim stays a pure round engine.
import type { RoundSim } from "sim/roundSim";
import { createRoundSim } from "sim/roundSim";
import { getLevel, availableRounds } from "content/levels";
import type { InputFrame, Snapshot } from "shared/protocol";
import type { Storage } from "persistence/storage";

export const SOLO_MAX_ROUND = 33;
export const SOLO_START_LIVES = 3;
/** Continue: resume from current round with fresh lives, score −60%. */
export const CONTINUE_SCORE_FACTOR = 0.4;

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
  /** Pause freely (coop semantics). */
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  /** Test hook: place the ball. */
  debugSetBall(x: number, y: number, vx: number, vy: number): void;
}

export interface SoloEpisodeOptions {
  storage: Storage;
  playerName?: string;
  /** Test hook: start mid-episode. */
  startRound?: number;
}

export function createSoloEpisode(opts: SoloEpisodeOptions): SoloEpisode {
  const storage = opts.storage;
  let round = opts.startRound ?? 1;
  let score = 0;
  let phase: SoloPhase = "playing";
  let paused = false;
  let tick = 0;

  let sim: RoundSim = makeSim();

  function makeSim(): RoundSim {
    return createRoundSim(getLevel(round), {
      lives: SOLO_START_LIVES,
      score,
      playerName: opts.playerName ?? "Player 1",
    });
  }

  function record(): void {
    storage.recordSolo(score, round);
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
        record();
        const maxAuthored = Math.max(...availableRounds());
        if (round >= Math.min(SOLO_MAX_ROUND, maxAuthored)) {
          phase = "episodeComplete";
          return;
        }
        score = snap.players[0]?.score ?? score;
        round++;
        sim = makeSim();
      } else if (snap.phase === "gameOver") {
        record();
        phase = "gameOver";
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
    },
    restartRun() {
      round = 1;
      score = 0;
      phase = "playing";
      sim = makeSim();
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    isPaused() {
      return paused;
    },
    debugSetBall(x, y, vx, vy) {
      sim.debugSetBall(x, y, vx, vy);
    },
  };
}
