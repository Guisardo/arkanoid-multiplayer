// Multi-field session composition (ticket 34): N players on identical
// parallel fields — the reusable seam for Race (34), Attack (39), and
// Parallel assist (40). Each player gets an independent RoundSim instance;
// the session coordinates match structure, level selection, time cap, and
// timeout resolution.
import { createRoundSim, type RoundSim } from "./roundSim";
import type { LevelData } from "content/levelFormat";
import { getLevel } from "content/levels";
import type { InputFrame, Snapshot } from "shared/protocol";

export type MatchStructure = "bestOf" | "continuous" | "oneOff";
export type LevelSelection = "hostPick" | "fixedOrder" | "random";

export interface MatchConfig {
  structure: MatchStructure;
  /** bestOf: rounds needed to win (1–7 odd). */
  bestOf: number;
  levelSelection: LevelSelection;
  /** Finite time cap in ticks, or null = infinite. */
  timeCapTicks: number | null;
  /** Host-picked round for the current round (hostPick mode). */
  hostPickRound?: number;
}

export interface MultiFieldSession {
  readonly playerCount: number;
  /** Advance one sim tick with all players' input frames. */
  step(inputs: InputFrame[]): void;
  /** Snapshot per player (parallel identical fields). */
  snapshots(): Snapshot[];
  /** Round/match state. */
  state(): MatchState;
  /** Seeded level picker for "random" selection. */
  setNextRound(round: number): void;
  /** Test hook: place a player's ball. */
  debugSetBall(player: number, x: number, y: number, vx: number, vy: number): void;
  /** Composition seam (tickets 39/40): player i's underlying round sim. */
  simAt(player: number): RoundSim | undefined;
}

export interface MatchState {
  /** Current round number being played. */
  round: number;
  /** Round points per player (bestOf). */
  roundPoints: number[];
  /** Levels cleared per player (continuous). */
  levelsCleared: number[];
  /** Bricks broken in the current level per player. */
  bricksThisLevel: number[];
  /** Match over: winner index or -1 draw. */
  matchWinner: number | null;
  /** Phase. */
  phase: "playing" | "matchOver";
}

/**
 * Timeout resolution (spec §6.3): round-based → most bricks that round;
 * continuous → furthest along (levels cleared, then bricks in current);
 * one-off → most bricks; exact tie → draw, no round point, next level.
 */
export function resolveTimeout(
  structure: MatchStructure,
  levelsCleared: readonly number[],
  bricksThisLevel: readonly number[],
): { winner: number; draw: boolean } {
  let best = -1;
  let bestScore = -1;
  let draw = false;
  for (let i = 0; i < levelsCleared.length; i++) {
    const cleared = levelsCleared[i] ?? 0;
    const bricks = bricksThisLevel[i] ?? 0;
    const score = structure === "continuous" ? cleared * 10000 + bricks : bricks;
    if (score > bestScore) {
      bestScore = score;
      best = i;
      draw = false;
    } else if (score === bestScore) {
      draw = true;
    }
  }
  return { winner: draw ? -1 : best, draw };
}

export interface MultiFieldOptions {
  playerCount: number;
  config: MatchConfig;
  playerNames?: string[] | undefined;
  /** Seed for random level selection (deterministic). */
  seed?: number | undefined;
}

export function createMultiFieldSession(opts: MultiFieldOptions): MultiFieldSession {
  const { playerCount, config } = opts;
  const names = opts.playerNames ?? Array.from({ length: playerCount }, (_, i) => `Player ${String(i + 1)}`);

  let round = pickRound(config, 1, opts.seed ?? 1);
  let rngState = (opts.seed ?? 1) >>> 0;
  const roundPoints = new Array<number>(playerCount).fill(0);
  const levelsCleared = new Array<number>(playerCount).fill(0);
  let matchWinner: number | null = null;
  let phase: MatchState["phase"] = "playing";
  let tick = 0;

  let level: LevelData = getLevel(round);
  let sims: RoundSim[] = makeSims();

  function makeSims(): RoundSim[] {
    return Array.from({ length: playerCount }, (_, i) =>
      createRoundSim(level, { lives: 5, score: 0, playerName: names[i] ?? undefined }),
    );
  }

  function pickRound(cfg: MatchConfig, roundIndex: number, seed: number): number {
    switch (cfg.levelSelection) {
      case "hostPick":
        return cfg.hostPickRound ?? 1;
      case "fixedOrder":
        return Math.min(roundIndex, 33);
      case "random": {
        // Deterministic LCG pick in 1..33 (available rounds).
        let s = (seed + roundIndex * 2654435761) >>> 0;
        s ^= s << 13;
        s >>>= 0;
        s ^= s >> 17;
        s ^= s << 5;
        s >>>= 0;
        return 1 + (s % 33);
      }
    }
  }

  function bricksThisLevel(): number[] {
    const total = level.grid.join("").split("").filter((c) => c !== "." && c !== "G").length;
    return sims.map((sim) => {
      const snap = sim.snapshot();
      const remaining = snap.bricks.filter((c) => c !== 0 && c !== 13).length;
      return total - remaining;
    });
  }

  function nextRng(): number {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState;
  }

  return {
    get playerCount() {
      return playerCount;
    },
    step(inputs) {
      if (phase === "matchOver") return;
      // Each player's sim steps with their own frame (identical level).
      // roundSim is single-player: remap the session player index to 0 so
      // the sim actually consumes the frame (it filters on player === 0).
      const byPlayer = new Map<number, InputFrame>();
      for (const f of inputs) byPlayer.set(f.player, { ...f, player: 0 });
      for (let i = 0; i < sims.length; i++) {
        const sim = sims[i];
        if (sim) sim.step([byPlayer.get(i) ?? idleFrame(0, tick)]);
      }
      tick++;

      // Round-clear detection: first player to clear wins the round.
      for (let i = 0; i < sims.length; i++) {
        const sim = sims[i];
        if (!sim) continue;
        const snap = sim.snapshot();
        if (snap.phase === "roundClear") {
          awardRound(i);
          return;
        }
        // 0 lives → level resets (fresh layout, lives restored) — cost is time.
        if (snap.players[0]?.lives === 0 && snap.phase === "gameOver") {
          resetField(i);
        }
      }

      // Time cap.
      if (config.timeCapTicks !== null && tick >= config.timeCapTicks) {
        const res = resolveTimeout(config.structure, levelsCleared, bricksThisLevel());
        if (!res.draw) awardRound(res.winner);
        else advanceRound(); // draw: no round point, next level
      }
    },
    snapshots() {
      return sims.map((s) => s.snapshot());
    },
    state(): MatchState {
      return {
        round,
        roundPoints: [...roundPoints],
        levelsCleared: [...levelsCleared],
        bricksThisLevel: bricksThisLevel(),
        matchWinner,
        phase,
      };
    },
    setNextRound(r) {
      round = r;
    },
    debugSetBall(player, x, y, vx, vy) {
      sims[player]?.debugSetBall(x, y, vx, vy);
    },
    simAt(player) {
      return sims[player];
    },
  };

  function awardRound(winner: number): void {
    roundPoints[winner] = (roundPoints[winner] ?? 0) + 1;
    levelsCleared[winner] = (levelsCleared[winner] ?? 0) + 1;
    if (config.structure === "oneOff") {
      matchWinner = winner;
      phase = "matchOver";
      return;
    }
    const needed = Math.ceil(config.bestOf / 2);
    if ((roundPoints[winner] ?? 0) >= needed) {
      matchWinner = winner;
      phase = "matchOver";
      return;
    }
    advanceRound();
  }

  function advanceRound(): void {
    const nextIndex = round + 1;
    round = pickRound(config, nextIndex, nextRng());
    level = getLevel(round);
    sims = makeSims();
  }

  function resetField(i: number): void {
    // 0 lives → current level resets with fresh layout and restored lives.
    const score = sims[i]?.snapshot().players[0]?.score ?? 0;
    sims[i] = createRoundSim(level, { lives: 5, score, playerName: names[i] ?? undefined });
  }
}

function idleFrame(player: number, tick: number): InputFrame {
  return {
    player,
    tick,
    axisX: 0,
    axisY: 0,
    launch: false,
    actions: { cycleForward: false, cycleBack: false, fire: [false, false, false, false] },
  };
}
