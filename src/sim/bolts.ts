// Laser Bolts (ticket #142, spec #140): the one pooled, pure Bolt module that
// `roundSim`, `sharedField` and `duel` each drive. It owns Bolt motion, the
// tip sweep against the brick grid, the per-Paddle cap and fire cooldown, and
// the boss hit counter. Everything a sim scores or announces stays behind the
// injected hooks, so each sim keeps its own `hitBrick` (events, score,
// capsule-script counter, `roundClear`) and no Bolt logic is duplicated.
//
// Pure and deterministic: no DOM/Pixi/network, no RNG, and no allocation per
// tick once the pool is warm (ADR 0006).
import {
  BOLT_HITS_PER_BOSS_HP,
  BOLT_SPEED,
  BOLT_W,
  BRICK_COLS,
  BRICK_H,
  BRICK_ROWS,
  BRICK_TOP_OFFSET,
  BRICK_W,
  POOL_PREWARM,
  TICK_DT,
} from "./constants";
import type { Box } from "./collision";
import { Pool } from "./pool";
import {
  BRICK_EMPTY,
  BRICK_GOLD,
  LASER_BOLTS_PER_PADDLE,
  SNAPSHOT_PLAYERS_MAX,
  laserBoltXs,
  type BoltSnapshot,
} from "shared/protocol";

import { LASER_COOLDOWN_TICKS } from "shared/simRates";

/** Shared, frozen snapshot for an empty field. */
const NO_BOLTS: readonly BoltSnapshot[] = Object.freeze([]);

/** Units a Bolt climbs per tick (4 at 240 u/s, 60 Hz). */
export const BOLT_STEP = BOLT_SPEED * TICK_DT;

/**
 * A Bolt in flight. `x` is the centre column, `y` the tip (top edge); the box
 * runs `BOLT_H` down from the tip. `paddle` keys the cap and cooldown,
 * `owner` takes the credit: they differ only when several players share one
 * Paddle (Shared Field mode C).
 */
export interface BoltState {
  x: number;
  y: number;
  paddle: number;
  owner: number;
  /** Spawned this tick: holds still until the next `step` (spec tick order). */
  fresh: boolean;
}

/** All-zero Bolt: the canonical starting shape for `Pool.acquire`. */
export function makeBoltState(): BoltState {
  return { x: 0, y: 0, paddle: 0, owner: 0, fresh: false };
}

/** Clear every Bolt field (ADR 0006 reset contract). */
export function resetBoltState(b: BoltState): void {
  b.x = 0;
  b.y = 0;
  b.paddle = 0;
  b.owner = 0;
  b.fresh = false;
}

/** What a sim lends the module. Cell values follow `shared/protocol`. */
export interface BoltHooks {
  /** Brick cell value at a grid index (`BRICK_EMPTY` when empty). */
  cellAt(index: number): number;
  /** The sim's own brick hit (normal break or silver hit), credited to `shooter`. */
  hitBrick(index: number, shooter: number): void;
  /** A Bolt was spent on a gold Brick (no damage; feedback only). */
  goldHit(index: number, shooter: number): void;
  /** The live boss box this tick, or null when there is no live boss. */
  bossBox(): Box | null;
  /** The boss loses 1 HP: called only on every `BOLT_HITS_PER_BOSS_HP`th Bolt. */
  hitBoss(shooter: number): void;
}

/** Grid row containing a y coordinate (may be off-grid). */
function rowOf(y: number): number {
  return Math.floor((y - BRICK_TOP_OFFSET) / BRICK_H);
}

/** Bottom edge of a grid row: where an upward tip enters it. */
function rowBottom(row: number): number {
  return BRICK_TOP_OFFSET + (row + 1) * BRICK_H;
}

/** Y at which an upward tip starting at `fromY` enters the cell `index`. */
function brickEntryY(index: number, fromY: number): number {
  return Math.min(fromY, rowBottom(Math.floor(index / BRICK_COLS)));
}

export class Bolts {
  /** Per-Paddle flights, each in spawn order (left before right, older first). */
  private readonly flights: BoltState[][];
  private readonly cooldowns: number[];
  private readonly pool: Pool<BoltState>;
  private readonly hooks: BoltHooks;
  private bossHitCount = 0;

  /**
   * @param paddleCount Paddles that may fire; sizes the pool prewarm
   *   (`LASER_BOLTS_PER_PADDLE` each, capped at `POOL_PREWARM.bolts`).
   */
  constructor(paddleCount: number, hooks: BoltHooks) {
    if (!Number.isInteger(paddleCount) || paddleCount < 1 || paddleCount > SNAPSHOT_PLAYERS_MAX) {
      throw new RangeError(
        `Bolts.constructor: paddleCount must be an integer in 1..${String(SNAPSHOT_PLAYERS_MAX)} (paddleCount=${String(paddleCount)})`,
      );
    }
    this.hooks = hooks;
    this.flights = Array.from({ length: paddleCount }, () => []);
    this.cooldowns = new Array<number>(paddleCount).fill(0);
    this.pool = new Pool(makeBoltState, resetBoltState);
    this.pool.prewarm(Math.min(POOL_PREWARM.bolts, paddleCount * LASER_BOLTS_PER_PADDLE));
  }

  /**
   * Fire one volley (2 Bolts) from a Paddle if its cooldown has elapsed and
   * the volley fits under the per-Paddle cap. A volley over the cap is
   * dropped and does not consume the cooldown, so the next tick may fire.
   * `box` is the live Paddle box (centre x/y, full w/h).
   * @returns whether the volley fired.
   */
  tryFire(paddle: number, owner: number, box: Box): boolean {
    const flight = this.flightOf(paddle, "tryFire");
    if ((this.cooldowns[paddle] ?? 0) > 0) return false;
    if (flight.length + 2 > LASER_BOLTS_PER_PADDLE) return false;
    const tip = box.y - box.h / 2;
    const [left, right] = laserBoltXs(box.x, box.w);
    this.spawn(flight, left, tip, paddle, owner);
    this.spawn(flight, right, tip, paddle, owner);
    this.cooldowns[paddle] = LASER_COOLDOWN_TICKS;
    return true;
  }

  /** Ticks until the Paddle may fire again (0 = ready). */
  cooldown(paddle: number): number {
    this.flightOf(paddle, "cooldown");
    return this.cooldowns[paddle] ?? 0;
  }

  /** Ready the Paddle to fire at once (a Laser catch). */
  resetCooldown(paddle: number): void {
    this.flightOf(paddle, "resetCooldown");
    this.cooldowns[paddle] = 0;
  }

  /**
   * Advance one tick: cooldowns count down, then every Bolt fired before
   * this tick climbs `BOLT_STEP` in order (Paddle index ascending, then spawn order) and
   * resolves against the live grid, so a Brick broken by an earlier Bolt this
   * tick lets a later one fly on. A Bolt is consumed by the first non-empty
   * cell (or the boss box) its tip enters, and removed once its tip passes
   * the top wall.
   */
  step(): void {
    for (let p = 0; p < this.cooldowns.length; p++) {
      const c = this.cooldowns[p] ?? 0;
      if (c > 0) this.cooldowns[p] = c - 1;
    }
    for (const flight of this.flights) {
      let keep = 0;
      for (let i = 0; i < flight.length; i++) {
        const b = flight[i];
        if (b === undefined) continue;
        if (b.fresh) {
          // Fired this tick (fire runs before the Bolt step): first move next tick.
          b.fresh = false;
          flight[keep++] = b;
        } else if (this.advance(b)) {
          flight[keep++] = b;
        } else {
          this.pool.release(b);
        }
      }
      flight.length = keep;
    }
  }

  /** Remove every Bolt and ready every Paddle (last ball lost, round end, revive). */
  clear(): void {
    for (let p = 0; p < this.flights.length; p++) this.clearPaddle(p);
  }

  /** Remove one Paddle's Bolts and ready it. */
  clearPaddle(paddle: number): void {
    const flight = this.flightOf(paddle, "clearPaddle");
    for (const b of flight) this.pool.release(b);
    flight.length = 0;
    this.cooldowns[paddle] = 0;
  }

  /** Restart the boss counter (round start). */
  resetBossHits(): void {
    this.bossHitCount = 0;
  }

  /** Bolt hits on the boss since the last HP it lost (0..3). */
  get bossHits(): number {
    return this.bossHitCount;
  }

  /** Bolts in flight, all Paddles. */
  get count(): number {
    let n = 0;
    for (const f of this.flights) n += f.length;
    return n;
  }

  /** Bolts in flight for one Paddle. */
  countFor(paddle: number): number {
    return this.flightOf(paddle, "countFor").length;
  }

  /** Bolts the pool can hand out without allocating (observability). */
  get pooled(): number {
    return this.pool.available;
  }

  /**
   * Snapshot rows in step order (Paddle ascending, then spawn order). A copy,
   * because sessions keep snapshots (interpolation buffers) while the pooled
   * Bolts move on; with nothing in flight (most ticks) it allocates nothing.
   */
  toSnapshot(): readonly BoltSnapshot[] {
    if (this.count === 0) return NO_BOLTS;
    const out: BoltSnapshot[] = [];
    for (const flight of this.flights) {
      for (const b of flight) out.push({ x: b.x, y: b.y, owner: b.owner });
    }
    return out;
  }

  private flightOf(paddle: number, method: string): BoltState[] {
    const flight = this.flights[paddle];
    if (flight === undefined) {
      throw new RangeError(
        `Bolts.${method}: paddle out of range (paddle=${String(paddle)}, paddleCount=${String(this.flights.length)})`,
      );
    }
    return flight;
  }

  private spawn(flight: BoltState[], x: number, y: number, paddle: number, owner: number): void {
    const b = this.pool.acquire();
    b.x = x;
    b.y = y;
    b.paddle = paddle;
    b.owner = owner;
    b.fresh = true;
    flight.push(b);
  }

  /** Move one Bolt; returns false when it is spent or off the field. */
  private advance(b: BoltState): boolean {
    const prevY = b.y;
    b.y = prevY - BOLT_STEP;
    const brick = this.firstBrick(b.x, prevY, b.y);
    const bossEntry = this.bossEntry(b.x, prevY, b.y);
    // Whichever the tip reaches first (the larger entry y) takes the Bolt; a
    // tie goes to the Brick, which sits in front of the boss face.
    if (brick >= 0 && (bossEntry === null || brickEntryY(brick, prevY) >= bossEntry)) {
      if (this.hooks.cellAt(brick) === BRICK_GOLD) this.hooks.goldHit(brick, b.owner);
      else this.hooks.hitBrick(brick, b.owner);
      return false;
    }
    if (bossEntry !== null) {
      this.bossHitCount++;
      if (this.bossHitCount >= BOLT_HITS_PER_BOSS_HP) {
        this.bossHitCount = 0;
        this.hooks.hitBoss(b.owner);
      }
      return false;
    }
    return b.y >= 0;
  }

  /**
   * First non-empty cell the tip enters sweeping up from `fromY` to `toY` in
   * the Bolt's column, or -1. Rows are checked bottom-up, so the sweep never
   * tunnels whatever the step length.
   */
  private firstBrick(x: number, fromY: number, toY: number): number {
    const col = Math.floor(x / BRICK_W);
    if (col < 0 || col >= BRICK_COLS) return -1;
    const lowest = Math.min(rowOf(fromY), BRICK_ROWS - 1);
    const highest = Math.max(rowOf(toY), 0);
    for (let row = lowest; row >= highest; row--) {
      const index = row * BRICK_COLS + col;
      if (this.hooks.cellAt(index) !== BRICK_EMPTY) return index;
    }
    return -1;
  }

  /** Y at which the tip enters the live boss box this step, or null if it misses. */
  private bossEntry(x: number, fromY: number, toY: number): number | null {
    const box = this.hooks.bossBox();
    if (box === null) return null;
    if (Math.abs(x - box.x) > (box.w + BOLT_W) / 2) return null;
    const top = box.y - box.h / 2;
    const bottom = box.y + box.h / 2;
    if (toY > bottom || fromY < top) return null;
    return Math.min(fromY, bottom);
  }
}
