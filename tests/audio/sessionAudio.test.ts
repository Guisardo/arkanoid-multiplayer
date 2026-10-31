// Session audio glue tests (ticket 30 debt): unlock gate, ring-event
// dedupe → SFX firing, music phase transitions, volume application —
// against the real AudioEngine over a fake WebAudio context.
import { describe, expect, it } from "vitest";
import { type AudioBufferLike, type AudioContextLike, type GainNodeLike } from "audio/engine";
import { createSessionAudio } from "audio/sessionAudio";
import type { Snapshot } from "shared/protocol";

// ---- Fake WebAudio (same pattern as engine.test.ts) ----
class FakeParam {
  value = 1;
}
class FakeGain implements GainNodeLike {
  gain = new FakeParam();
  connect(node: AudioNode): AudioNode {
    return node;
  }
  disconnect(): void {}
}
class FakeSource {
  buffer: AudioBufferLike | null = null;
  playbackRate = new FakeParam();
  started = false;
  connect(): this {
    return this;
  }
  start(): void {
    this.started = true;
  }
  stop(): void {}
  disconnect(): void {}
}
class FakeBuffer implements AudioBufferLike {
  samples: Float32Array | null = null;
  constructor(readonly duration: number) {}
  getChannelData(): Float32Array {
    return this.samples ?? new Float32Array(0);
  }
}
class FakeCtx implements AudioContextLike {
  readonly sampleRate = 48000;
  readonly destination = new FakeGain();
  sources: FakeSource[] = [];
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike {
    const b = new FakeBuffer(length / sampleRate);
    b.samples = new Float32Array(length);
    return b;
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
    return Promise.resolve(new FakeBuffer(0.1));
  }
}

function snap(events: Snapshot["events"], phase: Snapshot["phase"], boss = false): Snapshot {
  return {
    tick: 0,
    phase,
    round: 1,
    epoch: 0,
    players: [],
    balls: [],
    capsules: [],
    bricks: [],
    events,
    inputAcks: [],
    ...(boss ? { boss: { x: 104, y: 60, hp: 16, phase: 1, dead: false } } : {}),
  };
}

function makeAudio(): { audio: ReturnType<typeof createSessionAudio>; ctx: FakeCtx } {
  const ctx = new FakeCtx();
  const audio = createSessionAudio(() => ctx as unknown as AudioContext);
  return { audio, ctx };
}

describe("createSessionAudio", () => {
  it("consume() is a no-op before unlock (autoplay policy)", () => {
    const { audio, ctx } = makeAudio();
    audio.consume(snap([{ type: "brickBreak", source: 0, target: 0, tick: 5 }], "play"));
    expect(ctx.sources.length).toBe(0);
  });

  it("unlock registers buffers; consume fires SFX per new ring event", () => {
    const { audio, ctx } = makeAudio();
    audio.unlock();
    audio.consume(snap([{ type: "brickBreak", source: 0, target: 0, tick: 5 }], "serve"));
    // brickBreak → brickHit SFX + serve phase → level music: 2 sources.
    expect(ctx.sources.length).toBe(2);
    const started = ctx.sources.filter((s) => s.started);
    expect(started.length).toBe(2);
  });

  it("ring dedupe: same events never fire twice (watermark)", () => {
    const { audio, ctx } = makeAudio();
    audio.unlock();
    const events: Snapshot["events"] = [{ type: "brickBreak", source: 0, target: 0, tick: 5 }];
    audio.consume(snap(events, "play"));
    const after = ctx.sources.length;
    audio.consume(snap(events, "play")); // same ring again
    expect(ctx.sources.length).toBe(after);
  });

  it("a new Sim epoch fires its events even though ticks restarted (ticket #151)", () => {
    // Regression: the watermark never reset, so Round 2 (a fresh sim at tick 0)
    // stayed silent until it outlasted Round 1.
    const { audio, ctx } = makeAudio();
    audio.unlock();
    audio.consume({ ...snap([{ type: "brickBreak", source: 0, target: 0, tick: 4000 }], "play"), tick: 4001 });
    const after = ctx.sources.length;
    audio.consume({ ...snap([{ type: "brickBreak", source: 0, target: 0, tick: 3 }], "play"), tick: 4, epoch: 1 });
    expect(ctx.sources.length).toBe(after + 1);
  });

  it("each field keeps its own watermark (multi-field sessions, ticket #151)", () => {
    // Two lockstep fields share ticks: a single watermark would drop field 1's
    // brickBreak because field 0's event at the same tick already raised it.
    const { audio, ctx } = makeAudio();
    audio.unlock();
    const events: Snapshot["events"] = [{ type: "brickBreak", source: 0, target: 0, tick: 5 }];
    audio.consume(snap(events, "play"), 0);
    const after = ctx.sources.length;
    audio.consume(snap(events, "play"), 1);
    expect(ctx.sources.length).toBe(after + 1);
    audio.consume(snap(events, "play"), 1);
    expect(ctx.sources.length).toBe(after + 1);
  });

  it("chain escalation fires at 4/7/10 consecutive brickBreaks", () => {
    const { audio, ctx } = makeAudio();
    audio.unlock();
    for (let i = 1; i <= 4; i++) {
      audio.consume(snap([{ type: "brickBreak", source: 0, target: 0, tick: i }], "play"));
    }
    // 4 brickHits + 1 chainEscalate.
    expect(ctx.sources.filter((s) => s.started).length).toBe(5);
  });

  it("music transitions: serve → level, boss snapshot → boss track", () => {
    const { audio, ctx } = makeAudio();
    audio.unlock();
    audio.consume(snap([], "serve"));
    expect(ctx.sources.length).toBe(1); // level music
    audio.consume(snap([], "play", true)); // boss appears
    expect(ctx.sources.length).toBe(2); // boss music
  });

  it("gameOver switches to the game-over track", () => {
    const { audio, ctx } = makeAudio();
    audio.unlock();
    audio.consume(snap([], "serve"));
    audio.consume(snap([], "gameOver"));
    expect(ctx.sources.length).toBe(2);
  });

  it("null factory (no WebAudio) → unlock fails silently, consume stays quiet", () => {
    const audio = createSessionAudio(() => null);
    expect(() => {
      audio.unlock();
      audio.consume(snap([], "serve"));
    }).not.toThrow();
  });

  it("setVolumes + dispose never throw", () => {
    const { audio } = makeAudio();
    audio.setVolumes({ music: 0.5, sfx: 0.2, mute: true });
    audio.dispose();
  });
});
