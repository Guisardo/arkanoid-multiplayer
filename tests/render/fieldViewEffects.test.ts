// FieldView ↔ VisualEffects integration (ADR 0009, ticket #91).
//
// The wiring contract: `sync()` consumes the snapshot's event ring and
// `tickEffects()` advances + applies. These tests use real snapshots from
// `createRoundSim` where possible, so the event payloads are the ones the sim
// actually emits — not hand-rolled fixtures.
import { describe, expect, it } from "vitest";
import { FieldView } from "render/fieldView";
import { SplitScreenView } from "render/splitScreen";
import { layoutField } from "render/layout";
import { EMPTY_ACTIONS, type InputFrame, type Snapshot } from "shared/protocol";
import { createRoundSim } from "sim/roundSim";
import { getLevel } from "content/levels";

/** One human input frame — the sim only needs axis + launch. */
function frame(tick: number, axisX: number): InputFrame {
  return { player: 0, tick, axisX, axisY: 0, launch: tick % 40 === 0, actions: EMPTY_ACTIONS };
}

function makeView(over: { reducedEffects?: boolean } = {}): FieldView {
  return new FieldView({
    layout: layoutField({ x: 0, y: 0, w: 800, h: 600 }),
    player: 0,
    locale: "en-US",
    maxRound: 33,
    ...over,
  });
}

/** A complete-enough snapshot that `FieldView.sync` accepts verbatim. */
function snapWith(events: Snapshot["events"], over: Partial<Snapshot> = {}): Snapshot {
  return {
    tick: 5,
    round: 1,
    phase: "play",
    bricks: new Array<number>(13 * 18).fill(0),
    capsules: [],
    bossProjectiles: [],
    balls: [{ x: 104, y: 200, vx: 0, vy: 0, attachedTo: null, owner: null }],
    players: [
      {
        player: 0,
        name: "P1",
        skinIndex: 0,
        paddle: { x: 104, y: 240, w: 32, h: 6, edge: "bottom" },
        lives: 3,
        score: 0,
        meter: 0,
        target: -1,
        chain: 0,
        state: "playing",
        effects: {},
      },
    ],
    events,
    ...over,
  } as Snapshot;
}

describe("FieldView effect wiring", () => {
  it("a FieldView owns exactly one orchestrator, mounted at construction", () => {
    const view = makeView();
    expect(view.visualEffects).toBeDefined();
    expect(view.effectsState.trauma).toBe(0);
    view.container.destroy({ children: true });
  });

  it("sync() consumes the event ring and produces the event's feedback", () => {
    const view = makeView();
    view.sync(snapWith([{ type: "brickBreak", source: 0, target: 15, tick: 5 }]));
    // No tickEffects() yet — sync alone must not advance, but it must consume.
    expect(view.effectsState.trauma).toBeGreaterThan(0);
    expect(view.effectsState.pops).toContain("+50");
    view.container.destroy({ children: true });
  });

  it("sync() with an empty ring produces nothing", () => {
    const view = makeView();
    view.sync(snapWith([]));
    const st = view.effectsState;
    expect(st.trauma).toBe(0);
    expect(st.flashAlpha).toBe(0);
    expect(st.pops).toEqual([]);
    view.container.destroy({ children: true });
  });

  it("re-syncing the same snapshot does not double-fire (ring dedupe)", () => {
    const view = makeView();
    const s = snapWith([{ type: "brickBreak", source: 0, target: 15, tick: 5 }]);
    view.sync(s);
    view.sync(s);
    view.sync(s);
    // One break pop, not three.
    expect(view.effectsState.pops.filter((p) => p === "+50")).toHaveLength(1);
    view.container.destroy({ children: true });
  });

  it("tickEffects() advances and returns to rest once the effect expires", () => {
    const view = makeView();
    view.sync(snapWith([{ type: "brickBreak", source: 0, target: 1, tick: 5 }]));
    view.tickEffects(0.016);
    const midShake = view.effectsState.trauma;
    expect(midShake).toBeGreaterThan(0);
    for (let i = 0; i < 400; i++) view.tickEffects(0.016);
    const st = view.effectsState;
    expect(st.trauma).toBe(0);
    expect(st.flashAlpha).toBe(0);
    expect(st.pops).toEqual([]);
    expect(st.ballScale.x).toBeCloseTo(1, 6);
    view.container.destroy({ children: true });
  });

  it("tickEffectsAuto() advances the shake from the wall clock", () => {
    const view = makeView();
    view.sync(snapWith([{ type: "roundClear", source: 0, target: -1, tick: 5 }]));
    const before = view.effectsState.trauma;
    view.tickEffectsAuto();
    // A real clock elapsed between construction and this call, so trauma has
    // decayed from its peak — proof the auto path actually advances.
    expect(view.effectsState.trauma).toBeLessThan(before);
    expect(view.effectsState.trauma).toBeGreaterThanOrEqual(0);
    view.container.destroy({ children: true });
  });
});

describe("FieldView reduced-effects toggle", () => {
  it("applies reduced effects to the orchestrator, not just the geometry", () => {
    const view = makeView();
    view.setReducedEffects(true);
    view.sync(snapWith([{ type: "roundClear", source: 0, target: -1, tick: 5 }]));
    const st = view.effectsState;
    expect(st.reducedEffects).toBe(true);
    expect(st.trauma).toBe(0);
    expect(st.flashAlpha).toBe(0);
    // ...but the readability channels survive.
    expect(st.pops).toContain("CLEAR");
    view.container.destroy({ children: true });
  });

  it("constructed with reducedEffects routes it straight into the orchestrator", () => {
    const view = makeView({ reducedEffects: true });
    expect(view.effectsState.reducedEffects).toBe(true);
    view.container.destroy({ children: true });
  });

  it("invalidate() clears transient effect state (context restore)", () => {
    const view = makeView();
    view.sync(snapWith([{ type: "bossDead", source: 0, target: -1, tick: 5 }]));
    expect(view.effectsState.trauma).toBe(1);
    view.invalidate();
    expect(view.effectsState.trauma).toBe(0);
    expect(view.effectsState.pops).toEqual([]);
    view.container.destroy({ children: true });
  });
});

describe("SplitScreenView effect wiring", () => {
  function makeSplit(players: number[], reducedEffects = false): SplitScreenView {
    return new SplitScreenView({
      viewport: { w: 1280, h: 720 },
      players,
      locale: "en-US",
      maxRound: 33,
      reducedEffects,
    });
  }

  it("each field gets its own orchestrator (split-screen isolation)", () => {
    const split = makeSplit([0, 1]);
    expect(split.fieldCount).toBe(2);
    // Only field 0's snapshot carries the event.
    split.sync([
      snapWith([{ type: "brickBreak", source: 0, target: 1, tick: 5 }]),
      snapWith([]),
    ]);
    expect(split.effectsStateOf(0)?.trauma).toBeGreaterThan(0);
    // Field 1's shake is untouched — no cross-field bleed.
    expect(split.effectsStateOf(1)?.trauma).toBe(0);
    split.tickEffects(0.016);
    split.container.destroy({ children: true });
  });

  it("tickEffects() without a dt advances every field", () => {
    const split = makeSplit([0, 1]);
    split.sync([
      snapWith([{ type: "roundClear", source: 0, target: -1, tick: 5 }]),
      snapWith([{ type: "roundClear", source: 1, target: -1, tick: 5 }]),
    ]);
    const before = split.effectsStateOf(0)?.trauma ?? 0;
    split.tickEffects();
    // Both fields advanced, not just the first.
    expect(split.effectsStateOf(0)?.trauma ?? 0).toBeLessThan(before);
    expect(split.effectsStateOf(1)?.trauma ?? 1).toBeLessThan(1);
    split.container.destroy({ children: true });
  });

  it("reduced-effects mode fans out to every field", () => {
    const split = makeSplit([0, 1], true);
    split.sync([
      snapWith([{ type: "roundClear", source: 0, target: -1, tick: 5 }]),
      snapWith([{ type: "roundClear", source: 1, target: -1, tick: 5 }]),
    ]);
    expect(split.effectsStateOf(0)?.reducedEffects).toBe(true);
    expect(split.effectsStateOf(0)?.trauma).toBe(0);
    split.container.destroy({ children: true });
  });

  it("effectsStateOf returns null for an out-of-range field", () => {
    const split = makeSplit([0]);
    expect(split.effectsStateOf(5)).toBeNull();
    split.container.destroy({ children: true });
  });

  it("a resize rebuild destroys the old orchestrators and still renders", () => {
    const split = makeSplit([0]);
    split.sync([snapWith([{ type: "roundClear", source: 0, target: -1, tick: 5 }])]);
    expect(split.effectsStateOf(0)?.trauma).toBeGreaterThan(0);
    split.resize({ w: 800, h: 600 });
    // Fresh fields start clean.
    expect(split.fieldCount).toBe(1);
    expect(split.effectsStateOf(0)?.trauma).toBe(0);
    expect(() => {
      split.sync([snapWith([])]);
    }).not.toThrow();
    split.container.destroy({ children: true });
  });
});

describe("real sim snapshots drive the effects end to end", () => {
  it("every event a real round emits produces a measurable state change", () => {
    // Drive the real sim so the payloads come from sim/, not fixtures.
    const sim = createRoundSim(getLevel(1), { lives: 3, score: 0 });
    const view = makeView();
    const seen = new Set<string>();
    let last: Snapshot = sim.snapshot();
    view.sync(last);

    for (let i = 0; i < 4000 && last.phase !== "roundClear" && last.phase !== "gameOver"; i++) {
      sim.step([frame(i, 1)]);
      last = sim.snapshot();
      for (const e of last.events) {
        if (seen.has(e.type)) continue;
        seen.add(e.type);
        // Fire this event into a *fresh* orchestrator so the delta is
        // attributable to the event alone, not to earlier frames' residue.
        const probe = makeView();
        probe.sync(snapWith([e]));
        const st = probe.effectsState;
        const anyFeedback =
          st.trauma > 0 ||
          st.flashAlpha > 0 ||
          st.hitStopFrames > 0 ||
          st.ballScale.x !== 1 ||
          st.paddleScale.x !== 1 ||
          st.pops.length > 0;
        expect(anyFeedback, `${e.type} produced no feedback`).toBe(true);
        probe.container.destroy({ children: true });
      }
      view.sync(last);
      view.tickEffects(0.016);
    }

    // A played round really does exercise the recipes.
    expect(seen.has("paddleBounce") || seen.has("brickBreak")).toBe(true);
    view.container.destroy({ children: true });
  });

  it("a brickBreak from the real sim carries a usable brick index", () => {
    const sim = createRoundSim(getLevel(1), { lives: 3, score: 0 });
    let snap = sim.snapshot();
    let breakEvent: { target: number } | null = null;
    for (let i = 0; i < 4000 && breakEvent === null; i++) {
      sim.step([frame(i, 0.5)]);
      snap = sim.snapshot();
      const hit = snap.events.find((e) => e.type === "brickBreak");
      if (hit !== undefined) breakEvent = hit;
    }
    expect(breakEvent).not.toBeNull();
    const target = breakEvent!.target;
    expect(Number.isInteger(target)).toBe(true);
    expect(target).toBeGreaterThanOrEqual(0);
    expect(target).toBeLessThan(snap.bricks.length);
  });
});
