// Laser feedback (ticket #148, spec #140 Variant C: quiet and readable),
// built against snapshot fixtures: thin yellow Bolts, two ready-ticks over an
// Armed Paddle's ends while the host reports it off cooldown (`laserReady`), a ~0.12 s white flash plus a score
// pop on a Bolt's Brick hit (no shake, particles or full-field flash, and it
// survives reduced effects), nothing visual on gold.
import { describe, expect, it } from "vitest";
import { FieldView } from "render/fieldView";
import { layoutField } from "render/layout";
import { VisualEffects, type VisualEffectsScene } from "render/visualEffects";
import { BRICK_FLASH_SECONDS } from "render/brickFlash";
import { LASER_COLOR, laserShapes } from "render/laserView";
import { type PlayerSnapshot, type SimEvent, type Snapshot } from "shared/protocol";

function player(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    player: 0,
    name: "P1",
    skinIndex: 0,
    paddle: { x: 104, y: 242, w: 32, h: 6, edge: "bottom" },
    lives: 3,
    score: 0,
    meter: 0,
    target: -1,
    chain: 0,
    state: "playing",
    effects: {},
    ...over,
  };
}

function snapWith(over: Partial<Snapshot> = {}): Snapshot {
  return {
    tick: 100,
    round: 1,
    phase: "play",
    bricks: new Array<number>(13 * 18).fill(1),
    capsules: [],
    balls: [{ x: 104, y: 200, vx: 0, vy: -1, attachedTo: null, owner: 0 }],
    players: [player()],
    events: [],
    inputAcks: [0],
    ...over,
  };
}

const ev = (type: SimEvent["type"], target = -1, tick = 100, source = 0): SimEvent => ({ type, source, target, tick });

/** Headless scene: records brick-flash rects the orchestrator paints. */
function fakeScene(): { scene: VisualEffectsScene; flashRects: { x: number; y: number; alpha: number }[] } {
  const flashRects: { x: number; y: number; alpha: number }[] = [];
  let pending: { x: number; y: number } | null = null;
  const painter = {
    clear: () => {
      flashRects.length = 0;
      return painter;
    },
    rect: (x: number, y: number) => {
      pending = { x, y };
      return painter;
    },
    fill: (style: { color: number; alpha: number }) => {
      if (pending !== null) flashRects.push({ ...pending, alpha: style.alpha });
      pending = null;
      return painter;
    },
  };
  const scene: VisualEffectsScene = {
    shakeTarget: { x: 0, y: 0, rotation: 0 },
    particleLayer: null,
    popLayer: { addChild: () => undefined },
    flashLayer: { visible: false, alpha: 0, tint: 0 },
    brickFlashLayer: painter,
  };
  return { scene, flashRects };
}

describe("laserShapes (pure geometry)", () => {
  it("draws each Bolt as a 1-wide, 8-long yellow bar from its tip down", () => {
    const shapes = laserShapes(snapWith({ bolts: [{ x: 90, y: 120, owner: 0 }] }));
    expect(shapes.bolts).toEqual([{ x: 89.5, y: 120, w: 1, h: 8 }]);
    expect(LASER_COLOR).toBe(0xffe040);
  });

  it("no ready-ticks on an unarmed Paddle", () => {
    expect(laserShapes(snapWith()).readyTicks).toEqual([]);
    // A stray ready flag without Armed draws nothing either.
    expect(laserShapes(snapWith({ players: [player({ laserReady: true })] })).readyTicks).toEqual([]);
  });

  it("two ready-ticks over the Paddle ends while Armed and off cooldown", () => {
    const snap = snapWith({ players: [player({ effects: { L: 1 }, laserReady: true })] });
    // Ends at x = 104 ± (16 - 2) = 90 / 118; Paddle top y = 239.
    expect(laserShapes(snap).readyTicks).toEqual([
      { x: 89.5, y: 236, w: 1, h: 2 },
      { x: 117.5, y: 236, w: 1, h: 2 },
    ]);
  });

  it("ticks hide while the host reports the Paddle cooling down", () => {
    const snap = snapWith({ players: [player({ effects: { L: 1 }, laserReady: false })] });
    expect(laserShapes(snap).readyTicks).toEqual([]);
  });

  it("ticks follow each Paddle's own readiness (shared Paddle / several players)", () => {
    const snap = snapWith({
      players: [
        player({ effects: { L: 1 }, laserReady: false }),
        player({ player: 1, effects: { L: 1 }, laserReady: true, paddle: { x: 50, y: 242, w: 32, h: 6, edge: "bottom" } }),
      ],
    });
    expect(laserShapes(snap).readyTicks.map((r) => r.x + 0.5)).toEqual([36, 64]);
  });

  it("ticks follow the live Paddle width", () => {
    const snap = snapWith({ players: [player({ effects: { L: 1 }, laserReady: true, paddle: { x: 104, y: 242, w: 48, h: 6, edge: "bottom" } })] });
    expect(laserShapes(snap).readyTicks.map((r) => r.x + 0.5)).toEqual([82, 126]);
  });
});

describe("VisualEffects: Bolt hits", () => {
  it("a Bolt break flashes the Brick white and pops the score, with no shake, particles or field flash", () => {
    const { scene, flashRects } = fakeScene();
    const fx = new VisualEffects(scene);
    const snap = snapWith({ events: [ev("boltHit", 15), ev("brickBreak", 15)] });
    fx.consume(snap);
    const st = fx.state;
    expect(st.brickFlashes).toEqual([15]);
    expect(st.pops).toEqual(["+50"]);
    expect(st.trauma).toBe(0);
    expect(st.particles).toBe(0);
    expect(st.flashAlpha).toBe(0);
    expect(st.hitStopFrames).toBe(0);
    fx.update(0.01);
    fx.applyToScene();
    // Cell 15 = column 2, row 1 → top-left (32, 28), drawn white.
    expect(flashRects).toHaveLength(1);
    expect(flashRects[0]).toMatchObject({ x: 32, y: 28 });
    expect(flashRects[0]?.alpha).toBeGreaterThan(0);
  });

  it("the flash lasts ~0.12 s", () => {
    const { scene } = fakeScene();
    const fx = new VisualEffects(scene);
    fx.consume(snapWith({ events: [ev("boltHit", 15), ev("brickSilverHit", 15)] }));
    fx.update(BRICK_FLASH_SECONDS - 0.02);
    expect(fx.state.brickFlashes).toEqual([15]);
    fx.update(0.03);
    expect(fx.state.brickFlashes).toEqual([]);
    expect(BRICK_FLASH_SECONDS).toBeCloseTo(0.12);
  });

  it("flash and pop survive reduced effects", () => {
    const { scene } = fakeScene();
    const fx = new VisualEffects(scene);
    fx.setReducedEffects(true);
    fx.consume(snapWith({ events: [ev("boltHit", 15), ev("brickBreak", 15)] }));
    expect(fx.state.brickFlashes).toEqual([15]);
    expect(fx.state.pops).toEqual(["+50"]);
  });

  it("a gold hit renders no flash and no pop", () => {
    const { scene } = fakeScene();
    const fx = new VisualEffects(scene);
    fx.consume(snapWith({ events: [ev("boltGoldHit", 15)] }));
    expect(fx.state.brickFlashes).toEqual([]);
    expect(fx.state.pops).toEqual([]);
    expect(fx.state.trauma).toBe(0);
  });

  it("a ball break keeps its full juice (pairing is per cell)", () => {
    const { scene } = fakeScene();
    const fx = new VisualEffects(scene);
    fx.consume(snapWith({ events: [ev("boltHit", 15), ev("brickBreak", 15), ev("brickBreak", 30)] }));
    expect(fx.state.trauma).toBeGreaterThan(0);
    expect(fx.state.brickFlashes).toEqual([15]);
    expect(fx.state.pops).toEqual(["+50", "+50"]);
  });

  it("a held laser climbing the Chain gets no escalation shake or particles", () => {
    const { scene } = fakeScene();
    const fx = new VisualEffects(scene);
    const events = [15, 16, 17, 18].flatMap((cell) => [ev("boltHit", cell), ev("brickBreak", cell)]);
    fx.consume(snapWith({ events }));
    expect(fx.state.chain).toBe(4);
    expect(fx.state.trauma).toBe(0);
    expect(fx.state.flashAlpha).toBe(0);
    expect(fx.state.pops).not.toContain("x2");
  });

  it("Bolt breaks still extend the Chain", () => {
    const { scene } = fakeScene();
    const fx = new VisualEffects(scene);
    fx.consume(snapWith({ events: [ev("boltHit", 15), ev("brickBreak", 15), ev("boltHit", 16), ev("brickBreak", 16)] }));
    expect(fx.state.chain).toBe(2);
  });

  it("reset clears live Brick flashes", () => {
    const { scene } = fakeScene();
    const fx = new VisualEffects(scene);
    fx.consume(snapWith({ events: [ev("boltHit", 15), ev("brickBreak", 15)] }));
    fx.reset();
    expect(fx.state.brickFlashes).toEqual([]);
  });
});

describe("FieldView: laser wiring", () => {
  function makeView(reducedEffects = false): FieldView {
    return new FieldView({ layout: layoutField({ x: 0, y: 0, w: 800, h: 600 }), player: 0, locale: "en-US", maxRound: 33, reducedEffects });
  }

  it("draws Bolts and ready-ticks from the snapshot", () => {
    const view = makeView();
    view.sync(snapWith({ players: [player({ effects: { L: 1 }, laserReady: true })], bolts: [{ x: 90, y: 120, owner: 0 }] }));
    expect(view.laserShapes.bolts).toHaveLength(1);
    expect(view.laserShapes.readyTicks).toHaveLength(2);
    view.container.destroy({ children: true });
  });

  it("ticks follow the replicated laserReady flag", () => {
    const view = makeView();
    view.sync(snapWith({ players: [player({ effects: { L: 1 }, laserReady: false })] }));
    expect(view.laserShapes.readyTicks).toEqual([]);
    view.sync(snapWith({ tick: 101, players: [player({ effects: { L: 1 }, laserReady: true })] }));
    expect(view.laserShapes.readyTicks).toHaveLength(2);
    view.container.destroy({ children: true });
  });

  it("draws nothing laser-related without Laser state", () => {
    const view = makeView();
    view.sync(snapWith());
    expect(view.laserShapes).toEqual({ bolts: [], readyTicks: [] });
    view.container.destroy({ children: true });
  });

  it("Bolt hit flash + pop work under reduced effects in a real FieldView", () => {
    const view = makeView(true);
    view.sync(snapWith({ events: [ev("boltHit", 15), ev("brickBreak", 15)] }));
    expect(view.effectsState.brickFlashes).toEqual([15]);
    expect(view.effectsState.pops).toContain("+50");
    view.container.destroy({ children: true });
  });
});
