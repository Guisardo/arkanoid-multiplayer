// Audio synthesis tests (ticket 30 debt): deterministic buffers, complete
// id coverage, no clipping. SessionAudio conversion + mapping are covered
// in sessionAudio.test.ts.
import { describe, expect, it } from "vitest";
import { synthMusic, synthSfx } from "audio/synth";

describe("synth determinism + shape", () => {
  it("same call → identical sample data (byte-for-byte)", () => {
    const a = synthSfx();
    const b = synthSfx();
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    for (const key of Object.keys(a)) {
      const da = a[key]?.data;
      const db = b[key]?.data;
      expect(da, key).toBeDefined();
      expect(db, key).toBeDefined();
      expect(da!.length).toBe(db!.length);
      for (let i = 0; i < da!.length; i++) {
        if (da![i] !== db![i]) throw new Error(`buffer ${key} differs at sample ${String(i)}`);
      }
    }
  });

  it("every SfxEventId + MusicTrackId has non-empty data", () => {
    const sfx = synthSfx();
    const sfxIds = [
      "brickHit", "chainEscalate", "paddleHit", "wallHit", "capsuleCatch",
      "capsuleEffect", "ballLoss", "roundClear", "attack", "assist", "launch",
    ];
    for (const id of sfxIds) {
      const s = sfx[`sfx:${id}`];
      expect(s, `sfx:${id}`).toBeDefined();
      expect(s!.data.length).toBeGreaterThan(441); // > 10 ms
    }
    const music = synthMusic();
    for (const id of ["level", "boss", "roundIntro", "gameOver"] as const) {
      const s = music[`music:${id}`];
      expect(s, `music:${id}`).toBeDefined();
      expect(s!.data.length).toBeGreaterThan(4410); // > 100 ms
    }
  });

  it("samples stay in [-1, 1] (no clipping)", () => {
    for (const s of [...Object.values(synthSfx()), ...Object.values(synthMusic())]) {
      for (const v of s.data) {
        expect(Math.abs(v)).toBeLessThanOrEqual(1);
      }
    }
  });
});
