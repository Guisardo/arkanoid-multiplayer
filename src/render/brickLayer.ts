// Static brick layer (ADR 0005): one RenderGroup per field, cached as a
// texture. The whole brick wall becomes a single draw call no matter how many
// bricks it holds, and it is re-recorded only when the grid actually changes.
//
// The wall is built from pre-recorded GraphicsContext objects shared by every
// brick of the same variant — six brick tiers × three crack styles = 18
// variants — so refreshing the layer never rebuilds a shape path. Capsule,
// ball and paddle stay outside this layer: they move every frame and their
// object counts are low (ADR 0005 §3).
import { Container, Graphics, GraphicsContext } from "pixi.js";
import {
  BRICK_GOLD,
  cellColoredTier,
  cellSilverHits,
  SILVER_MAX_HITS,
  silverCell,
} from "shared/protocol";
import { BRICK_COLS, BRICK_H, BRICK_ROWS, BRICK_TOP_OFFSET, BRICK_W } from "shared/gridConstants";
import type { BrickSet, FieldTheme } from "content/skinTypes";
import { crackSegments } from "./brickCracks";
import { diffBricks } from "./sceneSync";

/** Colored one-hit brick tiers 1..6 (shared/protocol). */
export const BRICK_TIER_COUNT = 6;

/** Crack overlay styles shipped with the brick sets (spec §13). */
export const CRACK_STYLES = ["hairline", "shatter", "chip"] as const;
export type BrickCrackStyle = (typeof CRACK_STYLES)[number];

/** 6 tiers × 3 crack styles — the pre-recorded tier variants of ADR 0005. */
export const BRICK_CONTEXT_COUNT = BRICK_TIER_COUNT * CRACK_STYLES.length;

/** Silver hit-states: 4 hits remaining (never damaged) down to 1. */
export const SILVER_VARIANT_COUNT = SILVER_MAX_HITS;
/** Silver: not a tier, so its variants live past the tier key space. */
const SILVER_KEY_BASE = BRICK_CONTEXT_COUNT;
/** Gold: indestructible, so it never carries a hit state. */
const GOLD_KEY = SILVER_KEY_BASE + SILVER_VARIANT_COUNT;
/** Cells 7/8 — never authored; keeps the historical white fill. */
const UNCOLORED_KEY = GOLD_KEY + 1;

/** Body geometry in brick-local units (16 × 8 cell, origin top-left). */
const BODY_X = 0.5;
const BODY_Y = 0.5;
const BODY_W = BRICK_W - 1;
const BODY_H = BRICK_H - 1;
/** Crack stroke — the same weight fieldView used before the layer existed. */
const CRACK_WIDTH = 0.5;
const CRACK_COLOR = 0x101018;
/** Fallback fill for tiers a brick set does not define. */
const WHITE = 0xffffff;

/**
 * Variant key for a tier brick: the tier first, then the crack style, so the
 * 18 keys are dense in 0..17.
 */
export function brickContextKey(tier: number, crackStyle: BrickCrackStyle): number {
  return (tier - 1) * CRACK_STYLES.length + CRACK_STYLES.indexOf(crackStyle);
}

/**
 * Variant key for any brick cell. Silver and gold are not tiers (shared/
 * protocol: silver = 8 + hits remaining, gold = 13), so they live past the 18
 * tier variants; silver's key also encodes its damage, because that is what
 * picks the crack overlay. The crack style only steers tier keys here — a
 * brick set ships exactly one style, and the per-set cache below resolves the
 * overlay for it.
 */
export function brickVariantKey(cell: number, crackStyle: BrickCrackStyle): number {
  const tier = cellColoredTier(cell);
  if (tier !== null) return brickContextKey(tier, crackStyle);
  const hits = cellSilverHits(cell);
  if (hits !== null) return SILVER_KEY_BASE + (SILVER_MAX_HITS - hits);
  if (cell === BRICK_GOLD) return GOLD_KEY;
  return UNCOLORED_KEY;
}

/**
 * Context caches, one per (brick set, reduced-effects mode). Two fields on the
 * same theme therefore record each brick variant exactly once for the whole
 * session; the sets are bounded by the shipped themes, so nothing is evicted.
 */
const caches = new Map<string, BrickVariantCache>();

/** Shared brick geometry for a theme. Cheap to call; the result is cached. */
export function brickContextsFor(theme: FieldTheme, reducedEffects: boolean): BrickVariantCache {
  const set = theme.brickSet;
  const key = `${set.id}:${reducedEffects ? "reduced" : "full"}`;
  const hit = caches.get(key);
  if (hit !== undefined) return hit;
  const cache = new BrickVariantCache(set, reducedEffects);
  caches.set(key, cache);
  return cache;
}

/**
 * Drop every recorded context. A live app never needs this — the registry is
 * bounded by the shipped brick sets — but a test that measures the work a fresh
 * field does has to start from an empty one, and a theme hot-reload needs it to
 * pick up edited colors.
 */
export function resetBrickContexts(): void {
  caches.clear();
}

/**
 * Pre-recorded brick geometry for one brick set. Every brick of a variant
 * points at the same GraphicsContext, so the renderer's instruction → GPU
 * geometry conversion happens once per variant instead of once per brick
 * (pixijs-v8-best-practices §9).
 */
export class BrickVariantCache {
  private readonly recorded = new Map<number, GraphicsContext>();
  private readonly set: BrickSet;
  private readonly reducedEffects: boolean;

  constructor(set: BrickSet, reducedEffects: boolean) {
    this.set = set;
    this.reducedEffects = reducedEffects;
  }

  /** Context for one brick cell — tier fill, silver hit-state, or gold. */
  contextForCell(cell: number): GraphicsContext {
    return this.context(brickVariantKey(cell, this.set.crackStyle));
  }

  /** Variants recorded so far — one entry per variant, ever. */
  get recordedCount(): number {
    return this.recorded.size;
  }

  context(key: number): GraphicsContext {
    const hit = this.recorded.get(key);
    if (hit !== undefined) return hit;
    const recorded = this.record(key);
    this.recorded.set(key, recorded);
    return recorded;
  }

  private record(key: number): GraphicsContext {
    const ctx = new GraphicsContext().rect(BODY_X, BODY_Y, BODY_W, BODY_H);
    if (key < BRICK_CONTEXT_COUNT) {
      const tier = Math.floor(key / CRACK_STYLES.length) + 1;
      return ctx.fill(this.set.tierColors[tier] ?? WHITE);
    }
    if (key === GOLD_KEY) return ctx.fill(this.set.goldColor);
    if (key === UNCOLORED_KEY) return ctx.fill(WHITE);
    return this.recordSilver(key, ctx);
  }

  /**
   * Silver hit-state: the set's silver fill, then up to one crack segment per
   * hit taken. Reduced effects (ticket 54) drops the overlay — the hit state
   * stays readable through the silver tint itself.
   */
  private recordSilver(key: number, ctx: GraphicsContext): GraphicsContext {
    ctx.fill(this.set.silverColor);
    if (this.reducedEffects) return ctx;
    const damage = key - SILVER_KEY_BASE;
    const cell = silverCell(SILVER_MAX_HITS - damage);
    for (const seg of crackSegments(cell, this.set.crackStyle)) {
      ctx.moveTo(seg.x1, seg.y1).lineTo(seg.x2, seg.y2).stroke({
        width: CRACK_WIDTH,
        color: CRACK_COLOR,
      });
    }
    return ctx;
  }
}

export interface BrickLayerOptions {
  theme: FieldTheme;
  /** Ticket 54: skip the silver crack overlays entirely. */
  reducedEffects?: boolean;
}

/**
 * One field's brick layer: a RenderGroup cached as a texture, re-recorded only
 * when the brick grid changes. Mount `view` inside the field's transform layer
 * and call `sync()` with the snapshot's brick grid.
 */
export class BrickLayer {
  /** The cached render group — the field's only static sub-layer. */
  readonly view: Container;
  private readonly theme: FieldTheme;
  private reducedEffects: boolean;
  /** Recycled brick Graphics, grown on demand and reused across re-records. */
  private readonly pool: Graphics[] = [];
  private used = 0;
  private grid: readonly number[] | null = null;
  private invalidations = 0;

  constructor(opts: BrickLayerOptions) {
    this.theme = opts.theme;
    this.reducedEffects = opts.reducedEffects ?? false;
    this.view = new Container({ isRenderGroup: true });
    // ADR 0005: the wall is static between brick changes, so it renders once
    // into its own texture and is blitted as one draw call.
    this.view.cacheAsTexture(true);
  }

  /** Bricks currently mounted in the layer. */
  get brickCount(): number {
    return this.used;
  }

  /** Times the cached texture has been re-recorded (invalidation count). */
  get revision(): number {
    return this.invalidations;
  }

  /** Whether the layer is currently cached as a texture. */
  get cached(): boolean {
    return this.view.isCachedAsTexture;
  }

  /** Distinct brick variants this layer has recorded. */
  get variantCount(): number {
    return brickContextsFor(this.theme, this.reducedEffects).recordedCount;
  }

  /** Ticket 54: live reduced-effects toggle — re-records crack-free. */
  setReducedEffects(reduced: boolean): void {
    if (this.reducedEffects === reduced) return;
    this.reducedEffects = reduced;
    this.grid = null;
  }

  /** Toggle texture caching (perf A/B in the field and tests). */
  setCaching(cached: boolean): void {
    this.view.cacheAsTexture(cached);
  }

  /** Drop the cached grid — the next sync() re-records from scratch. */
  reset(): void {
    this.grid = null;
  }

  /**
   * Point the layer at a snapshot brick grid. Re-records only when the grid
   * differs from the one already cached — diff-based, on the same
   * `diffBricks()` the incremental renderer used before ADR 0005.
   */
  sync(bricks: readonly number[]): void {
    if (this.grid !== null && !gridChanged(this.grid, bricks)) return;
    this.rebuild(bricks);
  }

  /**
   * Draw calls the layer costs per frame, modeled on the Pixi v8 batching rule
   * (pixijs-v8-best-practices §3): a container cached as a texture is rendered
   * once into its own texture and blitted as a single batched draw call no
   * matter how many children it holds; uncached, each child Graphics is its
   * own submit. Node has no GPU, so this stands in for
   * `renderer.renderingInfo` — the same trick app/frameStats uses for the live
   * counter.
   */
  get drawCalls(): number {
    return countLayerDrawCalls(this.used, this.cached);
  }

  destroy(): void {
    // Pooled bricks share their GraphicsContext with every other field, so the
    // spares must be torn down without taking the shared geometry with them.
    for (const gfx of this.pool) gfx.destroy({ context: false });
    this.pool.length = 0;
    this.used = 0;
    this.grid = null;
    this.view.destroy({ children: true });
  }

  private rebuild(bricks: readonly number[]): void {
    const cache = brickContextsFor(this.theme, this.reducedEffects);
    const cells = Math.min(bricks.length, BRICK_COLS * BRICK_ROWS);
    let mounted = 0;
    for (let i = 0; i < cells; i++) {
      const cell = bricks[i] ?? 0;
      if (cell === 0) continue;
      const gfx = this.acquire(mounted);
      mounted++;
      // Shared context — the pooled Graphics only carries the placement.
      const context = cache.contextForCell(cell);
      if (gfx.context !== context) gfx.context = context;
      // Cell origin in field units; the body sits at (0.5, 0.5) inside it,
      // which lands exactly where fieldView drew it before the layer existed.
      gfx.position.set(
        (i % BRICK_COLS) * BRICK_W,
        BRICK_TOP_OFFSET + Math.floor(i / BRICK_COLS) * BRICK_H,
      );
    }
    // Spares drop out of the parent list entirely; the instances stay in the
    // pool so brick rain respawns whole rows without allocating a Graphics.
    this.view.removeChildren();
    for (let i = 0; i < mounted; i++) {
      const gfx = this.pool[i];
      if (gfx !== undefined) this.view.addChild(gfx);
    }
    this.used = mounted;
    this.grid = [...bricks];
    this.invalidations++;
    // Mark the cached texture dirty so the next render re-records it.
    this.view.updateCacheTexture();
  }

  /** The nth pooled brick Graphics — grown on demand, reused forever. */
  private acquire(n: number): Graphics {
    let gfx = this.pool[n];
    if (gfx === undefined) {
      gfx = new Graphics();
      this.pool.push(gfx);
    }
    gfx.visible = true;
    return gfx;
  }
}

/** Draw calls for `bricks` children inside a container, cached or not. */
export function countLayerDrawCalls(bricks: number, cachedAsTexture: boolean): number {
  return cachedAsTexture ? 1 : bricks;
}

/** True when any brick cell differs — break, silver hit, or respawn. */
function gridChanged(prev: readonly number[], next: readonly number[]): boolean {
  const diff = diffBricks(prev, next);
  return diff.added.length + diff.removed.length + diff.changed.length > 0;
}
