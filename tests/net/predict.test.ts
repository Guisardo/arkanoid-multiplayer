// Predictor unit tests (ticket 46, spec §9): shadow advance + error-offset
// reconcile, per-constraint clamps (walls / shared-field slice / duel
// other-paddle-as-wall), offset decay ~0.5 s, history wipe on reset.
import { describe, expect, it } from "vitest";
import {
  createPredictor,
  predictBounds,
  OFFSET_DECAY_PER_TICK,
  RECONCILE_EPSILON,
} from "net/predict";
import { PADDLE_VMAX, FIELD_W, PADDLE_W } from "shared/gridConstants";
import { TICK_MS } from "shared/simRates";
import type { InputFrame, Snapshot } from "shared/protocol";
import { EMPTY_ACTIONS } from "shared/protocol";

const D = 4;
const MOVE_PER_TICK = PADDLE_VMAX * (TICK_MS / 1000);

function frame(player: number, tick: number, axisX: number): InputFrame {
  return { player, tick, axisX, axisY: 0, launch: false, actions: EMPTY_ACTIONS };
}

function snapWith(
  player: number,
  x: number,
  tick: number,
  extra: Snapshot["players"] = [],
): Snapshot {
  return {
    tick,
    phase: "play",
    round: 1,
    players: [
      {
        player,
        name: `P${String(player + 1)}`,
        skinIndex: 0,
        paddle: { x, y: 242, w: PADDLE_W, h: 6, edge: "bottom" },
        lives: 3,
        score: 0,
        meter: 0,
        target: -1,
        chain: 0,
        state: "playing",
        effects: {},
      },
      ...extra,
    ],
    balls: [],
    capsules: [],
    bricks: [],
    events: [],
    inputAcks: [],
  };
}

function otherPlayer(player: number, x: number): Snapshot["players"][number] {
  return {
    player,
    name: `P${String(player + 1)}`,
    skinIndex: 1,
    paddle: { x, y: 242, w: PADDLE_W, h: 6, edge: "bottom" },
    lives: 3,
    score: 0,
    meter: 0,
    target: -1,
    chain: 0,
    state: "playing",
    effects: {},
  };
}

describe("predictBounds (per-constraint clamps)", () => {
  it("walls: full field with half-paddle margins", () => {
    const b = predictBounds("walls", 0, 1, snapWith(0, 104, 0));
    expect(b.lo).toBeCloseTo(PADDLE_W / 2);
    expect(b.hi).toBeCloseTo(FIELD_W - PADDLE_W / 2);
  });

  it("sharedSlice: player i owns FIELD_W/N, half-paddle margins", () => {
    const snap = snapWith(1, 78, 0);
    const b = predictBounds("sharedSlice", 1, 2, snap);
    const sliceW = FIELD_W / 2;
    expect(b.lo).toBeCloseTo(sliceW + PADDLE_W / 2);
    expect(b.hi).toBeCloseTo(2 * sliceW - PADDLE_W / 2);
  });

  it("duelWall: other paddle below me caps hi at flush distance", () => {
    const me = 0;
    const snap = snapWith(0, 60, 0, [otherPlayer(1, 120)]);
    const b = predictBounds("duelWall", me, 2, snap);
    expect(b.hi).toBeCloseTo(120 - PADDLE_W);
  });

  it("duelWall: other paddle above me caps lo at flush distance", () => {
    const snap = snapWith(0, 120, 0, [otherPlayer(1, 60)]);
    const b = predictBounds("duelWall", 0, 2, snap);
    expect(b.lo).toBeCloseTo(60 + PADDLE_W);
  });

  it("duelWall never inverts bounds when flush closer than the wall", () => {
    const snap = snapWith(0, 5, 0, [otherPlayer(1, 30)]);
    const b = predictBounds("duelWall", 0, 2, snap);
    expect(b.hi).toBeGreaterThanOrEqual(b.lo - 1e-9);
    expect(b.hi).toBeLessThanOrEqual(FIELD_W - PADDLE_W / 2);
    expect(b.hi).toBeGreaterThanOrEqual(PADDLE_W / 2);
  });
});

describe("predictor: advance + reconcile", () => {
  it("first snapshot seeds the baseline; no invented start", () => {
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "walls", playerCount: 1, delayTicks: D });
    p.reconcile(snapWith(0, 42, 10));
    expect(p.predictedX).toBeCloseTo(42);
    expect(p.offset).toBe(0);
  });

  it("own paddle advances instantly on input (ahead of the ack)", () => {
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "walls", playerCount: 1, delayTicks: D });
    p.reconcile(snapWith(0, 104, 0));
    p.push(frame(0, 0, 1));
    p.tick();
    expect(p.predictedX).toBeCloseTo(104 + MOVE_PER_TICK);
  });

  it("frames of other players never move my shadow", () => {
    const p = createPredictor({ framePlayer: 1, snapPlayer: 1, bounds: "walls", playerCount: 2, delayTicks: D });
    p.reconcile(snapWith(1, 104, 0));
    p.push(frame(0, 0, 1));
    p.tick();
    expect(p.predictedX).toBeCloseTo(104);
  });

  it("steady input: reconcile at the acked tick finds NO error (no offset smothering)", () => {
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "walls", playerCount: 1, delayTicks: D });
    // Host sim: consumes input t at sim tick t+D, moves the same math.
    let simX = 104;
    p.reconcile(snapWith(0, simX, 0));
    for (let t = 0; t < 30; t++) {
      p.push(frame(0, t, 1));
      p.tick();
      simX = Math.min(FIELD_W - PADDLE_W / 2, simX + MOVE_PER_TICK);
      if (t % 2 === 0) p.reconcile(snapWith(0, simX, t + D));
    }
    expect(Math.abs(p.offset)).toBeLessThanOrEqual(RECONCILE_EPSILON * 2);
    expect(p.predictedX).toBeCloseTo(simX, 1);
  });

  it("divergence snaps prediction and folds the error into a decaying offset", () => {
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "walls", playerCount: 1, delayTicks: D });
    p.reconcile(snapWith(0, 104, 0));
    for (let t = 0; t < 5; t++) {
      p.push(frame(0, t, 0));
      p.tick();
    }
    // Authoritative jumps +12 (captive effect, host correction, anything).
    p.reconcile(snapWith(0, 116, 4 + D));
    expect(p.predictedX).toBeCloseTo(116);
    expect(p.offset).toBeCloseTo(12, 0);
    const before = p.displayX();
    // Display settles back onto prediction as the offset decays ~0.5 s.
    for (let i = 0; i < 30; i++) p.tick();
    const after = p.displayX();
    expect(Math.abs(after - p.predictedX)).toBeLessThan(Math.abs(before - p.predictedX));
    expect(Math.abs(p.offset)).toBeLessThan(12 * 0.5);
  });

  it("offset decay constant reaches ~5% after 0.5 s (30 ticks)", () => {
    const remaining = OFFSET_DECAY_PER_TICK ** 30;
    expect(remaining).toBeGreaterThan(0.01);
    expect(remaining).toBeLessThan(0.1);
  });

  it("prediction never runs past the wall clamp", () => {
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "walls", playerCount: 1, delayTicks: D });
    p.reconcile(snapWith(0, 200, 0));
    for (let t = 0; t < 60; t++) {
      p.push(frame(0, t, 1));
      p.tick();
    }
    expect(p.predictedX).toBeCloseTo(FIELD_W - PADDLE_W / 2, 5);
  });

  it("sharedField slice: prediction clamps inside its own slice", () => {
    const snap = snapWith(1, 78, 0);
    const p = createPredictor({ framePlayer: 1, snapPlayer: 1, bounds: "sharedSlice", playerCount: 2, delayTicks: 0 });
    p.reconcile(snap);
    for (let t = 1; t <= 60; t++) {
      p.push(frame(1, t, 1));
      p.tick();
    }
    const sliceHi = FIELD_W - PADDLE_W / 2;
    expect(p.predictedX).toBeCloseTo(sliceHi, 5);
  });

  it("duel: prediction blocks against the other paddle — display never settles short", () => {
    // The prototype's failure mode: without the other-paddle clamp,
    // prediction runs ahead INTO the other paddle while the sim blocks at
    // flush; reconcile then reads the block as error and the display
    // settles short of the other paddle — a gap that stays open.
    const other = otherPlayer(1, 120);
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "duelWall", playerCount: 2, delayTicks: D });
    p.reconcile(snapWith(0, 60, 0, [other]));
    const flush = 120 - PADDLE_W; // me flush against the stationary other
    // Input exactly long enough to reach flush, then release: the sim
    // blocks at flush and the other paddle never gets pushed.
    for (let t = 1; t <= 60; t++) {
      p.push(frame(0, t, t <= 12 ? 1 : 0));
      p.tick();
    }
    p.reconcile(snapWith(0, flush, 60 + D, [other]));
    expect(p.predictedX).toBeCloseTo(flush, 1);
    expect(p.displayX()).toBeCloseTo(flush, 1);
    expect(Math.abs(p.offset)).toBeLessThan(1);
  });

  it("reset wipes history + prediction and reseeds from the snapshot", () => {
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "walls", playerCount: 1, delayTicks: D });
    p.reconcile(snapWith(0, 104, 0));
    for (let t = 0; t < 10; t++) {
      p.push(frame(0, t, 1));
      p.tick();
    }
    p.reset(snapWith(0, 80, 40));
    expect(p.predictedX).toBeCloseTo(80);
    expect(p.offset).toBe(0);
    // Old history is gone: a tick without fresh input holds position.
    p.tick();
    expect(p.predictedX).toBeCloseTo(80);
  });
});
