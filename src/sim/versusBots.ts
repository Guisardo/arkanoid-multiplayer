// Versus bots mode (ticket 51, spec §6.2/§7): every multiplayer variant
// playable solo — exactly 1 human + N bots, never bots alongside >1 human.
// Bots are host-local input sources through the same pipeline (D = 0, net
// idle). Trimmed config: variant picker + match structure + difficulty
// selector (session-wide, default Normal). Pause freely (coop semantics).
// Pure composition — the variant sims stay the source of truth.
import { createBot, type BotDifficulty, type BotSource } from "sim/bot";
import type { DuelSim, DuelOptions, DuelMatchResult } from "sim/duel";
import type {
  MatchConfig,
  MatchState,
  MultiFieldSession,
} from "sim/multiField";
import type { AttackSession } from "sim/attackSession";
import type { AssistSession, AssistSessionOptions, AssistMatchState } from "sim/assistSession";
import type { SharedFieldSim, SharedFieldOptions } from "sim/sharedField";
import {
  ATTACK_MAX_ROUND,
  MAX_ROUND,
  MIN_ROUND,
  getLevelSync,
  preloadLevels,
  roundRange,
} from "content/levels";
import { DEFAULT_SKIN_ID } from "content/skins";
import { assignSkinIndices, autoAssignBotSkins } from "content/skinSync";
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
  /** Human's skin UUID (ticket 44); bots auto-assign distinct non-colliding skins. */
  humanSkinId?: string | undefined;
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
  /** Match-over signal (ticket 56): drives the end screen. */
  over(): boolean;
  /** End-screen data once over (ticket 56); null before. */
  endData(): VersusBotsEnd | null;
  /** Per-player skin UUIDs, player-index aligned (ticket 56 render). */
  skinIds(): string[];
  /** Test hook (assist): force a player downed — drives the lost path. */
  debugSetDowned(player: number): void;
}

/** End-screen payload per variant family (ticket 56). */
export type VersusBotsEnd =
  | { kind: "race"; state: MatchState }
  | { kind: "attack"; state: MatchState }
  | { kind: "duel"; result: DuelMatchResult }
  | { kind: "sharedField"; cleared: boolean; round: number; teamScore: number }
  | { kind: "assist"; state: AssistMatchState };

/**
 * Rounds a variant can reach (ADR 0007): Duel and shared field play the fixed
 * round-1 layout, parallel assist walks the team's range, race/attack walk
 * their selection range (attack stops at 32 — Doh is never selected).
 */
function roundsForVariant(
  variant: BotVariant,
  assistRange: { startRound: number; endRound: number },
  config: MatchConfig,
): number[] {
  if (variant === "duel" || variant === "sharedField") return [1];
  if (variant === "parallelAssist") return roundRange(assistRange.startRound, assistRange.endRound);
  return roundRange(MIN_ROUND, variant === "attack" ? ATTACK_MAX_ROUND : (config.maxRound ?? MAX_ROUND));
}

export async function createVersusBotsSession(opts: VersusBotsOptions): Promise<VersusBotsSession> {
  const err = validateBotsSetup(opts.variant, opts.humans, opts.bots);
  if (err !== null) throw new Error(`invalid versus-bots setup: ${err}`);
  const difficulty: BotDifficulty = opts.difficulty ?? "normal";
  const seed = opts.seed ?? 1;
  const names =
    opts.playerNames ?? ["You", ...Array.from({ length: opts.bots }, (_, i) => `Bot ${String(i + 1)}`)];
  const total = 1 + opts.bots;

  // Skins (ticket 44): human's choice first, bots auto-assigned distinct
  // skins that never collide with it; UUIDs → compact session indices.
  const humanSkinId = opts.humanSkinId ?? DEFAULT_SKIN_ID;
  const botSkinIds = autoAssignBotSkins([humanSkinId], opts.bots);
  const allSkinIds = [humanSkinId, ...botSkinIds];
  const skinIndices = assignSkinIndices(allSkinIds).indices;

  // Bots: host-local input sources, one per bot. Parallel variants
  // (race/attack/assist) give each bot a field-local snapshot (player 0 —
  // multiField sims are per-field single-player), so those bots are
  // created with player 0 and their frames remapped to the session index
  // for routing (multiField routes by f.player). Single-field variants
  // (duel/sharedField) keep real session indices 1..N end to end.
  const parallel =
    opts.variant === "race" || opts.variant === "attack" || opts.variant === "parallelAssist";
  const bots: BotSource[] = [];
  for (let i = 1; i < total; i++) {
    const player = parallel ? 0 : i;
    bots.push(createBot(player, difficulty, seed + i * 7919));
  }

  let paused = false;

  function botFrames(tick: number, snaps: Snapshot[]): InputFrame[] {
    const out: InputFrame[] = [];
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      if (!bot) continue;
      const snap = snaps[Math.min(i + 1, snaps.length - 1)] ?? snaps[0];
      if (!snap) continue;
      const frame = bot.sampleFrame(tick, snap);
      // Field-local bot → its frame rides the session player index.
      out.push(parallel ? { ...frame, player: i + 1 } : frame);
    }
    return out;
  }

  // ADR 0007: round data for the variant's range is fetched before the
  // variant sim is built, so the variant sims (and their mid-match round
  // advance) read rounds synchronously out of the cache.
  const assistRange = opts.assistRange ?? { startRound: 1, endRound: 33 };
  const matchConfig: MatchConfig = opts.matchConfig ?? {
    structure: "oneOff",
    bestOf: 1,
    levelSelection: "hostPick",
    hostPickRound: 1,
    timeCapTicks: null,
  };
  await preloadLevels(roundsForVariant(opts.variant, assistRange, matchConfig));

  if (opts.variant === "duel") {
    const { createRoundDuel } = await import("sim/duel");
    const sim: DuelSim = createRoundDuel(getLevelSync(1), {
      ballModel: opts.duelBallModel ?? "shared",
      timeCapTicks: null,
      playerNames: [names[0] ?? "You", names[1] ?? "Bot 1"],
      skinIndices: [skinIndices[0] ?? 0, skinIndices[1] ?? 1],
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
      over: () => sim.getMatchResult() !== null,
      endData: () => {
        const result = sim.getMatchResult();
        return result === null ? null : { kind: "duel", result };
      },
      skinIds: () => allSkinIds.slice(0, 2),
      debugSetDowned: () => undefined,
    };
  }

  if (opts.variant === "sharedField") {
    const { createSharedFieldSim } = await import("sim/sharedField");
    const sim: SharedFieldSim = createSharedFieldSim(getLevelSync(1), {
      placement: opts.sharedField?.placement ?? "A",
      ballModel: opts.sharedField?.ballModel ?? "shared",
      playerCount: total as 2 | 3 | 4,
      playerNames: names.slice(0, total),
      skinIndices,
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
      over: () => sim.snapshot().phase === "roundClear" && sim.getTeamState().round >= 33,
      endData: () => {
        if (!(sim.snapshot().phase === "roundClear" && sim.getTeamState().round >= 33)) return null;
        const team = sim.getTeamState();
        return {
          kind: "sharedField",
          cleared: true,
          round: team.round,
          teamScore: team.score,
        };
      },
      skinIds: () => allSkinIds.slice(0, total),
      debugSetDowned: () => undefined,
    };
  }

  if (opts.variant === "parallelAssist") {
    const { createAssistSession } = await import("sim/assistSession");
    const sim: AssistSession = createAssistSession({
      playerCount: total,
      startRound: assistRange.startRound,
      endRound: assistRange.endRound,
      playerNames: names.slice(0, total),
      skinIndices,
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
      over: () => sim.state().phase !== "playing",
      endData: () => (sim.state().phase === "playing" ? null : { kind: "assist", state: sim.state() }),
      skinIds: () => allSkinIds.slice(0, total),
      debugSetDowned: (player: number) => { sim.debugSetDowned(player); },
    };
  }

  // race + attack: multi-field seam (ADR 0007: imported on demand).
  if (opts.variant === "attack") {
    const { createAttackSession } = await import("sim/attackSession");
    const sim: AttackSession = createAttackSession({
      playerCount: total,
      config: matchConfig,
      playerNames: names.slice(0, total),
      skinIndices,
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
      over: () => sim.race().state().phase === "matchOver",
      endData: () =>
        sim.race().state().phase === "matchOver" ? { kind: "attack", state: sim.race().state() } : null,
      skinIds: () => allSkinIds.slice(0, total),
      debugSetDowned: () => undefined,
    };
  }

  const { createMultiFieldSession } = await import("sim/multiField");
  const sim: MultiFieldSession = createMultiFieldSession({
    playerCount: total,
    config: matchConfig,
    playerNames: names.slice(0, total),
    skinIndices,
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
    over: () => sim.state().phase === "matchOver",
    endData: () => (sim.state().phase === "matchOver" ? { kind: "race", state: sim.state() } : null),
    skinIds: () => allSkinIds.slice(0, total),
    debugSetDowned: () => undefined,
  };
}
