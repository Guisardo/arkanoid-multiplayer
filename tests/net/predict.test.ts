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
import { EMPTY_ACTIONS, NO_INPUT_ACK } from "shared/protocol";

const D = 4;
const MOVE_PER_TICK = PADDLE_VMAX * (TICK_MS / 1000);

function frame(player: number, tick: number, axisX: number): InputFrame {
  return { player, tick, axisX, axisY: 0, launch: false, primaryHeld: false, actions: EMPTY_ACTIONS };
}

/**
 * Snapshot whose every slot acks Match tick `ack`. The default mirrors a host
 * that consumes frame t at sim tick t + D within one Sim epoch.
 */
function snapWith(
  player: number,
  x: number,
  tick: number,
  extra: Snapshot["players"] = [],
  stamp: { epoch?: number; ack?: number } = {},
): Snapshot {
  const ack = stamp.ack ?? (tick - D >= 0 ? tick - D : NO_INPUT_ACK);
  return {
    tick,
    phase: "play",
    round: 1,
    epoch: stamp.epoch ?? 0,
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
    inputAcks: [player, ...extra].map(() => ack),
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
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "walls", playerCount: 1 });
    p.reconcile(snapWith(0, 42, 10));
    expect(p.predictedX).toBeCloseTo(42);
    expect(p.offset).toBe(0);
  });

  it("own paddle advances instantly on input (ahead of the ack)", () => {
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "walls", playerCount: 1 });
    p.reconcile(snapWith(0, 104, 0));
    p.push(frame(0, 0, 1));
    p.tick();
    expect(p.predictedX).toBeCloseTo(104 + MOVE_PER_TICK);
  });

  it("held fire and Laser arming leave paddle prediction untouched (ticket #141)", () => {
    const opts = { framePlayer: 0, snapPlayer: 0, bounds: "walls" as const, playerCount: 1 };
    const plain = createPredictor(opts);
    const armed = createPredictor(opts);
    const armedSnap = (x: number, tick: number): Snapshot => {
      const s = snapWith(0, x, tick);
      return {
        ...s,
        players: s.players.map((p) => ({ ...p, effects: { L: 1 } })),
        bolts: [{ x: x - 10, y: 200, owner: 0 }, { x: x + 10, y: 200, owner: 0 }],
      };
    };
    plain.reconcile(snapWith(0, 104, 0));
    armed.reconcile(armedSnap(104, 0));
    const axes = [1, 1, 0, -1, -1, -1, 0, 1, 0.5, 0.5];
    axes.forEach((axis, t) => {
      plain.push(frame(0, t, axis));
      armed.push({ ...frame(0, t, axis), primaryHeld: t % 3 !== 0, launch: t === 2 });
      plain.tick();
      armed.tick();
      if (t % 2 === 1) {
        plain.reconcile(snapWith(0, 104 + t, t + D));
        armed.reconcile(armedSnap(104 + t, t + D));
      }
      expect(armed.predictedX).toBe(plain.predictedX);
      expect(armed.offset).toBe(plain.offset);
      expect(armed.displayX()).toBe(plain.displayX());
    });
  });

  it("frames of other players never move my shadow", () => {
    const p = createPredictor({ framePlayer: 1, snapPlayer: 1, bounds: "walls", playerCount: 2 });
    p.reconcile(snapWith(1, 104, 0));
    p.push(frame(0, 0, 1));
    p.tick();
    expect(p.predictedX).toBeCloseTo(104);
  });

  it("steady input: reconcile at the acked tick finds NO error (no offset smothering)", () => {
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "walls", playerCount: 1 });
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
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "walls", playerCount: 1 });
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
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "walls", playerCount: 1 });
    p.reconcile(snapWith(0, 200, 0));
    for (let t = 0; t < 60; t++) {
      p.push(frame(0, t, 1));
      p.tick();
    }
    expect(p.predictedX).toBeCloseTo(FIELD_W - PADDLE_W / 2, 5);
  });

  it("sharedField slice: prediction clamps inside its own slice", () => {
    const snap = snapWith(1, 78, 0);
    const p = createPredictor({ framePlayer: 1, snapPlayer: 1, bounds: "sharedSlice", playerCount: 2 });
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
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "duelWall", playerCount: 2 });
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
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "walls", playerCount: 1 });
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

describe("predictor across Sim epochs (ticket #155)", () => {
  /**
   * Host model: consumes Match tick t's frame at Match tick t + D; the field's
   * sim is replaced at `rebuildAt` (paddle back to center, sim tick from 0).
   * Snapshots go out every 2 ticks, acking the newest consumed Match tick.
   */
  function runAcrossRebuild(rebuildAt: number, until: number) {
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "walls", playerCount: 1 });
    const lo = PADDLE_W / 2;
    const hi = FIELD_W - PADDLE_W / 2;
    const axisAt = (t: number): number => (Math.floor(t / 20) % 2 === 0 ? 1 : -1);
    let hostX = FIELD_W / 2;
    let epoch = 0;
    let epochStart = 0;
    const offsets: { t: number; offset: number }[] = [];
    p.reconcile(snapWith(0, hostX, 0, [], { ack: NO_INPUT_ACK }));
    for (let t = 0; t <= until; t++) {
      p.push(frame(0, t, axisAt(t)));
      p.tick();
      if (t === rebuildAt) {
        epoch++;
        epochStart = t;
        hostX = FIELD_W / 2;
      }
      const consumed = t - D;
      if (consumed >= 0) hostX = Math.max(lo, Math.min(hi, hostX + axisAt(consumed) * MOVE_PER_TICK));
      if (t % 2 === 0) {
        p.reconcile(snapWith(0, hostX, t - epochStart, [], { epoch, ack: consumed >= 0 ? consumed : NO_INPUT_ACK }));
        offsets.push({ t, offset: Math.abs(p.offset) });
      }
    }
    return { p, offsets, hostX };
  }

  it("reconciles at the acked Match tick after the sim's ticks restart", () => {
    // Regression: consumed was snap.tick − D, so once a rebuilt sim restarted
    // at tick 0 no trail entry matched and every snapshot compared the lagged
    // authoritative paddle with the current prediction: rubber-banding.
    const { offsets } = runAcrossRebuild(600, 900);
    const settled = offsets.filter((o) => o.t >= 660);
    const worst = Math.max(...settled.map((o) => o.offset));
    expect(worst).toBeLessThanOrEqual(RECONCILE_EPSILON * 2);
  });

  it("restarts from the new sim's paddle on a newer epoch (clean cut)", () => {
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "walls", playerCount: 1 });
    p.reconcile(snapWith(0, 40, 600, [], { epoch: 0, ack: 596 }));
    p.reconcile(snapWith(0, FIELD_W / 2, 2, [], { epoch: 1, ack: 598 }));
    expect(p.predictedX).toBeCloseTo(FIELD_W / 2);
    expect(p.offset).toBe(0);
  });

  it("ignores a late snapshot from an older epoch", () => {
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "walls", playerCount: 1 });
    p.reconcile(snapWith(0, 104, 4, [], { epoch: 1, ack: 600 }));
    p.reconcile(snapWith(0, 30, 900, [], { epoch: 0, ack: 590 }));
    expect(p.predictedX).toBeCloseTo(104);
    expect(p.offset).toBe(0);
  });

  it("an epoch wrap still counts as newer", () => {
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "walls", playerCount: 1 });
    p.reconcile(snapWith(0, 40, 300, [], { epoch: 0xffff, ack: 296 }));
    p.reconcile(snapWith(0, 90, 0, [], { epoch: 0, ack: 298 }));
    expect(p.predictedX).toBeCloseTo(90);
  });

  it("no ack yet: the host consumed nothing, so prediction is left alone", () => {
    const p = createPredictor({ framePlayer: 0, snapPlayer: 0, bounds: "walls", playerCount: 1 });
    p.reconcile(snapWith(0, 104, 0, [], { ack: NO_INPUT_ACK }));
    for (let t = 0; t < 3; t++) {
      p.push(frame(0, t, 1));
      p.tick();
    }
    p.reconcile(snapWith(0, 104, 900, [], { ack: NO_INPUT_ACK }));
    expect(p.predictedX).toBeCloseTo(104 + 3 * MOVE_PER_TICK);
    expect(p.offset).toBe(0);
  });

  it("reads its own slot's ack in a multi-player snapshot", () => {
    const p = createPredictor({ framePlayer: 0, snapPlayer: 1, bounds: "walls", playerCount: 2 });
    const seed = snapWith(1, 104, 0, [otherPlayer(0, 50)], { ack: NO_INPUT_ACK });
    p.reconcile(seed);
    for (let t = 0; t < 10; t++) {
      p.push(frame(0, t, 1));
      p.tick();
    }
    // Slot 0 holds me (player 1) and acks frame 5; slot 1 holds the other
    // player with an unrelated ack. The compare must use slot 0's ack.
    const s = snapWith(1, 104 + 6 * MOVE_PER_TICK, 30, [otherPlayer(0, 50)]);
    p.reconcile({ ...s, inputAcks: [5, 9] });
    expect(Math.abs(p.offset)).toBeLessThanOrEqual(RECONCILE_EPSILON);
  });
});
