// Score / event pops (ADR 0009, audit §4.7).
//
// A pool of `BitmapText` nodes that rise and fade. Pooled for the same reason
// the particles are: pops fire on every brick break, and allocating `BitmapText`
// mid-match is exactly the kind of GC hitch the perf ladder exists to avoid.
//
// Node construction is guarded (`installGameFont` no-ops without a DOM), so in
// node tests the manager still tracks pop *state* — headless tests assert what
// would have been shown, which is the actual contract.

import { BitmapText, Container } from "pixi.js";
import { GAME_FONT_NAME } from "./gameFont";
import type { PopRecipe } from "./effectPresets";

/** Pops in flight per field. Three rounds of overlapping pops is plenty. */
export const POP_POOL = 8;

/** How long a pop takes to rise and fade. */
const POP_RISE_SECONDS = 0.9;

export interface LivePop {
  x: number;
  y: number;
  text: string;
  color: number;
  size: number;
  remaining: number;
  duration: number;
  /** Rising distance in field units. */
  rise: number;
  node: BitmapText | null;
}

export class ScorePopManager {
  private readonly layer = new Container();
  private readonly pool: LivePop[] = [];
  private readonly live: LivePop[] = [];

  constructor() {
    for (let i = 0; i < POP_POOL; i++) this.pool.push(makeSlot());
  }

  get view(): Container {
    return this.layer;
  }

  get activeCount(): number {
    return this.live.length;
  }

  /** Text currently rising, newest last. Headless tests read this. */
  get activePops(): readonly LivePop[] {
    return this.live;
  }

  get pooledCount(): number {
    return this.pool.length;
  }

  /**
   * Spawn a pop. Pool exhaustion recycles the oldest entry rather than
   * dropping — a missed "+50" is less bad than a missed "-1 LIFE".
   */
  spawn(at: { x: number; y: number }, recipe: PopRecipe): void {
    const slot = this.pool.pop() ?? this.recycleOldest();
    if (slot === undefined) return;
    slot.x = at.x;
    slot.y = at.y;
    slot.text = recipe.text;
    slot.color = recipe.color;
    slot.size = recipe.size;
    slot.duration = POP_RISE_SECONDS;
    slot.remaining = POP_RISE_SECONDS;
    slot.rise = 14;
    this.applyNode(slot, 1);
    this.live.push(slot);
  }

  /** Advance rise + fade. `frozen` holds them (hit-stop). */
  update(dt: number, frozen: boolean): void {
    if (frozen) return;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const pop = this.live[i];
      if (pop === undefined) continue;
      pop.remaining -= dt;
      if (pop.remaining <= 0) {
        this.retire(i);
        continue;
      }
      this.applyNode(pop, pop.remaining / pop.duration);
    }
  }

  /** Write rise/fade onto the BitmapText node. */
  private applyNode(pop: LivePop, t: number): void {
    if (pop.node === null) return;
    pop.node.text = pop.text;
    pop.node.tint = pop.color;
    pop.node.alpha = t < 0.4 ? t / 0.4 : 1;
    pop.node.x = pop.x;
    pop.node.y = pop.y - pop.rise * (1 - t);
    pop.node.scale.set(pop.size);
  }

  private recycleOldest(): LivePop | undefined {
    if (this.live.length === 0) return undefined;
    this.retire(0);
    return this.pool.pop();
  }

  private retire(index: number): void {
    const pop = this.live[index];
    if (pop === undefined) return;
    const last = this.live.length - 1;
    const tail = this.live[last];
    if (index !== last && tail !== undefined) this.live[index] = tail;
    this.live.pop();
    if (pop.node !== null) {
      pop.node.text = "";
      pop.node.alpha = 0;
    }
    this.pool.push(pop);
  }

  /** Clear every pop (context restore, toggle, teardown). */
  reset(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.retire(i);
  }

  destroy(): void {
    this.reset();
    for (const pop of this.pool) {
      pop.node?.destroy();
      pop.node = null;
    }
    this.pool.length = 0;
    this.layer.destroy({ children: true });
  }
}

function makeSlot(): LivePop {
  let node: BitmapText | null = null;
  if (typeof document !== "undefined") {
    node = new BitmapText({
      text: "",
      style: { fontFamily: GAME_FONT_NAME, fontSize: 8 },
    });
    node.anchor.set(0.5, 0.5);
    node.alpha = 0;
  }
  return {
    x: 0,
    y: 0,
    text: "",
    color: 0xffffff,
    size: 1,
    remaining: 0,
    duration: 1,
    rise: 14,
    node,
  };
}
