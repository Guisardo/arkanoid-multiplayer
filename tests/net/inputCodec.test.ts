import { describe, expect, it } from "vitest";
import {
  encodeInputBatch,
  decodeInputBatch,
  redundancyWindow,
  INPUT_BATCH_MAX,
} from "net/inputCodec";
import { EMPTY_ACTIONS, type InputFrame } from "shared/protocol";

function frame(player: number, tick: number, axisX: number, launch = false): InputFrame {
  return { player, tick, axisX, axisY: 0, launch, actions: EMPTY_ACTIONS };
}

describe("input codec (spec §9)", () => {
  it("round-trips a single frame losslessly (within axis quantization)", () => {
    const f = frame(0, 42, -95 / 127, true);
    const back = decodeInputBatch(encodeInputBatch([f]));
    expect(back).toEqual([f]);
  });

  it("axis quantizes to 1/127 steps (documented lossiness)", () => {
    const back = decodeInputBatch(encodeInputBatch([frame(0, 1, -0.75)]));
    expect(back[0]!.axisX).toBeCloseTo(-95 / 127, 10);
  });

  it("round-trips a redundancy batch", () => {
    const frames = [frame(1, 50, 0.25), frame(1, 51, 0.5, true), frame(1, 52, -1)];
    const back = decodeInputBatch(encodeInputBatch(frames));
    expect(back).toHaveLength(3);
    expect(back.map((f) => f.tick)).toEqual([50, 51, 52]);
    expect(back[1]!.launch).toBe(true);
  });

  it("quantizes axes to 1/127 steps", () => {
    const f = frame(0, 1, 0.003);
    const back = decodeInputBatch(encodeInputBatch([f]));
    expect(back[0]!.axisX).toBeCloseTo(Math.round(0.003 * 127) / 127, 10);
  });

  it("clamps out-of-range axes on encode", () => {
    const back = decodeInputBatch(encodeInputBatch([frame(0, 1, 5)]));
    expect(back[0]!.axisX).toBe(1);
  });

  it("carries all action flags", () => {
    const f: InputFrame = {
      player: 0,
      tick: 7,
      axisX: 0,
      axisY: 0,
      launch: true,
      actions: {
        cycleForward: true,
        cycleBack: true,
        fire: [true, false, true, true],
      },
    };
    const back = decodeInputBatch(encodeInputBatch([f]));
    expect(back[0]!.actions).toEqual(f.actions);
    expect(back[0]!.launch).toBe(true);
  });

  it("per-frame player byte carries device-local index", () => {
    const back = decodeInputBatch(encodeInputBatch([frame(1, 3, 0)]));
    expect(back[0]!.player).toBe(1);
  });

  it("rejects empty batches", () => {
    expect(() => encodeInputBatch([])).toThrow();
  });

  it("rejects oversized batches", () => {
    const frames = Array.from({ length: INPUT_BATCH_MAX + 1 }, (_, i) => frame(0, i, 0));
    expect(() => encodeInputBatch(frames)).toThrow();
  });

  it("throws on truncated payloads (host drops, never crashes)", () => {
    const buf = encodeInputBatch([frame(0, 1, 0), frame(0, 2, 0)]);
    const truncated = buf.slice(0, 6);
    expect(() => decodeInputBatch(truncated)).toThrow(/malformed/);
  });

  it("throws on unknown kind byte", () => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint8(0, 99);
    expect(() => decodeInputBatch(buf)).toThrow(/malformed/);
  });

  it("throws on absurd frame counts", () => {
    const buf = new ArrayBuffer(32);
    const view = new DataView(buf);
    view.setUint8(0, 1);
    view.setUint8(1, 200);
    expect(() => decodeInputBatch(buf)).toThrow(/malformed/);
  });

  it("fuzz: random bytes never decode silently wrong — throw or valid frames", () => {
    let seed = 12345;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 200; i++) {
      const len = 1 + Math.floor(rand() * 40);
      const buf = new ArrayBuffer(len);
      const bytes = new Uint8Array(buf);
      for (let j = 0; j < len; j++) bytes[j] = Math.floor(rand() * 256);
      try {
        const frames = decodeInputBatch(buf);
        for (const f of frames) {
          expect(f.player).toBeGreaterThanOrEqual(0);
          expect(f.player).toBeLessThanOrEqual(255);
          expect(Number.isFinite(f.axisX)).toBe(true);
          expect(Math.abs(f.axisX)).toBeLessThanOrEqual(1.01);
        }
      } catch (err) {
        expect((err as Error).message).toMatch(/malformed/);
      }
    }
  });

  it("redundancy window keeps the newest frames", () => {
    const history = Array.from({ length: 20 }, (_, i) => frame(0, i, 0));
    const win = redundancyWindow(history, 10);
    expect(win).toHaveLength(10);
    expect(win[0]!.tick).toBe(10);
    expect(win[9]!.tick).toBe(19);
  });
});
