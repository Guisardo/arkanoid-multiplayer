// Parallel assist coop (ticket 40, spec §6.4): 2–4 players on separate
// fields, shared score, per-player lives (5). Downed at 0 lives: field
// frozen, spectates, no meter income; life gift is the only revival
// (revive = 1 life, ball attached, owner launches). Assist meter (same
// fill rules as attack, spec §6.5): power-up gift 20, brick clear 30
// (8 lowest bricks), life gift 40. Downed players keep spend rights
// (gift/clear, not self-life); early clearers spectate with full gift
// rights incl. life gift. Team wins when the last player clears the
// range end; loses when all downed simultaneously. No ball-speed
// scaling. Headless, deterministic (seeded LCG only).
import { createRoundSim, type RoundSim } from "./roundSim";
import { cycleTarget, meterFill, resolveFireTarget } from "./attack";
import { getLevel } from "content/levels";
import {
  EMPTY_ACTIONS,
  isDestructibleCell,
  type InputFrame,
  type Snapshot,
} from "shared/protocol";
import type { LevelData } from "content/levelFormat";

/** Assist spend costs (of meterMax 100) — prototype-validated (spec §6.4). */
export const ASSIST_COSTS = { gift: 20, clear: 30, life: 40 } as const;
/** Assist fire-button order: 3 assist buttons (gift/clear/life). */
export const ASSIST_FIRE_ORDER = ["gift", "clear", "life"] as const;
export type AssistActionId = (typeof ASSIST_FIRE_ORDER)[number];

export interface AssistTuning {
  /** Meter cost per assist action (of meterMax). */
  costs: Readonly<Record<AssistActionId, number>>;
  /** Brick clear removes this many of the target's lowest bricks. */
  clearBrickCount: number;
  /** Meter fill: 2 per brick break, 10 per capsule catch (spec §6.5). */
  fillPerBrick: number;
  fillPerCapsule: number;
  /** Meter cap. */
  meterMax: number;
}

export const DEFAULT_ASSIST_TUNING: AssistTuning = {
  costs: { gift: 20, clear: 30, life: 40 },
  clearBrickCount: 8,
  fillPerBrick: 2,
  fillPerCapsule: 10,
  meterMax: 100,
};

export interface AssistSessionOptions {
  playerCount: number;
  /** First round of the lobby-chosen level range. */
  startRound: number;
  /** Last round of the range (inclusive); team win at its clear. */
  endRound: number;
  playerNames?: string[] | undefined;
  /** Compact per-session skin indices, one per player (ticket 44). */
  skinIndices?: readonly number[] | undefined;
  seed?: number | undefined;
  tuning?: AssistTuning | undefined;
}

export interface AssistSession {
  readonly playerCount: number;
  step(inputs: InputFrame[]): void;
  snapshots(): Snapshot[];
  /** Team state: shared score, round, outcome. */
  state(): AssistMatchState;
  /** Composition seam: player i's underlying round sim. */
  simAt(player: number): RoundSim | undefined;
  /** Test hook: place a player's ball. */
  debugSetBall(player: number, x: number, y: number, vx: number, vy: number): void;
  /** Test hook: force meter value for a player. */
  debugSetMeter(player: number, value: number): void;
  /** Test hook: force a player's target. */
  debugSetTarget(player: number, target: number): void;
  /** Test hook: force a player downed (skip the 5-drop grind). */
  debugSetDowned(player: number): void;
}

export interface AssistMatchState {
  round: number;
  /** Shared team score (sum across live fields). */
  teamScore: number;
  /** "playing" | "won" (range cleared) | "lost" (all downed). */
  phase: "playing" | "won" | "lost";
}

/**
 * Parallel assist session: N independent RoundSims, one shared score.
 * Downed fields freeze (sim.step skipped) and spectate; their players
 * keep gift/clear spend rights but earn no meter income. Level advance
 * is team-wide: when every live field clears the current round, all
 * live fields move to the next round in the range (downed fields stay
 * on their frozen field until revived).
 */
export function createAssistSession(opts: AssistSessionOptions): AssistSession {
  const { playerCount, startRound, endRound } = opts;
  const tuning = opts.tuning ?? DEFAULT_ASSIST_TUNING;
  const names =
    opts.playerNames ?? Array.from({ length: playerCount }, (_, i) => `Player ${String(i + 1)}`);
  const skinIndices = opts.skinIndices ?? [];

  let round = startRound;
  let level: LevelData = getLevel(round);
  let phase: AssistMatchState["phase"] = "playing";
  let tick = 0;

  const sims: RoundSim[] = Array.from({ length: playerCount }, (_, i) =>
    createRoundSim(level, {
      lives: 5,
      score: 0,
      playerName: names[i] ?? undefined,
      skinIndex: skinIndices[i] ?? 0,
    }),
  );
  const meters = new Array<number>(playerCount).fill(0);
  const targets = new Array<number>(playerCount).fill(-1);
  const downed = new Array<boolean>(playerCount).fill(false);
  /** Last event tick read per player (new-event bookkeeping). */
  const lastEventTick = new Array<number>(playerCount).fill(-1);
  /** Assist events emitted this tick (merged into snapshots). */
  let pendingEvents: Array<{ source: number; target: number }> = [];

  function teamScore(): number {
    let sum = 0;
    for (let i = 0; i < playerCount; i++) {
      if (downed[i]) continue;
      sum += sims[i]?.snapshot().players[0]?.score ?? 0;
    }
    return sum;
  }

  function anyAlive(): boolean {
    return downed.some((d) => !d);
  }

  /** Spend one assist action at a target. Returns true when it fired. */
  function fireAssist(player: number, action: AssistActionId, target: number): boolean {
    const sim = sims[target];
    if (!sim) return false;
    if (action === "gift") {
      const type = sims[player]?.lastCaughtCapsule() ?? null;
      if (type === null) return false; // nothing captured to send
      sim.giftCapsule(type);
    } else if (action === "clear") {
      sim.clearLowestBricks(tuning.clearBrickCount);
    } else {
      if (target === player) return false; // no self life gift
      if (!downed[target]) return false; // life gift only revives
      sim.revivePlayer();
      downed[target] = false;
      lastEventTick[target] = -1; // fresh sim: re-arm event reader
    }
    meters[player] = (meters[player] ?? 0) - tuning.costs[action];
    pendingEvents.push({ source: player, target });
    return true;
  }

  /** Apply cycle-target buttons from this step's input frames. */
  function processTargetCycles(inputs: readonly InputFrame[]): void {
    for (const f of inputs) {
      const p = f.player;
      if (p < 0 || p >= playerCount) continue;
      if (f.actions.cycleForward) targets[p] = cycleTarget(p, targets[p] ?? -1, playerCount, true);
      if (f.actions.cycleBack) targets[p] = cycleTarget(p, targets[p] ?? -1, playerCount, false);
    }
  }

  /** Assist buttons: 3 fire buttons (gift/clear/life) at the picked target. */
  function processAssistButtons(inputs: readonly InputFrame[]): void {
    for (const f of inputs) {
      const p = f.player;
      if (p < 0 || p >= playerCount) continue;
      for (let b = 0; b < ASSIST_FIRE_ORDER.length; b++) {
        const action = ASSIST_FIRE_ORDER[b];
        if (!action) continue;
        if (f.actions.fire[b] !== true) continue;
        if ((meters[p] ?? 0) < tuning.costs[action]) continue;
        // resolveFireTarget walks teammates only (excludes self) — downed
        // teammates are valid targets (life gift revives, gift/clear land).
        const tgt = resolveFireTarget(p, targets[p] ?? -1, playerCount, () => true);
        if (tgt === -1) continue;
        fireAssist(p, action, tgt);
      }
    }
  }

  /** Read new events on live fields: meter income (2/brick + 10/capsule). */
  function processFieldIncome(p: number, snap: Snapshot): void {
    if (downed[p]) return; // no meter income while downed
    let bricks = 0;
    let capsules = 0;
    for (const e of snap.events) {
      if (e.tick < (lastEventTick[p] ?? -1)) continue;
      if (e.type === "brickBreak") bricks++;
      else if (e.type === "capsuleCatch") capsules++;
    }
    lastEventTick[p] = snap.tick;
    if (bricks > 0 || capsules > 0) {
      meters[p] = meterFill(
        meters[p] ?? 0,
        bricks,
        capsules,
        tuning.fillPerBrick,
        tuning.fillPerCapsule,
        tuning.meterMax,
      );
    }
  }

  /** Downed detection: 0 lives on a live field → downed (frozen). */
  function processDowned(p: number, snap: Snapshot): void {
    if (downed[p]) return;
    if (snap.players[0]?.lives === 0 && snap.phase === "gameOver") {
      downed[p] = true;
    }
  }

  /** Team level advance: every live field cleared → next round for all
   * live fields. Range end cleared → team win. */
  function processTeamAdvance(snapshots: readonly Snapshot[]): void {
    const liveIndices: number[] = [];
    for (let i = 0; i < playerCount; i++) if (!downed[i]) liveIndices.push(i);
    if (liveIndices.length === 0) return;
    const allCleared = liveIndices.every((i) => snapshots[i]?.phase === "roundClear");
    if (!allCleared) return;
    if (round >= endRound) {
      phase = "won";
      return;
    }
    round++;
    level = getLevel(round);
    for (const i of liveIndices) {
      const score = sims[i]?.snapshot().players[0]?.score ?? 0;
      sims[i] = createRoundSim(level, {
        lives: 5,
        score,
        playerName: names[i] ?? undefined,
        skinIndex: skinIndices[i] ?? 0,
      });
      lastEventTick[i] = -1;
    }
  }

  return {
    get playerCount() {
      return playerCount;
    },
    step(inputs) {
      if (phase !== "playing") return;
      pendingEvents = [];
      processTargetCycles(inputs);
      processAssistButtons(inputs);

      // Each live player's sim steps with their own frame (player index
      // remapped to 0 — roundSim consumes player === 0 only). Downed
      // fields freeze: no step, no state change.
      const byPlayer = new Map<number, InputFrame>();
      for (const f of inputs) byPlayer.set(f.player, { ...f, player: 0 });
      for (let i = 0; i < playerCount; i++) {
        if (downed[i]) continue;
        sims[i]?.step([byPlayer.get(i) ?? idleFrame(0, tick)]);
      }
      tick++;

      const snapshots = sims.map((s) => s.snapshot());
      for (let p = 0; p < playerCount; p++) {
        const snap = snapshots[p];
        if (snap) processDowned(p, snap);
      }
      if (!anyAlive()) {
        phase = "lost";
        return;
      }
      for (let p = 0; p < playerCount; p++) {
        const snap = snapshots[p];
        if (snap) processFieldIncome(p, snap);
      }
      processTeamAdvance(snapshots);
    },
    snapshots() {
      const score = teamScore();
      return sims.map((sim, p) => {
        const snap = sim.snapshot();
        const player = snap.players[0];
        if (!player) return snap;
        const events = [
          ...snap.events,
          ...pendingEvents.map((pe) => ({
            type: "assist" as const,
            source: pe.source,
            target: pe.target,
            tick: snap.tick,
          })),
        ];
        return {
          ...snap,
          players: [
            {
              ...player,
              score, // shared team score on every strip
              meter: meters[p] ?? 0,
              target: targets[p] ?? -1,
              state: downed[p] ? ("downed" as const) : ("playing" as const),
            },
          ],
          events,
        };
      });
    },
    state(): AssistMatchState {
      return { round, teamScore: teamScore(), phase };
    },
    simAt(player) {
      return sims[player];
    },
    debugSetBall(player, x, y, vx, vy) {
      sims[player]?.debugSetBall(x, y, vx, vy);
    },
    debugSetMeter(player, value) {
      meters[player] = value;
    },
    debugSetTarget(player, target) {
      targets[player] = target;
    },
    debugSetDowned(player) {
      downed[player] = true;
    },
  };
}

function idleFrame(player: number, tick: number): InputFrame {
  return {
    player,
    tick,
    axisX: 0,
    axisY: 0,
    launch: false,
    actions: EMPTY_ACTIONS,
  };
}

/** Count destructible cells in a snapshot brick grid (test helper). */
export function countDestructible(bricks: readonly number[]): number {
  let n = 0;
  for (const c of bricks) if (isDestructibleCell(c)) n++;
  return n;
}
