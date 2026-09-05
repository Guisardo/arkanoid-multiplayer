// Versus bots mode (ticket 51, spec §6.2/§7): every multiplayer variant
// playable solo — exactly 1 human + N bots, never bots alongside >1 human.
// Bots are host-local input sources through the same pipeline (D = 0, net
// idle). Trimmed config: variant picker + match structure + difficulty
// selector (session-wide, default Normal). Pause freely (coop semantics).
// Pure composition — the variant sims stay the source of truth.
import { createBot, type BotDifficulty, type BotSource } from "sim/bot";
import { createRoundDuel, type DuelSim, type DuelOptions } from "sim/duel";
import {
  createMultiFieldSession,
  type MatchConfig,
  type MultiFieldSession,
} from "sim/multiField";
import { createAttackSession, type AttackSession } from "sim/attackSession";
import {
  createAssistSession,
  type AssistSession,
  type AssistSessionOptions,
} from "sim/assistSession";
import { createSharedFieldSim, type SharedFieldSim, type SharedFieldOptions } from "sim/sharedField";
import { getLevel } from "content/levels";
import type { InputFrame, Snapshot } from "shared/protocol";

export type BotVariant =
  | "race"
  | "attack"
  | "duel"
  | "sharedField"
  | "parallelAssist";

/** Bot counts per variant (ticket 51): Race/Attack 1–3, Duel 1, coop 1–3. */
export function botCountFor(variant: BotVariant): { min: number; max: number } {
  switch (variant) {
    case "duel":
      return { min: 1, max: 1 };
    case "race":
    case "attack":
    case "sharedField":
    case "parallelAssist":
      return { min: 1, max: 3 };
  }
}

/** Validate a versus-bots setup: exactly 1 human, bot count in range. */
export function validateBotsSetup(variant: BotVariant, humans: number, bots: number): string | null {
  if (humans !== 1) return "exactly one human";
  const { min, max } = botCountFor(variant);
  if (bots < min || bots > max) return `bots ${String(min)}–${String(max)}`;
  return null;
}

export interface VersusBotsOptions {
  variant: BotVariant;
  /** Always 1 (enforced); kept explicit for the trimmed-config seam. */
  humans: number;
  bots: number;
  /** Session-wide difficulty (default Normal). */
  difficulty?: BotDifficulty;
  /** Race/Attack match structure. */
  matchConfig?: MatchConfig;
  /** Duel ball model. */
  duelBallModel?: DuelOptions["ballModel"];
  /** Shared-field placement/ball model. */
  sharedField?: Pick<SharedFieldOptions, "placement" | "ballModel">;
  /** Assist range. */
  assistRange?: Pick<AssistSessionOptions, "startRound" | "endRound">;
  playerNames?: string[];
  seed?: number;
}

export interface VersusBotsSession {
  readonly variant: BotVariant;
  readonly playerCount: number;
  /** Human player index (always 0). */
  readonly humanPlayer: number;
  /** Advance one tick: human frame + bot frames (D = 0, host-local). */
  step(humanFrame: InputFrame): void;
  /** Snapshot(s) for rendering: one per player for parallel variants, one otherwise. */
  snapshots(): Snapshot[];
  /** Pause freely (coop semantics) — every variant. */
  pause(): void;
  resume(): void;
  isPaused(): boolean;
}

export function createVersusBotsSession(opts: VersusBotsOptions): VersusBotsSession {
  const err = validateBotsSetup(opts.variant, opts.humans, opts.bots);
  if (err !== null) throw new Error(`invalid versus-bots setup: ${err}`);
  const difficulty: BotDifficulty = opts.difficulty ?? "normal";
  const seed = opts.seed ?? 1;
  const names =
    opts.playerNames ?? ["You", ...Array.from({ length: opts.bots }, (_, i) => `Bot ${String(i + 1)}`)];
  const total = 1 + opts.bots;

  // Bots: host-local input sources, one per bot player index.
  const bots: BotSource[] = [];
  for (let i = 1; i < total; i++) {
    bots.push(createBot(i, difficulty, seed + i * 7919));
  }

  let paused = false;

  function botFrames(tick: number, snaps: Snapshot[]): InputFrame[] {
    const out: InputFrame[] = [];
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      if (!bot) continue;
      const snap = snaps[Math.min(i + 1, snaps.length - 1)] ?? snaps[0];
      if (snap) out.push(bot.sampleFrame(tick, snap));
    }
    return out;
  }

  if (opts.variant === "duel") {
    const sim: DuelSim = createRoundDuel(getLevel(1), {
      ballModel: opts.duelBallModel ?? "shared",
      timeCapTicks: null,
      playerNames: [names[0] ?? "You", names[1] ?? "Bot 1"],
    });
    return {
      variant: "duel",
      playerCount: 2,
      humanPlayer: 0,
      step(humanFrame) {
        if (paused) return;
        const snap = sim.snapshot();
        const botFrame = bots[0]?.sampleFrame(sim.currentTick, snap);
        sim.step([humanFrame, ...(botFrame ? [botFrame] : [])]);
      },
      snapshots() {
        return [sim.snapshot()];
      },
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
      },
      isPaused: () => paused,
    };
  }

  if (opts.variant === "sharedField") {
    const sim: SharedFieldSim = createSharedFieldSim(getLevel(1), {
      placement: opts.sharedField?.placement ?? "A",
      ballModel: opts.sharedField?.ballModel ?? "shared",
      playerCount: total as 2 | 3 | 4,
      playerNames: names.slice(0, total),
    });
    return {
      variant: "sharedField",
      playerCount: total,
      humanPlayer: 0,
      step(humanFrame) {
        if (paused) return;
        const snap = sim.snapshot();
        const frames = [humanFrame, ...botFrames(sim.currentTick, [snap])];
        sim.step(frames);
      },
      snapshots() {
        return [sim.snapshot()];
      },
      pause: () => {
        paused = true;
        sim.requestPause(0);
      },
      resume: () => {
        paused = false;
        sim.requestResume(0);
      },
      isPaused: () => paused || sim.isPaused(),
    };
  }

  if (opts.variant === "parallelAssist") {
    const range = opts.assistRange ?? { startRound: 1, endRound: 33 };
    const sim: AssistSession = createAssistSession({
      playerCount: total,
      startRound: range.startRound,
      endRound: range.endRound,
      playerNames: names.slice(0, total),
      seed,
    });
    return {
      variant: "parallelAssist",
      playerCount: total,
      humanPlayer: 0,
      step(humanFrame) {
        if (paused) return;
        const snaps = sim.snapshots();
        sim.step([humanFrame, ...botFrames(sim.snapshots()[0]?.tick ?? 0, snaps)]);
      },
      snapshots() {
        return sim.snapshots();
      },
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
      },
      isPaused: () => paused,
    };
  }

  // race + attack: multi-field seam.
  const config: MatchConfig = opts.matchConfig ?? {
    structure: "oneOff",
    bestOf: 1,
    levelSelection: "hostPick",
    hostPickRound: 1,
    timeCapTicks: null,
  };
  if (opts.variant === "attack") {
    const sim: AttackSession = createAttackSession({
      playerCount: total,
      config,
      playerNames: names.slice(0, total),
      seed,
    });
    return {
      variant: "attack",
      playerCount: total,
      humanPlayer: 0,
      step(humanFrame) {
        if (paused) return;
        const snaps = sim.snapshots();
        sim.step([humanFrame, ...botFrames(snaps[0]?.tick ?? 0, snaps)]);
      },
      snapshots() {
        return sim.snapshots();
      },
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
      },
      isPaused: () => paused,
    };
  }

  const sim: MultiFieldSession = createMultiFieldSession({
    playerCount: total,
    config,
    playerNames: names.slice(0, total),
    seed,
  });
  return {
    variant: "race",
    playerCount: total,
    humanPlayer: 0,
    step(humanFrame) {
      if (paused) return;
      const snaps = sim.snapshots();
      sim.step([humanFrame, ...botFrames(snaps[0]?.tick ?? 0, snaps)]);
    },
    snapshots() {
      return sim.snapshots();
    },
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
    },
    isPaused: () => paused,
  };
}
