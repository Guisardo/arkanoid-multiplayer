// Laser audio (ticket #148, spec #140 Variant C): a soft triangle tick on
// fire, a sine blip on a Bolt's Brick hit (replacing the ball brick sound),
// a dull low square clank on gold, and no ready chime.
import { describe, expect, it } from "vitest";
import { sfxForEvent } from "audio/eventMap";
import { createSessionAudio } from "audio/sessionAudio";
import type { AudioBufferLike, AudioContextLike, GainNodeLike } from "audio/engine";
import { SAMPLE_RATE, synthSfx } from "audio/synth";
import type { SimEvent, Snapshot } from "shared/protocol";

const ev = (type: SimEvent["type"], target = -1, tick = 10, source = 0): SimEvent => ({ type, source, target, tick });

/** Dominant frequency of a window via zero crossings (Hz). */
function zeroCrossingHz(data: Float32Array, from: number, to: number): number {
  let crossings = 0;
  for (let i = from + 1; i < to; i++) {
    const a = data[i - 1] ?? 0;
    const b = data[i] ?? 0;
    if ((a <= 0 && b > 0) || (a >= 0 && b < 0)) crossings++;
  }
  return crossings / 2 / ((to - from) / SAMPLE_RATE);
}

describe("laser SFX mapping", () => {
  it("laserFire → fire tick, boltHit → blip, boltGoldHit → clank", () => {
    expect(sfxForEvent(ev("laserFire"))?.id).toBe("laserFire");
    expect(sfxForEvent(ev("boltHit", 40))?.id).toBe("boltHit");
    expect(sfxForEvent(ev("boltGoldHit", 40))?.id).toBe("boltGold");
  });

  it("a Bolt's Brick break plays the blip only, not the ball brick sound", () => {
    const hit = ev("boltHit", 40);
    expect(sfxForEvent(ev("brickBreak", 40), hit)).toBeNull();
    expect(sfxForEvent(ev("brickSilverHit", 40), hit)).toBeNull();
  });

  it("a ball break keeps its sound, even right after a Bolt hit elsewhere", () => {
    expect(sfxForEvent(ev("brickBreak", 41), ev("boltHit", 40))?.id).toBe("brickHit");
    expect(sfxForEvent(ev("brickBreak", 40, 11), ev("boltHit", 40, 10))?.id).toBe("brickHit");
    expect(sfxForEvent(ev("brickBreak", 40))?.id).toBe("brickHit");
  });
});

describe("laser SFX synthesis", () => {
  const sfx = synthSfx();

  it("fire: ~50 ms triangle sweeping ~700 → ~500 Hz", () => {
    const s = sfx["sfx:laserFire"];
    if (s === undefined) throw new Error("sfx:laserFire missing");
    const ms = (s.data.length / SAMPLE_RATE) * 1000;
    expect(ms).toBeGreaterThan(40);
    expect(ms).toBeLessThan(80);
    const q = Math.floor(s.data.length / 4);
    const early = zeroCrossingHz(s.data, 0, q);
    const late = zeroCrossingHz(s.data, 2 * q, 3 * q);
    expect(early).toBeGreaterThan(late);
    expect(early).toBeGreaterThan(600);
    expect(early).toBeLessThan(760);
    expect(late).toBeGreaterThan(460);
    expect(late).toBeLessThan(600);
  });

  it("gold clank is low (well under the blip's pitch) and short", () => {
    const clank = sfx["sfx:boltGold"];
    const blip = sfx["sfx:boltHit"];
    if (clank === undefined || blip === undefined) throw new Error("laser hit buffers missing");
    const n = Math.floor(clank.data.length / 2);
    expect(zeroCrossingHz(clank.data, 0, n)).toBeLessThan(200);
    expect(zeroCrossingHz(blip.data, 0, Math.floor(blip.data.length / 2))).toBeGreaterThan(600);
    expect(clank.data.length / SAMPLE_RATE).toBeLessThan(0.15);
  });

  it("there is no ready chime", () => {
    expect(Object.keys(sfx).filter((k) => /ready/i.test(k))).toEqual([]);
  });
});

describe("laser SFX through the session glue", () => {
  /** Minimal fake WebAudio: records the duration of every started buffer. */
  function fakeCtx(): { ctx: AudioContextLike; played: number[] } {
    const played: number[] = [];
    const gain = (): GainNodeLike => ({ gain: { value: 1 }, connect: (n) => n, disconnect: () => undefined });
    const ctx: AudioContextLike = {
      sampleRate: SAMPLE_RATE,
      destination: gain(),
      createBuffer: (_c, length, rate): AudioBufferLike => {
        const data = new Float32Array(length);
        return { duration: length / rate, getChannelData: () => data };
      },
      createBufferSource: () => {
        const src = {
          buffer: null as AudioBufferLike | null,
          playbackRate: { value: 1 },
          connect: () => gain(),
          start: () => {
            played.push(src.buffer?.duration ?? -1);
          },
          stop: () => undefined,
          disconnect: () => undefined,
        };
        return src as never;
      },
      createGain: gain,
      decodeAudioData: () => Promise.reject(new Error("unused")),
    };
    return { ctx, played };
  }

  function snap(events: SimEvent[]): Snapshot {
    return { tick: 10, phase: "play", round: 1, players: [], balls: [], capsules: [], bricks: [], events, inputAcks: [] };
  }

  it("a Bolt break fires one sound (the blip); a ball break fires the brick sound", () => {
    const { ctx, played } = fakeCtx();
    const audio = createSessionAudio(() => ctx as unknown as AudioContext);
    audio.unlock();
    const durations = Object.fromEntries(Object.entries(synthSfx()).map(([k, v]) => [k, v.data.length / SAMPLE_RATE]));
    audio.consume(snap([ev("laserFire", -1, 9), ev("boltHit", 40), ev("brickBreak", 40)]));
    expect(played).toEqual([durations["sfx:laserFire"], durations["sfx:boltHit"]]);
    played.length = 0;
    audio.consume(snap([ev("brickBreak", 41, 11)]));
    expect(played).toEqual([durations["sfx:brickHit"]]);
  });

  it("Bolt breaks count toward the Chain but never play the escalation", () => {
    const { ctx, played } = fakeCtx();
    const audio = createSessionAudio(() => ctx as unknown as AudioContext);
    audio.unlock();
    const durations = Object.fromEntries(Object.entries(synthSfx()).map(([k, v]) => [k, v.data.length / SAMPLE_RATE]));
    const events = [40, 41, 42, 43].flatMap((cell) => [ev("boltHit", cell), ev("brickBreak", cell)]);
    audio.consume(snap(events));
    expect(played).toEqual(new Array(4).fill(durations["sfx:boltHit"]));
    // The Chain still stands at 4: the next ball break is the 5th, not an escalation tier.
    played.length = 0;
    audio.consume(snap([ev("brickBreak", 44, 11), ev("brickBreak", 45, 11), ev("brickBreak", 46, 11)]));
    expect(played).toEqual([durations["sfx:brickHit"], durations["sfx:brickHit"], durations["sfx:brickHit"], durations["sfx:chainEscalate"]]);
  });
});
