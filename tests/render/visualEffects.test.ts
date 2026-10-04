// VisualEffects orchestrator (ADR 0009, tickets #90/#91).
//
// These tests drive the orchestrator against a *recording* scene and assert on
// `state` — the same surface the FieldView wiring reads. Headless by design:
// the particle pool no-ops without an atlas texture (node has no DOM), so the
// particle *channel* is asserted via its pool bookkeeping rather than pixels.
// That keeps the assertions on behavior ("brickBreak shakes, flashes and pops
// at the brick") rather than on Pixi internals.
import { describe, expect, it } from "vitest";
import type {
  BallSnapshot,
  PlayerSnapshot,
  SimEvent,
  SimEventType,
  Snapshot,
} from "shared/protocol";
import { BRICK_COLS, FIELD_H, FIELD_W } from "shared/gridConstants";
import { VisualEffects, brickCenter, type VisualEffectsScene } from "render/visualEffects";
import { CHAIN_LEVELS, CHAIN_RECIPES, EFFECT_RECIPES, chainLevel } from "render/effectPresets";

/** A ball in flight at a known position — the anchor the recipes resolve on. */
function ball(x = 100, y = 200): BallSnapshot {
  return { x, y, vx: 0, vy: 0, attachedTo: null, owner: null };
}

/** A player whose paddle is at a known position. */
function player(x = 104, y = 240, index = 0): PlayerSnapshot {
  return {
    player: index,
    name: `P${String(index + 1)}`,
    skinIndex: 0,
    paddle: { x, y, w: 32, h: 6, edge: "bottom" },
    lives: 3,
    score: 0,
    meter: 0,
    target: -1,
    chain: 0,
    state: "playing",
    effects: {},
  };
}

interface RecordingScene extends VisualEffectsScene {
  added: string[];
}

function makeScene(): RecordingScene {
  const added: string[] = [];
  return {
    added,
    shakeTarget: { x: 0, y: 0, rotation: 0 },
    particleLayer: { addChild: () => added.push("particles") },
    popLayer: { addChild: () => added.push("pops") },
    flashLayer: { visible: false, alpha: 0, tint: 0xffffff },
    ballSprite: null,
    paddleSprite: null,
  };
}

/** Minimal snapshot — the orchestrator only reads events, bricks, balls, players. */
function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    tick: 0,
    round: 1,
    phase: "serve",
    bricks: new Array<number>(BRICK_COLS * 18).fill(0),
    capsules: [],
    balls: [],
    players: [],
    events: [],
    ...over,
  } as Snapshot;
}

function ev(type: SimEventType, over: Partial<SimEvent> = {}): SimEvent {
  return { type, source: 0, target: -1, tick: 1, ...over };
}

/** Advance n frames at 60 fps (dt in seconds). */
function advance(fx: VisualEffects, frames = 1, dt = 1 / 60): void {
  for (let i = 0; i < frames; i++) fx.update(dt);
}

/**
 * Fire one event and push it to the scene *without* advancing a frame, so
 * assertions read the state the event just produced (trauma not yet decayed,
 * hit-stop not yet consumed).
 */
function fire(fx: VisualEffects, type: SimEventType, s: Snapshot, over: Partial<SimEvent> = {}): void {
  fx.onSimEvent(ev(type, over), s);
  fx.applyToScene();
}

describe("effect recipes", () => {
  it("covers every event type that carries visual meaning", () => {
    // pause/resume are menu transitions — deliberately no juice.
    for (const type of ["pause", "resume"] as SimEventType[]) {
      expect(EFFECT_RECIPES[type]).toBeUndefined();
    }
    for (const type of [
      "ballLaunch",
      "ballLoss",
      "brickBreak",
      "brickSilverHit",
      "capsuleCatch",
      "roundClear",
      "gameOver",
      "attack",
      "assist",
      "paddleBounce",
      "bossHit",
      "bossDead",
    ] as SimEventType[]) {
      expect(EFFECT_RECIPES[type], `${type} needs a recipe`).toBeDefined();
    }
  });

  it("keeps squash volume-conserving (scaleX * scaleY === 1)", () => {
    for (const [type, recipe] of Object.entries(EFFECT_RECIPES)) {
      if (recipe?.ballSquash !== undefined) {
        expect(recipe.ballSquash.scaleX * recipe.ballSquash.scaleY, `${type} ball`).toBeCloseTo(1, 6);
      }
      if (recipe?.paddleSquash !== undefined) {
        expect(recipe.paddleSquash.scaleX * recipe.paddleSquash.scaleY, `${type} paddle`).toBeCloseTo(1, 6);
      }
    }
  });

  it("chain levels fire at the audit thresholds (4 / 7 / 10)", () => {
    expect(CHAIN_LEVELS).toEqual([4, 7, 10]);
    expect(chainLevel(3)).toBeNull();
    expect(chainLevel(4)).toBe(1);
    expect(chainLevel(6)).toBe(1);
    expect(chainLevel(7)).toBe(2);
    expect(chainLevel(9)).toBe(2);
    expect(chainLevel(10)).toBe(3);
    expect(chainLevel(50)).toBe(3);
  });
});

describe("brick anchors", () => {
  it("maps a flat brick index to its field-unit center", () => {
    // Row 0, col 0 → x = 8, y = 20 + 4.
    expect(brickCenter(0, 300)).toEqual({ x: 8, y: 24 });
    // Row 1, col 2 → index 2 + 13.
    expect(brickCenter(15, 300)).toEqual({ x: 2 * 16 + 8, y: 20 + 8 + 4 });
  });

  it("falls back to the field center for an out-of-range index", () => {
    const center = { x: FIELD_W / 2, y: FIELD_H / 2 };
    expect(brickCenter(-1, 300)).toEqual(center);
    expect(brickCenter(9999, 300)).toEqual(center);
    expect(brickCenter(1.5, 300)).toEqual(center);
  });
});

describe("per-event feedback", () => {
  it("brickBreak: trauma, white flash, ball squash and a score pop", () => {
    const scene = makeScene();
    const fx = new VisualEffects(scene);
    fx.mount();
    const s = snap({ balls: [ball(100, 200)] });
    fire(fx, "brickBreak", s, { target: 15 });

    const st = fx.state;
    expect(st.trauma).toBeGreaterThan(0);
    expect(st.hitStopFrames).toBeGreaterThan(0);
    expect(st.flashAlpha).toBeGreaterThan(0);
    expect(st.flashColor).toBe(0xffffff);
    expect(st.ballScale.x).toBeGreaterThan(1);
    expect(st.ballScale.y).toBeLessThan(1);
    expect(st.pops).toContain("+50");
    // The pop anchors on the brick, not the field center.
    expect(brickCenter(15, 300)).toEqual({ x: 40, y: 32 });
  });

  it("brickSilverHit: small trauma, chip pop, no hit-stop", () => {
    const fx = new VisualEffects(makeScene());
    fire(fx, "brickSilverHit", snap(), { target: 3 });
    const st = fx.state;
    expect(st.trauma).toBeLessThan(0.1);
    expect(st.hitStopFrames).toBe(0);
    expect(st.pops).toContain("+10");
  });

  it("paddleBounce: freezes, squashes ball AND paddle", () => {
    const fx = new VisualEffects(makeScene());
    const s = snap({ balls: [ball()], players: [player(50, 240)] });
    fire(fx, "paddleBounce", s);
    const st = fx.state;
    expect(st.ballScale.x).toBeGreaterThan(1);
    expect(st.paddleScale.x).toBeLessThan(1);
    expect(st.paddleScale.y).toBeGreaterThan(1);
    expect(st.hitStopFrames).toBeGreaterThan(0);
  });

  it("ballLoss: strong shake, red flash, splat squash, life pop", () => {
    const fx = new VisualEffects(makeScene());
    const s = snap({ balls: [ball(100, 250)] });
    const clean = new VisualEffects(makeScene());
    fire(clean, "paddleBounce", s);
    fire(fx, "ballLoss", s);
    expect(fx.state.trauma).toBeGreaterThan(clean.state.trauma);
    expect(fx.state.flashColor).toBe(0xff2222);
    expect(fx.state.pops).toContain("-1");
    expect(fx.state.ballScale.x).toBeGreaterThan(1.4);
  });

  it("capsuleCatch: green burst flash and a CAPSULE pop on the paddle", () => {
    const fx = new VisualEffects(makeScene());
    const s = snap({ balls: [ball()], players: [player(20, 240)] });
    fire(fx, "capsuleCatch", s);
    expect(fx.state.flashColor).toBe(0x44ff88);
    expect(fx.state.pops).toContain("CAPSULE");
    expect(fx.state.paddleScale.x).toBeGreaterThan(1);
  });

  it("roundClear: the biggest mid-game beat — heavy shake, gold flash, CLEAR pop", () => {
    const fx = new VisualEffects(makeScene());
    fire(fx, "roundClear", snap());
    expect(fx.state.trauma).toBeGreaterThan(0.5);
    expect(fx.state.flashColor).toBe(0xffff44);
    expect(fx.state.pops).toContain("CLEAR");
    expect(fx.state.hitStopFrames).toBeGreaterThanOrEqual(4);
  });

  it("bossDead: max trauma and a long freeze — the finale reads hardest", () => {
    const fx = new VisualEffects(makeScene());
    fire(fx, "bossDead", snap());
    expect(fx.state.trauma).toBe(1);
    expect(fx.state.pops).toContain("BOSS CLEAR");
    expect(fx.state.hitStopFrames).toBeGreaterThanOrEqual(8);
  });

  it("bossHit: orange burst anchored on the ball", () => {
    const fx = new VisualEffects(makeScene());
    const s = snap({ balls: [ball(104, 60)] });
    fire(fx, "bossHit", s);
    expect(fx.state.trauma).toBeGreaterThan(0.2);
    expect(fx.state.ballScale.x).toBeGreaterThan(1);
  });

  it("ballLaunch: stretch along the launch axis, no flash", () => {
    const fx = new VisualEffects(makeScene());
    const s = snap({ balls: [ball(104, 200)] });
    fire(fx, "ballLaunch", s);
    expect(fx.state.ballScale.x).toBeLessThan(1);
    expect(fx.state.ballScale.y).toBeGreaterThan(1);
    expect(fx.state.flashAlpha).toBe(0);
  });

  it("attack and assist: colored flash + label, no particles needed", () => {
    const attack = new VisualEffects(makeScene());
    fire(attack, "attack", snap());
    expect(attack.state.flashColor).toBe(0xff2222);
    expect(attack.state.pops).toContain("ATTACK");

    const assist = new VisualEffects(makeScene());
    fire(assist, "assist", snap());
    expect(assist.state.flashColor).toBe(0x4488ff);
    expect(assist.state.pops).toContain("ASSIST");
  });

  it("gameOver: dark fade + final label", () => {
    const fx = new VisualEffects(makeScene());
    fire(fx, "gameOver", snap());
    expect(fx.state.flashColor).toBe(0x000000);
    expect(fx.state.pops).toContain("GAME OVER");
  });

  it("events with no recipe stay silent rather than throwing", () => {
    const fx = new VisualEffects(makeScene());
    for (const type of ["pause", "resume"] as SimEventType[]) {
      expect(() => {
        fire(fx, type, snap());
      }).not.toThrow();
      expect(fx.state.trauma).toBe(0);
      expect(fx.state.pops).toEqual([]);
    }
  });
});

describe("chain escalation (derived, not emitted)", () => {
  it("escalates at 4, 7 and 10 consecutive breaks", () => {
    const fx = new VisualEffects(makeScene());
    const s = snap({ balls: [ball(100, 200)] });
    const popAfter = (n: number): readonly string[] => {
      const local = new VisualEffects(makeScene());
      for (let i = 0; i < n; i++) local.onSimEvent(ev("brickBreak", { target: i }), s);
      return local.state.pops;
    };
    expect(popAfter(3)).not.toContain("x2");
    expect(popAfter(4)).toContain("x2");
    expect(popAfter(7)).toContain("x3");
    expect(popAfter(10)).toContain("x4");
    // Each break also raises its own "+50" pop alongside the chain label.
    expect(popAfter(4).filter((p) => p === "+50")).toHaveLength(4);
    // The streak lives on the instance, not the scene.
    fx.onSimEvent(ev("brickBreak"), s);
    expect(fx.state.chain).toBe(1);
  });

  it("escalation gets stronger each tier", () => {
    // Compare the recipes, not accumulated trauma — 10 rapid breaks saturate
    // the trauma clamp, so the accumulator can't show the tier difference.
    const trauma = [1, 2, 3].map((l) => CHAIN_RECIPES[l as 1 | 2 | 3].trauma ?? 0);
    const particles = [1, 2, 3].map((l) => CHAIN_RECIPES[l as 1 | 2 | 3].burst?.count ?? 0);
    const flash = [1, 2, 3].map((l) => CHAIN_RECIPES[l as 1 | 2 | 3].flash?.intensity ?? 0);
    expect(trauma[0]).toBeLessThan(trauma[1]!);
    expect(trauma[1]).toBeLessThan(trauma[2]!);
    expect(particles[0]).toBeLessThan(particles[1]!);
    expect(particles[1]).toBeLessThan(particles[2]!);
    expect(flash[0]).toBeLessThan(flash[1]!);
    expect(flash[1]).toBeLessThan(flash[2]!);
  });

  it("a ball loss or launch resets the streak", () => {
    const s = snap({ balls: [ball(100, 240)] });
    for (const resetter of ["ballLoss", "ballLaunch"] as SimEventType[]) {
      const fx = new VisualEffects(makeScene());
      for (let i = 0; i < 4; i++) fx.onSimEvent(ev("brickBreak", { target: i }), s);
      expect(fx.state.chain).toBe(4);
      fx.onSimEvent(ev(resetter), s);
      expect(fx.state.chain).toBe(0);
    }
  });
});

describe("event ring dedupe (guest interpolation replay)", () => {
  it("consume() fires each event once even when the ring repeats", () => {
    const fx = new VisualEffects(makeScene());
    const s = snap({
      balls: [ball(100, 200)],
      events: [ev("brickBreak", { target: 1, tick: 5 })],
    });
    fx.consume(s);
    fx.update(1 / 60);
    const first = fx.state.pops.filter((p) => p === "+50").length;
    // The next rendered frame replays the same ring (same tick).
    fx.consume(s);
    fx.update(1 / 60);
    const second = fx.state.pops.filter((p) => p === "+50").length;
    expect(first).toBe(1);
    expect(second).toBe(1);
  });

  it("a newer tick in the ring does fire", () => {
    const fx = new VisualEffects(makeScene());
    const base = snap({
      balls: [ball(100, 200)],
      events: [ev("brickBreak", { target: 1, tick: 5 })],
    });
    fx.consume(base);
    fx.update(1 / 60);
    fx.consume(snap({ ...base, tick: 6, events: [ev("brickBreak", { target: 2, tick: 6 })] }));
    fx.update(1 / 60);
    expect(fx.state.pops.filter((p) => p === "+50").length).toBe(2);
  });
});

describe("reduced effects (audit §8)", () => {
  it("drops particles, flash and shake but keeps hit-stop and squash", () => {
    const scene = makeScene();
    const fx = new VisualEffects(scene);
    fx.setReducedEffects(true);
    expect(fx.state.reducedEffects).toBe(true);

    const s = snap({ balls: [ball()], players: [player(50, 240)] });
    fire(fx, "paddleBounce", s);
    const st = fx.state;

    // Decorative channels are off.
    expect(st.trauma).toBe(0);
    expect(st.flashAlpha).toBe(0);
    // Readability channels survive.
    expect(st.ballScale.x).toBeGreaterThan(1);
    expect(st.paddleScale.y).toBeGreaterThan(1);
    // Hit-stop survives but is halved (2 frames → 1).
    expect(st.hitStopFrames).toBe(1);
  });

  it("halves hit-stop rather than removing it", () => {
    const s = snap();
    const full = new VisualEffects(makeScene());
    fire(full, "roundClear", s);
    const reduced = new VisualEffects(makeScene());
    reduced.setReducedEffects(true);
    fire(reduced, "roundClear", s);
    expect(reduced.state.hitStopFrames).toBe(Math.round(full.state.hitStopFrames / 2));
  });

  it("keeps score pops (they carry the reward, not decoration)", () => {
    const fx = new VisualEffects(makeScene());
    fx.setReducedEffects(true);
    fire(fx, "capsuleCatch", snap());
    expect(fx.state.pops).toContain("CAPSULE");
  });

  it("toggling clears live decorative state so nothing is stranded", () => {
    const fx = new VisualEffects(makeScene());
    const s = snap({ balls: [ball(100, 200)] });
    fire(fx, "roundClear", s);
    expect(fx.state.trauma).toBeGreaterThan(0);
    fx.setReducedEffects(true);
    expect(fx.state.trauma).toBe(0);
    expect(fx.state.flashAlpha).toBe(0);
  });
});

describe("hit-stop (visual-only freeze)", () => {
  it("holds effect animation for exactly the requested frames", () => {
    const fx = new VisualEffects(makeScene());
    fire(fx, "brickBreak", snap({ balls: [ball(100, 200)] }), {
      target: 1,
    });
    const pending = fx.state.hitStopFrames;
    expect(pending).toBeGreaterThan(0);
    // Each update consumes one frame; the squash stays frozen meanwhile.
    const frozenScale = fx.state.ballScale.x;
    for (let i = 0; i < pending; i++) fx.update(1 / 60);
    expect(fx.state.ballScale.x).toBe(frozenScale);
    // One more frame and it starts easing back.
    fx.update(1 / 60);
    expect(fx.state.ballScale.x).toBeLessThan(frozenScale);
  });

  it("a longer freeze overrides a shorter one already in flight", () => {
    const fx = new VisualEffects(makeScene());
    fire(fx, "brickSilverHit", snap(), { target: 1 });
    expect(fx.state.hitStopFrames).toBe(0);
    fire(fx, "paddleBounce", snap());
    const short = fx.state.hitStopFrames;
    fire(fx, "bossDead", snap());
    expect(fx.state.hitStopFrames).toBeGreaterThan(short);
  });

  it("squash eases back to exactly neutral", () => {
    const fx = new VisualEffects(makeScene());
    fire(fx, "bossHit", snap({ balls: [ball(10, 10)] }));
    for (let i = 0; i < 200; i++) fx.update(1 / 60);
    expect(fx.state.ballScale.x).toBeCloseTo(1, 6);
    expect(fx.state.ballScale.y).toBeCloseTo(1, 6);
  });
});

describe("trauma shake", () => {
  it("decays to rest and returns the field to its origin", () => {
    const scene = makeScene();
    const fx = new VisualEffects(scene);
    fire(fx, "bossDead", snap());
    expect(fx.state.trauma).toBe(1);
    // Mid-shake the layer is displaced (update computes the offset).
    fx.update(1 / 60);
    fx.applyToScene();
    const moved =
      Math.abs(scene.shakeTarget.x) + Math.abs(scene.shakeTarget.y);
    for (let i = 0; i < 200; i++) fx.update(1 / 60);
    fx.applyToScene();
    expect(fx.state.trauma).toBe(0);
    expect(scene.shakeTarget.x).toBe(0);
    expect(scene.shakeTarget.y).toBe(0);
    expect(scene.shakeTarget.rotation).toBe(0);
    expect(moved).toBeGreaterThan(0);
  });

  it("clamps at full trauma so a burst cannot fling the field", () => {
    const fx = new VisualEffects(makeScene());
    for (let i = 0; i < 10; i++) fx.onSimEvent(ev("bossDead"), snap());
    expect(fx.state.trauma).toBe(1);
  });
});

describe("flash", () => {
  it("fades to nothing over its duration", () => {
    const fx = new VisualEffects(makeScene());
    fire(fx, "roundClear", snap());
    const peak = fx.state.flashAlpha;
    expect(peak).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) fx.update(1 / 60);
    expect(fx.state.flashAlpha).toBe(0);
  });

  it("a stronger flash is not downgraded by a weaker one mid-flash", () => {
    const fx = new VisualEffects(makeScene());
    fire(fx, "roundClear", snap()); // gold, intensity 0.3
    const strong = fx.state.flashColor;
    fire(fx, "brickSilverHit", snap(), { target: 1 }); // white, intensity 0.06
    expect(fx.state.flashColor).toBe(strong);
  });

  it("hides the scene quad when idle", () => {
    const scene = makeScene();
    const fx = new VisualEffects(scene);
    fx.update(1 / 60);
    fx.applyToScene();
    expect(scene.flashLayer.visible).toBe(false);
    fire(fx, "roundClear", snap());
    fx.applyToScene();
    expect(scene.flashLayer.visible).toBe(true);
  });
});

describe("score pops", () => {
  it("retire after their duration and return to the pool", () => {
    const fx = new VisualEffects(makeScene());
    fire(fx, "brickBreak", snap());
    expect(fx.state.pops.length).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) fx.update(1 / 60);
    expect(fx.state.pops).toEqual([]);
  });

  it("overlapping pops do not grow without bound (pool recycles)", () => {
    const fx = new VisualEffects(makeScene());
    for (let i = 0; i < 40; i++) {
      fx.onSimEvent(ev("brickBreak", { target: i, tick: i }), snap());
      fx.update(1 / 60);
    }
    // Pool is 8; the oldest is recycled rather than allocated.
    expect(fx.state.pops.length).toBeLessThanOrEqual(8);
  });

  it("pops recycle rather than grow the live list unbounded", () => {
    const fx = new VisualEffects(makeScene());
    for (let i = 0; i < 200; i++) {
      fx.onSimEvent(ev("brickBreak", { target: i, tick: i }), snap());
      fx.update(1 / 60);
    }
    // 200 rapid breaks, pool of 8 — the live list must stay bounded.
    expect(fx.state.pops.length).toBeLessThanOrEqual(8);
  });
});

/** Records the last scale the orchestrator wrote. */
interface ScaleSpy {
  scale: { set(x: number, y: number): void };
  lastX: number;
  lastY: number;
}

function spy(): ScaleSpy {
  const s: ScaleSpy = {
    lastX: 1,
    lastY: 1,
    scale: {
      set(x: number, y: number): void {
        s.lastX = x;
        s.lastY = y;
      },
    },
  };
  return s;
}

describe("scene application", () => {
  it("writes squash onto the sprites when they exist", () => {
    const scene = makeScene();
    const ballSprite = spy();
    const paddleSprite = spy();
    const withSprites: VisualEffectsScene = { ...scene, ballSprite, paddleSprite };
    const fx = new VisualEffects(withSprites);
    fire(fx, "paddleBounce", snap({ balls: [ball()], players: [player()] }));
    fx.applyToScene();
    expect(ballSprite.lastX).toBeGreaterThan(1);
    expect(paddleSprite.lastY).toBeGreaterThan(1);
  });

  it("mounts particle and pop layers once", () => {
    const scene = makeScene();
    const fx = new VisualEffects(scene);
    fx.mount();
    fx.mount();
    // Headless: no atlas texture, so only the pop layer is a real child.
    expect(scene.added.filter((a) => a === "pops")).toHaveLength(1);
  });

  it("a negative or non-finite dt cannot corrupt the state", () => {
    const fx = new VisualEffects(makeScene());
    fire(fx, "roundClear", snap());
    expect(() => {
      fx.update(-1);
      fx.update(Number.NaN);
      advance(fx, 3, 0);
    }).not.toThrow();
    expect(Number.isFinite(fx.state.trauma)).toBe(true);
  });
});

describe("reset (context restore / rejoin)", () => {
  it("clears every channel and the chain", () => {
    const fx = new VisualEffects(makeScene());
    const s = snap({ balls: [ball(100, 200)] });
    fire(fx, "bossDead", s);
    expect(fx.state.trauma).toBe(1);
    fx.reset();
    const st = fx.state;
    expect(st.trauma).toBe(0);
    expect(st.hitStopFrames).toBe(0);
    expect(st.flashAlpha).toBe(0);
    expect(st.pops).toEqual([]);
    expect(st.chain).toBe(0);
    expect(st.ballScale.x).toBe(1);
  });

  it("still fires after a reset", () => {
    const fx = new VisualEffects(makeScene());
    fire(fx, "roundClear", snap());
    fx.reset();
    fire(fx, "capsuleCatch", snap());
    expect(fx.state.pops).toContain("CAPSULE");
  });
});
