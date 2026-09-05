// Attack mode (ticket 39): Race with interference, composed on the
// multi-field session seam (ticket 34). This module owns the attack
// economy — triggers, meter, effects, targeting — and drives the
// underlying Race session. Headless, deterministic (seeded LCG only).
import {
  ALL_TRIGGERS_ON,
  ATTACK_FIRE_ORDER,
  DEFAULT_ATTACK_TUNING,
  NO_ATTACK_EFFECTS,
  applyAttackEffect,
  canSpend,
  chainTier,
  corruptAxis,
  cycleTarget,
  meterAdd,
  resolveFireTarget,
  tickAttackEffects,
  type ActiveAttackEffects,
  type AttackEffectId,
  type AttackTriggerToggles,
  type AttackTuning,
} from "./attack";
import { createMultiFieldSession, type MatchConfig, type MultiFieldSession } from "./multiField";
import { ATTACK_MAX_ROUND } from "content/levels";
import { isDestructibleCell, type InputFrame, type Snapshot } from "shared/protocol";

const TICK_MS = 1000 / 60;

export interface AttackSessionOptions {
  playerCount: number;
  config: MatchConfig;
  playerNames?: string[] | undefined;
  seed?: number | undefined;
  /** Compact per-session skin indices, one per player (ticket 44). */
  skinIndices?: readonly number[] | undefined;
  /** Lobby toggles — all-on default. */
  triggers?: AttackTriggerToggles | undefined;
  /** Live-tunable economy values. */
  tuning?: AttackTuning | undefined;
}

export interface AttackSession {
  readonly playerCount: number;
  /** Advance one sim tick with all players' input frames. */
  step(inputs: InputFrame[]): void;
  /** Snapshot per player (attack state merged in). */
  snapshots(): Snapshot[];
  /** Underlying Race match state. */
  race(): MultiFieldSession;
  /** Test hook: place a player's ball. */
  debugSetBall(player: number, x: number, y: number, vx: number, vy: number): void;
  /** Test hook: force meter value for a player. */
  debugSetMeter(player: number, value: number): void;
  /** Test hook: force a player's target. */
  debugSetTarget(player: number, target: number): void;
}

/** Per-field event summary for one step (meter income + chain signals). */
interface FieldEvents {
  bricks: number;
  capsules: number;
  paddleTouch: boolean;
}

/**
 * Attack mode session: wraps the Race multi-field session. Per tick it
 * (1) processes target-cycle buttons, (2) corrupts mangled players'
 * consumed axes, (3) steps the race, (4) reads per-field events to fill
 * meters / track chains / fire triggers, (5) processes manual fire
 * buttons, (6) ticks effect timers and re-applies field factors.
 *
 * Deviations from ticket text (documented):
 * - Manual brick rain uses the medium count (6) — prototype-validated
 *   behavior (prototype fireAction rains 6).
 * - Level-clear trigger fires on any round award in continuous structure
 *   (clear or timeout win) — the roundClear event is lost when the race
 *   session replaces sims on advance; levelsCleared delta is the seam.
 * - Mid-level-reset immunity lasts until the next round advance.
 */
export function createAttackSession(opts: AttackSessionOptions): AttackSession {
  const { playerCount } = opts;
  const triggers = opts.triggers ?? ALL_TRIGGERS_ON;
  const tuning = opts.tuning ?? DEFAULT_ATTACK_TUNING;

  const raceOpts: {
    playerCount: number;
    config: MatchConfig;
    playerNames?: string[] | undefined;
    skinIndices?: readonly number[] | undefined;
    seed?: number | undefined;
  } = { playerCount, config: { ...opts.config, maxRound: ATTACK_MAX_ROUND } };
  if (opts.playerNames !== undefined) raceOpts.playerNames = opts.playerNames;
  if (opts.skinIndices !== undefined) raceOpts.skinIndices = opts.skinIndices;
  if (opts.seed !== undefined) raceOpts.seed = opts.seed;
  const race = createMultiFieldSession(raceOpts);

  // ---- Per-player attack state ----
  const meters = new Array<number>(playerCount).fill(0);
  const targets = new Array<number>(playerCount).fill(-1);
  const chains = new Array<number>(playerCount).fill(0);
  const effects = Array.from({ length: playerCount }, () => NO_ATTACK_EFFECTS);
  /** Mid-level-reset immunity (0-lives field reset) — until next round advance. */
  const immune = new Array<boolean>(playerCount).fill(false);
  /** Last-processed event tick per player, to read only new events. */
  const lastEventTick = new Array<number>(playerCount).fill(-1);
  /** Whether a player had any active effect last step (expiry re-apply). */
  const prevActive = new Array<boolean>(playerCount).fill(false);
  /** Last-seen levels cleared per player (level-clear trigger signal). */
  const prevLevelsCleared = new Array<number>(playerCount).fill(0);
  let lastRound = race.state().round;
  /** Attack events emitted this tick (merged into snapshots). */
  let pendingEvents: Array<{ source: number; target: number }> = [];

  let rngState = (opts.seed ?? 1) >>> 0;
  function nextRng(): number {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 0x100000000; // [0,1)
  }

  /** A valid fire target: an opponent who is not mid-level-reset immune. */
  function isValidTarget(player: number, candidate: number): boolean {
    return candidate !== player && !(immune[candidate] ?? false);
  }

  /** Push current shrink/speed factors into the target's field sim. */
  function applyEffectToField(target: number): void {
    const sim = race.simAt(target);
    if (!sim) return;
    const fx = effects[target] ?? NO_ATTACK_EFFECTS;
    sim.setAttackWidthFactor(fx.shrinkMs > 0 ? tuning.shrinkFactor : 1);
    sim.setAttackSpeedFactor(fx.speedMs > 0 ? tuning.speedFactor : 1);
  }

  /** Fire one attack at a target: apply effect or rain bricks. */
  function fireAttack(source: number, effect: AttackEffectId, target: number, rainCount: number): void {
    if (effect === "rain") {
      race.simAt(target)?.resurrectBricks(rainCount);
    } else {
      const duration =
        effect === "shrink" ? tuning.shrinkMs : effect === "speed" ? tuning.speedMs : tuning.mangleMs;
      effects[target] = applyAttackEffect(effects[target] ?? NO_ATTACK_EFFECTS, effect, duration);
      applyEffectToField(target);
    }
    pendingEvents.push({ source, target });
  }

  /** Auto-fire rain at the player's (auto-retargeted) target. */
  function autoFireRain(player: number, rainCount: number): void {
    const tgt = resolveFireTarget(player, targets[player] ?? -1, playerCount, (c) =>
      isValidTarget(player, c),
    );
    if (tgt !== -1) fireAttack(player, "rain", tgt, rainCount);
  }

  /** Tick every active effect timer by one step (timers decay at step start). */
  function tickAllEffectTimers(): void {
    for (let p = 0; p < playerCount; p++) {
      const fx = effects[p] ?? NO_ATTACK_EFFECTS;
      if (fx.shrinkMs > 0 || fx.speedMs > 0 || fx.mangleMs > 0) {
        effects[p] = tickAttackEffects(fx, TICK_MS);
      }
    }
  }

  /** Apply target-cycle buttons from this step's input frames. */
  function processTargetCycles(inputs: readonly InputFrame[]): void {
    for (const f of inputs) {
      const p = f.player;
      if (p < 0 || p >= playerCount) continue;
      if (f.actions.cycleForward) targets[p] = cycleTarget(p, targets[p] ?? -1, playerCount, true);
      if (f.actions.cycleBack) targets[p] = cycleTarget(p, targets[p] ?? -1, playerCount, false);
    }
  }

  /** Corrupt mangled players' consumed axes (sim-side, spec §6.5) — hits
   * every input method equally since it's past the input seam. */
  function corruptMangledInputs(inputs: readonly InputFrame[]): InputFrame[] {
    return inputs.map((f) => {
      const fx = effects[f.player] ?? NO_ATTACK_EFFECTS;
      if (fx.mangleMs <= 0) return f;
      return { ...f, axisX: corruptAxis(f.axisX, nextRng()) };
    });
  }

  /** Round advance: clear immunity, re-arm event readers (new sims). */
  function onRoundAdvance(state: ReturnType<MultiFieldSession["state"]>): void {
    if (state.round === lastRound) return;
    lastRound = state.round;
    for (let p = 0; p < playerCount; p++) {
      immune[p] = false;
      lastEventTick[p] = -1;
    }
  }

  /** Summarize one player's new events this step (meter + chain signals). */
  function readFieldEvents(p: number, snap: Snapshot): FieldEvents {
    // Tick regression on this field = mid-level reset (0 lives → fresh
    // sim): the player is immune until the next round advance.
    if (snap.tick < (lastEventTick[p] ?? -1)) {
      lastEventTick[p] = -1;
      immune[p] = true;
    }
    const out: FieldEvents = { bricks: 0, capsules: 0, paddleTouch: false };
    // Event-tick bookkeeping: events pushed during a step carry the sim's
    // pre-increment tick, which equals the PREVIOUS snapshot's tick — so
    // process e.tick >= lastEventTick (strict < skips).
    for (const e of snap.events) {
      if (e.tick < (lastEventTick[p] ?? -1)) continue;
      if (e.type === "brickBreak") out.bricks++;
      else if (e.type === "capsuleCatch") out.capsules++;
      else if (e.type === "paddleBounce") out.paddleTouch = true;
    }
    lastEventTick[p] = snap.tick;
    return out;
  }

  /** Meter fill + chain tracking + chain/capsule triggers for one player. */
  function processFieldIncome(p: number, ev: FieldEvents): void {
    // Meter fill: 2 per brick + 10 per capsule catch (spec §6.5).
    if (ev.bricks > 0 || ev.capsules > 0) {
      meters[p] = meterAdd(meters[p] ?? 0, ev.bricks, ev.capsules, tuning);
    }
    // Chain: consecutive bricks without paddle touch; reset on touch.
    if (ev.paddleTouch) {
      chains[p] = 0;
    } else if (ev.bricks > 0) {
      const before = chains[p] ?? 0;
      chains[p] = before + ev.bricks;
      if (triggers.chains) {
        const tier = chainTier(chains[p] ?? 0, tuning);
        const beforeTier = chainTier(before, tuning);
        if (tier !== null && tier !== beforeTier) {
          autoFireRain(p, tuning.rainBricks[tier]);
        }
      }
    }
    // Capsule-capture trigger: small attack per catch.
    if (ev.capsules > 0 && triggers.capsuleCapture) {
      autoFireRain(p, tuning.rainBricks.small);
    }
  }

  /** Level-clear trigger: continuous structure only, on levelsCleared delta. */
  function processLevelClears(state: ReturnType<MultiFieldSession["state"]>): void {
    const active = triggers.levelClear && opts.config.structure === "continuous";
    for (let p = 0; p < playerCount; p++) {
      const now = state.levelsCleared[p] ?? 0;
      if (active && now > (prevLevelsCleared[p] ?? 0)) {
        prevLevelsCleared[p] = now;
        autoFireRain(p, tuning.rainBricks.small);
      } else {
        prevLevelsCleared[p] = now;
      }
    }
  }

  /** Manual fire buttons (charged-manual trigger): 4 attack buttons, each
   * fires a different attack type at the picked target. */
  function processManualFires(inputs: readonly InputFrame[]): void {
    if (!triggers.chargedManual) return;
    for (const f of inputs) {
      const p = f.player;
      if (p < 0 || p >= playerCount) continue;
      for (let b = 0; b < ATTACK_FIRE_ORDER.length; b++) {
        const effect = ATTACK_FIRE_ORDER[b];
        if (!effect) continue;
        if (f.actions.fire[b] !== true) continue;
        if (!canSpend(meters[p] ?? 0, effect, tuning)) continue;
        const tgt = resolveFireTarget(p, targets[p] ?? -1, playerCount, (c) =>
          isValidTarget(p, c),
        );
        if (tgt === -1) continue;
        meters[p] = (meters[p] ?? 0) - tuning.costs[effect];
        const rainCount = tuning.rainBricks.medium; // prototype: manual rain = 6
        fireAttack(p, effect, tgt, rainCount);
      }
    }
  }

  /** Re-apply field factors after any fires this step (timers ticked at
   * step start). Runs on expiry transitions too: the sim keeps the last
   * factor until told otherwise. */
  function reapplyFieldFactors(): void {
    for (let p = 0; p < playerCount; p++) {
      const fx = effects[p] ?? NO_ATTACK_EFFECTS;
      const prev = prevActive[p] ?? false;
      const active = fx.shrinkMs > 0 || fx.speedMs > 0 || fx.mangleMs > 0;
      if (active || prev) applyEffectToField(p);
      prevActive[p] = active;
    }
  }

  return {
    get playerCount() {
      return playerCount;
    },
    step(inputs) {
      if (race.state().phase === "matchOver") return;
      pendingEvents = [];
      tickAllEffectTimers();
      processTargetCycles(inputs);
      race.step(corruptMangledInputs(inputs));
      const state = race.state();
      onRoundAdvance(state);
      const snaps = race.snapshots();
      for (let p = 0; p < playerCount; p++) {
        const snap = snaps[p];
        if (!snap) continue;
        processFieldIncome(p, readFieldEvents(p, snap));
      }
      processLevelClears(state);
      processManualFires(inputs);
      reapplyFieldFactors();
    },
    snapshots() {
      const snaps = race.snapshots();
      return snaps.map((snap, p) => {
        const player = snap.players[0];
        if (!player) return snap;
        const fx: ActiveAttackEffects = effects[p] ?? NO_ATTACK_EFFECTS;
        const events = [
          ...snap.events,
          ...pendingEvents.map((pe) => ({
            type: "attack" as const,
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
              meter: meters[p] ?? 0,
              target: targets[p] ?? -1,
              chain: chains[p] ?? 0,
              effects: {
                ...player.effects,
                attackShrinkMs: fx.shrinkMs,
                attackSpeedMs: fx.speedMs,
                attackMangleMs: fx.mangleMs,
              },
            },
          ],
          events,
        };
      });
    },
    race() {
      return race;
    },
    debugSetBall(player, x, y, vx, vy) {
      race.debugSetBall(player, x, y, vx, vy);
    },
    debugSetMeter(player, value) {
      meters[player] = value;
    },
    debugSetTarget(player, target) {
      targets[player] = target;
    },
  };
}

/** Count destructible cells in a snapshot brick grid (test helper). */
export function countDestructible(bricks: readonly number[]): number {
  let n = 0;
  for (const c of bricks) if (isDestructibleCell(c)) n++;
  return n;
}
