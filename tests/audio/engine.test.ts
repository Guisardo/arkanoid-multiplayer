import { describe, expect, it } from "vitest";
import { AudioEngine, type AudioBufferLike, type AudioContextLike, type GainNodeLike } from "audio/engine";
import { brickPitch, chainLevel, sfxForEvent, chainEscalation } from "audio/eventMap";
import type { SimEvent } from "shared/protocol";

// ---- Fake WebAudio for headless tests ----
class FakeParam {
  value = 1;
}
class FakeGain implements GainNodeLike {
  gain = new FakeParam();
  connectedTo: AudioNode[] = [];
  connect(node: AudioNode): AudioNode {
    this.connectedTo.push(node);
    return node;
  }
  disconnect(): void {
    this.connectedTo = [];
  }
}
class FakeSource {
  buffer: AudioBufferLike | null = null;
  playbackRate = new FakeParam();
  started = false;
  stopped = false;
  connect(): this {
    return this;
  }
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
  disconnect(): void {}
}
class FakeBuffer implements AudioBufferLike {
  constructor(readonly duration: number) {}
  getChannelData(): Float32Array {
    return new Float32Array(0);
  }
}
class FakeCtx implements AudioContextLike {
  readonly sampleRate = 48000;
  readonly destination = new FakeGain();
  sources: FakeSource[] = [];
  createBuffer(): AudioBufferLike {
    return new FakeBuffer(0.1);
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createGain(): GainNodeLike {
    return new FakeGain();
  }
  decodeAudioData(): Promise<AudioBufferLike> {
    return Promise.resolve(new FakeBuffer(0.2));
  }
}

describe("AudioEngine", () => {
  it("lazily creates context; null factory → no-op everywhere", () => {
    const engine = new AudioEngine(() => null);
    expect(engine.ensureContext()).toBe(false);
    engine.playSfx("brickHit");
    engine.playMusic("level");
    expect(engine.playingMusic).toBeNull();
  });

  it("volumes apply to gain nodes; mute zeroes both buses", () => {
    const engine = new AudioEngine(() => new FakeCtx());
    engine.ensureContext();
    engine.setVolumes({ music: 0.5, sfx: 0.25 });
    expect(engine.getVolumes()).toEqual({ music: 0.5, sfx: 0.25, mute: false });
    engine.setVolumes({ mute: true });
    const v = engine.getVolumes();
    expect(v.mute).toBe(true);
  });

  it("playSfx starts a source with pitch and gain", () => {
    const ctx = new FakeCtx();
    const engine = new AudioEngine(() => ctx);
    engine.ensureContext();
    engine.registerBuffer("sfx:brickHit", new FakeBuffer(0.1));
    engine.playSfx("brickHit", { pitch: 1.5, gain: 0.6 });
    const src = ctx.sources[0]!;
    expect(src.started).toBe(true);
    expect(src.playbackRate.value).toBe(1.5);
    expect(src.buffer).not.toBeNull();
  });

  it("playMusic loops one track; same track is a no-op; stopMusic clears", () => {
    const ctx = new FakeCtx();
    const engine = new AudioEngine(() => ctx);
    engine.ensureContext();
    engine.registerBuffer("music:level", new FakeBuffer(10));
    engine.playMusic("level");
    expect(engine.playingMusic).toBe("level");
    engine.playMusic("level");
    expect(ctx.sources).toHaveLength(1);
    engine.stopMusic();
    expect(engine.playingMusic).toBeNull();
    expect(ctx.sources[0]!.stopped).toBe(true);
  });

  it("switching tracks stops the previous source", () => {
    const ctx = new FakeCtx();
    const engine = new AudioEngine(() => ctx);
    engine.ensureContext();
    engine.registerBuffer("music:level", new FakeBuffer(10));
    engine.registerBuffer("music:boss", new FakeBuffer(10));
    engine.playMusic("level");
    engine.playMusic("boss");
    expect(ctx.sources[0]!.stopped).toBe(true);
    expect(engine.playingMusic).toBe("boss");
  });
});

describe("event mapping (spec §13)", () => {
  it("brick pitch: top row high, bottom row low", () => {
    expect(brickPitch(0)).toBeCloseTo(1.6);
    expect(brickPitch(17)).toBeCloseTo(0.8);
    expect(brickPitch(0)).toBeGreaterThan(brickPitch(17));
  });

  it("chain level counts consecutive brickBreaks, resets on launch/loss", () => {
    const events: SimEvent[] = [
      { type: "ballLaunch", source: 0, target: -1, tick: 0 },
      { type: "brickBreak", source: 0, target: 0, tick: 1 },
      { type: "brickBreak", source: 0, target: 1, tick: 2 },
      { type: "brickBreak", source: 0, target: 2, tick: 3 },
      { type: "ballLoss", source: 0, target: -1, tick: 4 },
      { type: "brickBreak", source: 0, target: 3, tick: 5 },
    ];
    expect(chainLevel(events, 3)).toBe(3);
    expect(chainLevel(events, 5)).toBe(1);
    expect(chainLevel(events, 10)).toBe(1);
  });

  it("sfxForEvent maps every spec'd event", () => {
    expect(sfxForEvent({ type: "brickBreak", source: 0, target: 0, tick: 0 })?.id).toBe("brickHit");
    expect(sfxForEvent({ type: "ballLaunch", source: 0, target: -1, tick: 0 })?.id).toBe("launch");
    expect(sfxForEvent({ type: "ballLoss", source: 0, target: -1, tick: 0 })?.id).toBe("ballLoss");
    expect(sfxForEvent({ type: "capsuleCatch", source: 0, target: -1, tick: 0 })?.id).toBe("capsuleCatch");
    expect(sfxForEvent({ type: "roundClear", source: 0, target: -1, tick: 0 })?.id).toBe("roundClear");
    expect(sfxForEvent({ type: "attack", source: 0, target: 1, tick: 0 })?.id).toBe("attack");
    expect(sfxForEvent({ type: "assist", source: 0, target: 1, tick: 0 })?.id).toBe("assist");
    expect(sfxForEvent({ type: "pause", source: 0, target: -1, tick: 0 })).toBeNull();
  });

  it("chain escalation fires exactly at tiers 4/7/10", () => {
    for (const n of [1, 2, 3, 5, 6, 8, 9, 11]) {
      expect(chainEscalation(n)).toBe(false);
    }
    for (const n of [4, 7, 10]) {
      expect(chainEscalation(n)).toBe(true);
    }
  });
});
