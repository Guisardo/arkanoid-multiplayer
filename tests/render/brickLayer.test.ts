// ADR 0005 (ticket 92): the brick wall is one cached render group.
//
// Seams under test (agreed before writing):
//  1. Variant key space — 6 tiers × 3 crack styles, dense 0..17 (pure math).
//  2. BrickLayer — one Graphics per occupied cell, every brick of a variant
//     pointing at a shared, pre-recorded GraphicsContext.
//  3. Invalidation — the cached texture is re-recorded only when the brick
//     grid actually changes (diff-based), never on an unrelated frame.
//  4. Draw-call model — the cached layer is a single draw call; uncached, the
//     same wall costs one per brick (proves the reduction comes from caching).
//  5. FieldView wiring — bricks move into the cached layer while the capsule,
//     ball and paddle layers stay dynamic siblings outside it.
//
// Node has no GPU: real Pixi objects run headless (instruction lists only),
// and draw calls are counted with the model below rather than
// `renderer.renderingInfo`.
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  BRICK_CONTEXT_COUNT,
  BRICK_TIER_COUNT,
  BrickLayer,
  CRACK_STYLES,
  brickContextKey,
  countLayerDrawCalls,
  resetBrickContexts,
} from "render/brickLayer";
import { FieldView } from "render/fieldView";
import { layoutField } from "render/layout";
import { DEFAULT_THEME, THEMES } from "content/themes";
import { createRoundSim } from "sim/roundSim";
import { getLevel } from "content/levels";
import {
  BRICK_COLS,
  BRICK_H,
  BRICK_ROWS,
  BRICK_TOP_OFFSET,
  BRICK_W,
} from "shared/gridConstants";
import { SILVER_MAX_HITS } from "shared/protocol";

// The variant registry is module-level and survives a field; a test that counts
// recorded variants has to start from an empty one.
beforeEach(() => {
  resetBrickContexts();
});

/** A full 13×18 grid filled by `fill(cellIndex)`. */
function grid(fill: (i: number) => number): number[] {
  return Array.from({ length: BRICK_COLS * BRICK_ROWS }, (_, i) => fill(i));
}

function occupiedCount(bricks: readonly number[]): number {
  return bricks.filter((c) => c !== 0).length;
}

interface GraphicsContextish {
  instructions: unknown[];
}

/** A brick child's recorded geometry — reached through the scene graph only. */
function contextOf(child: unknown): GraphicsContextish {
  return (child as { context: GraphicsContextish }).context;
}

const layout = layoutField({ x: 0, y: 0, w: 800, h: 600 });

describe("brick variant key space (ADR 0005)", () => {
  it("six tiers × three crack styles fill exactly eighteen contexts", () => {
    expect(BRICK_TIER_COUNT).toBe(6);
    expect(CRACK_STYLES.length).toBe(3);
    expect(BRICK_CONTEXT_COUNT).toBe(18);
  });

  it("every (tier, crack style) pair maps to a unique key 0..17", () => {
    const keys = new Set<number>();
    for (let tier = 1; tier <= BRICK_TIER_COUNT; tier++) {
      for (const style of CRACK_STYLES) keys.add(brickContextKey(tier, style));
    }
    expect(keys.size).toBe(BRICK_CONTEXT_COUNT);
    expect([...keys].sort((a, b) => a - b)).toEqual(
      Array.from({ length: BRICK_CONTEXT_COUNT }, (_, i) => i),
    );
  });

  it("keys the tier before the crack style", () => {
    expect(brickContextKey(1, "hairline")).toBe(0);
    expect(brickContextKey(1, "shatter")).toBe(1);
    expect(brickContextKey(1, "chip")).toBe(2);
    expect(brickContextKey(2, "hairline")).toBe(3);
    expect(brickContextKey(BRICK_TIER_COUNT, "chip")).toBe(BRICK_CONTEXT_COUNT - 1);
  });

  it("the shipped brick sets between them pre-record all eighteen tier variants", () => {
    const used = new Set<number>();
    for (const theme of THEMES) {
      for (let tier = 1; tier <= BRICK_TIER_COUNT; tier++) {
        used.add(brickContextKey(tier, theme.brickSet.crackStyle));
      }
    }
    expect(used.size).toBe(BRICK_CONTEXT_COUNT);
  });
});

describe("BrickLayer — one cached render group per field", () => {
  it("mounts one Graphics per occupied brick, positioned on the brick grid", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    // Every third column, top four rows — a known-by-construction subset.
    const bricks = grid((i) => (i % 3 === 0 && i < BRICK_COLS * 4 ? 2 : 0));
    layer.sync(bricks);

    expect(layer.brickCount).toBe(occupiedCount(bricks));
    expect(layer.view.children.length).toBe(occupiedCount(bricks));

    const expected: Array<{ i: number; x: number; y: number }> = [];
    for (let i = 0; i < bricks.length; i++) {
      if (bricks[i] === 0) continue;
      expected.push({
        i,
        x: (i % BRICK_COLS) * BRICK_W,
        y: BRICK_TOP_OFFSET + Math.floor(i / BRICK_COLS) * BRICK_H,
      });
    }
    expect(expected.length).toBeGreaterThan(3);
    const children = layer.view.children;
    for (let n = 0; n < expected.length; n++) {
      const want = expected[n];
      if (want === undefined) continue;
      const child = children[n];
      expect(child?.x).toBe(want.x);
      expect(child?.y).toBe(want.y);
    }
    layer.destroy();
  });

  it("is a render group, cached as a texture", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    expect(layer.view.isRenderGroup).toBe(true);
    expect(layer.cached).toBe(true);
    layer.destroy();
  });

  it("every brick of a variant points at one shared GraphicsContext", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    // Alternating tiers 2 and 5 — same-variant bricks must share, different
    // variants must not.
    layer.sync(grid((i) => (i % 2 === 0 ? 2 : 5)));

    const [firstTier2, firstTier5, secondTier2] = layer.view.children;
    const tier2 = contextOf(firstTier2);
    const tier5 = contextOf(firstTier5);
    expect(contextOf(secondTier2)).toBe(tier2);
    expect(tier5).not.toBe(tier2);
    // A tier body is a single pre-recorded rect — no per-brick path work.
    expect(tier2.instructions.length).toBe(1);
    layer.destroy();
  });

  it("the pool holds no per-brick geometry of its own", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    layer.sync(grid(() => 2));
    const [brick] = layer.view.children;
    // Pixi gives every `new Graphics()` a private GraphicsContext. A brick that
    // only carries the shared variant geometry must be built *around* that
    // context, or the field allocates one dead geometry (with its own Texture,
    // TextureStyle and Bounds) per brick — 234 of them for a full wall, which
    // is exactly the cost ADR 0005 removes.
    const owned = (brick as unknown as { _ownedContext?: unknown })._ownedContext;
    expect(owned).toBeUndefined();
    layer.destroy();
  });

  it("records each variant once, however many bricks or fields use it", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    // Tiers 1..6, gold, every silver hit-state, and an uncolored cell.
    const everyVariant: number[] = [1, 2, 3, 4, 5, 6, 13, 9, 10, 11, 12, 7];
    layer.sync(grid((i) => everyVariant[i] ?? 0));
    // 6 tiers + 4 silver states + gold + uncolored.
    expect(layer.variantCount).toBe(12);
    expect(layer.brickCount).toBe(occupiedCount(everyVariant));

    // A second field on the same theme records nothing new.
    const other = new BrickLayer({ theme: DEFAULT_THEME });
    other.sync(grid((i) => everyVariant[i] ?? 0));
    expect(other.variantCount).toBe(12);
    layer.destroy();
    other.destroy();
  });

  it("two fields on the same theme share the same pre-recorded contexts", () => {
    const a = new BrickLayer({ theme: DEFAULT_THEME });
    const b = new BrickLayer({ theme: DEFAULT_THEME });
    a.sync(grid(() => 3));
    b.sync(grid(() => 3));
    expect(contextOf(a.view.children[0])).toBe(contextOf(b.view.children[0]));
    a.destroy();
    b.destroy();
  });

  it("the same theme under different reduced-effects modes records different contexts", () => {
    const full = new BrickLayer({ theme: DEFAULT_THEME });
    const reduced = new BrickLayer({ theme: DEFAULT_THEME, reducedEffects: true });
    const bricks = grid((i) => (i === 0 ? 9 : 0)); // silver, 1 hit taken of 4
    full.sync(bricks);
    reduced.sync(bricks);

    const fullCtx = contextOf(full.view.children[0]);
    const reducedCtx = contextOf(reduced.view.children[0]);
    expect(fullCtx).not.toBe(reducedCtx);
    expect(fullCtx.instructions.length).toBe(1 + 3); // body + 3 crack segments
    expect(reducedCtx.instructions.length).toBe(1); // body only (ticket 54)
    full.destroy();
    reduced.destroy();
  });

  it("gold and silver bricks get their own variants, never a tier context", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    // tier 2, gold, silver with 3 hits taken (cell 9), silver untouched (12).
    layer.sync(grid((i) => (i === 0 ? 2 : i === 1 ? 13 : i === 2 ? 9 : i === 3 ? 12 : 0)));
    const [tier, gold, damaged, pristine] = layer.view.children;
    const tierCtx = contextOf(tier);
    const goldCtx = contextOf(gold);
    const damagedCtx = contextOf(damaged);
    const pristineCtx = contextOf(pristine);

    expect(goldCtx).not.toBe(tierCtx);
    expect(damagedCtx).not.toBe(tierCtx);
    expect(damagedCtx).not.toBe(pristineCtx);
    expect(goldCtx.instructions.length).toBe(1); // body only — gold is unbreakable
    expect(pristineCtx.instructions.length).toBe(1); // no damage → no cracks
    expect(damagedCtx.instructions.length).toBe(4); // body + 3 crack segments
    expect(SILVER_MAX_HITS).toBe(4); // the silver hit-states above are all of them
    layer.destroy();
  });

  it("re-records only when the brick grid changes", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    const bricks = grid((i) => (i < 26 ? 1 : i < 50 ? 9 : 0));
    layer.sync(bricks);
    expect(layer.revision).toBe(1);

    layer.sync(bricks); // identical grid → cached texture untouched
    layer.sync(bricks);
    expect(layer.revision).toBe(1);

    const broken = [...bricks];
    broken[0] = 0; // brick break
    layer.sync(broken);
    expect(layer.revision).toBe(2);

    const silverHit = [...broken];
    silverHit[30] = 10; // silver brick lost a hit → new crack state
    layer.sync(silverHit);
    expect(layer.revision).toBe(3);

    layer.sync(silverHit);
    expect(layer.revision).toBe(3);
    layer.destroy();
  });

  it("marks the cached texture stale on a re-record, never on a static frame", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    // The layer's own signal that the cached texture is stale is Pixi's
    // `updateCacheTexture()`. `revision` only counts rebuilds; this asserts the
    // renderer is actually told to re-record — without it the cached wall would
    // freeze on screen while the scene graph changed underneath it.
    const invalidate = vi.spyOn(layer.view, "updateCacheTexture");

    layer.sync(grid(() => 1));
    expect(invalidate).toHaveBeenCalledTimes(1);

    layer.sync(grid(() => 1)); // static frame — texture stays valid
    layer.sync(grid(() => 1));
    expect(invalidate).toHaveBeenCalledTimes(1);

    layer.sync(grid((i) => (i === 3 ? 0 : 1))); // a brick broke
    expect(invalidate).toHaveBeenCalledTimes(2);
    invalidate.mockRestore();
    layer.destroy();
  });

  it("reset forces a full re-record (context restore / rejoin)", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    const bricks = grid(() => 4);
    layer.sync(bricks);
    layer.sync(bricks);
    expect(layer.revision).toBe(1);
    layer.reset();
    layer.sync(bricks);
    expect(layer.revision).toBe(2);
    layer.destroy();
  });

  it("reuses pooled Graphics across re-records (brick rain respawns whole rows)", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    const full = grid(() => 2);
    layer.sync(full);
    const original = new Set(layer.view.children);
    const thinned = full.map((c, i) => (i % 5 === 0 ? 0 : c));
    layer.sync(thinned);
    const after = layer.view.children;
    expect(layer.brickCount).toBe(occupiedCount(thinned));
    expect(after.length).toBe(occupiedCount(thinned));
    // Surviving bricks keep their instance — no per-invalidation allocation.
    for (const child of after) expect(original.has(child)).toBe(true);
    layer.sync(full);
    expect(layer.view.children.length).toBe(occupiedCount(full));
    for (const child of layer.view.children) expect(original.has(child)).toBe(true);
    layer.destroy();
  });
});

describe("brick layer draw-call model (acceptance: 1 draw call)", () => {
  it("a full 234-brick wall inside the cached layer is a single draw call", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    layer.sync(grid(() => 2));
    expect(layer.brickCount).toBe(BRICK_COLS * BRICK_ROWS);
    expect(layer.cached).toBe(true);
    expect(layer.drawCalls).toBe(1);
    expect(countLayerDrawCalls(layer.brickCount, layer.cached)).toBe(1);
    layer.destroy();
  });

  it("uncached, the same wall costs one draw call per brick", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    layer.sync(grid(() => 2));
    layer.setCaching(false);
    expect(layer.cached).toBe(false);
    expect(layer.drawCalls).toBe(BRICK_COLS * BRICK_ROWS);
    layer.setCaching(true);
    expect(layer.drawCalls).toBe(1);
    layer.destroy();
  });

  it("four split-screen fields stay inside the frame budget", () => {
    const layers = [0, 1, 2, 3].map(() => new BrickLayer({ theme: DEFAULT_THEME }));
    for (const layer of layers) layer.sync(grid(() => 5));
    const total = layers.reduce((sum, l) => sum + l.drawCalls, 0);
    expect(total).toBe(4);
    for (const layer of layers) layer.destroy();
  });
});

describe("FieldView wiring (ticket 92)", () => {
  function internals(view: FieldView): {
    brickLayer: BrickLayer;
    capsuleGfx: unknown;
    paddleGfx: unknown;
    ballGfx: unknown;
    shakeLayer: { children: unknown[] };
  } {
    return view as unknown as ReturnType<typeof internals>;
  }

  it("renders bricks inside the cached layer, capsules/ball/paddle stay dynamic", () => {
    const view = new FieldView({ layout, player: 0, locale: "en-US", maxRound: 33 });
    const snap = createRoundSim(getLevel(1), { lives: 3, score: 0 }).snapshot();
    view.sync(snap);

    const inner = internals(view);
    expect(inner.brickLayer.cached).toBe(true);
    expect(inner.brickLayer.view.isRenderGroup).toBe(true);
    expect(inner.brickLayer.brickCount).toBe(occupiedCount(snap.bricks));

    // The dynamic layers are siblings of the brick layer, never its children.
    for (const dynamic of [inner.capsuleGfx, inner.paddleGfx, inner.ballGfx]) {
      expect(inner.brickLayer.view.children).not.toContain(dynamic as never);
    }
    const siblings = inner.shakeLayer.children;
    expect(siblings).toContain(inner.brickLayer.view);
    expect(siblings).toContain(inner.capsuleGfx);
    expect(siblings).toContain(inner.paddleGfx);
    // Bricks draw under every dynamic layer.
    expect(siblings.indexOf(inner.brickLayer.view)).toBe(0);

    // The whole brick wall still costs one draw call on a live field.
    expect(inner.brickLayer.drawCalls).toBe(1);
    view.container.destroy({ children: true });
  });

  it("an unchanged frame does not re-record the cached brick layer", () => {
    const view = new FieldView({ layout, player: 0, locale: "en-US", maxRound: 33 });
    const sim = createRoundSim(getLevel(1), { lives: 3, score: 0 });
    view.sync(sim.snapshot());
    const inner = internals(view);
    const revision = inner.brickLayer.revision;
    view.sync(sim.snapshot());
    view.sync(sim.snapshot());
    expect(inner.brickLayer.revision).toBe(revision);
    view.container.destroy({ children: true });
  });

  it("a broken brick re-records the layer exactly once", () => {
    const view = new FieldView({ layout, player: 0, locale: "en-US", maxRound: 33 });
    const sim = createRoundSim(getLevel(1), { lives: 3, score: 0 });
    const base = sim.snapshot();
    view.sync(base);
    const inner = internals(view);
    const revision = inner.brickLayer.revision;
    // Clear three cells the round actually starts with bricks in.
    const breakable = base.bricks
      .map((cell, i) => (cell !== 0 ? i : -1))
      .filter((i) => i >= 0)
      .slice(0, 3);
    const cleared = new Set(breakable);
    const broken = { ...base, bricks: base.bricks.map((c, i) => (cleared.has(i) ? 0 : c)) };
    expect(cleared.size).toBe(3);
    view.sync(broken);
    // A later frame with the same bricks must not re-record.
    view.sync({ ...broken, balls: [{ ...base.balls[0]!, x: 40, y: 40 }] });
    expect(inner.brickLayer.revision).toBe(revision + 1);
    view.container.destroy({ children: true });
  });

  it("invalidate re-records the layer after a context restore", () => {
    const view = new FieldView({ layout, player: 0, locale: "en-US", maxRound: 33 });
    const sim = createRoundSim(getLevel(1), { lives: 3, score: 0 });
    const snap = sim.snapshot();
    view.sync(snap);
    const inner = internals(view);
    const revision = inner.brickLayer.revision;
    view.invalidate();
    view.sync(snap);
    expect(inner.brickLayer.revision).toBe(revision + 1);
    view.container.destroy({ children: true });
  });

  it("setReducedEffects re-records without the crack overlays", () => {
    const view = new FieldView({ layout, player: 0, locale: "en-US", maxRound: 33 });
    const sim = createRoundSim(getLevel(1), { lives: 3, score: 0 });
    const snap = {
      ...sim.snapshot(),
      bricks: sim.snapshot().bricks.map((c, i) => (i < 6 ? 9 : c)),
    };
    view.sync(snap);
    const inner = internals(view);
    const fullRevision = inner.brickLayer.revision;
    view.setReducedEffects(true);
    view.sync(snap);
    expect(inner.brickLayer.revision).toBeGreaterThan(fullRevision);
    view.container.destroy({ children: true });
  });
});
