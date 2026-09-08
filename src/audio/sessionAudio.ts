// Session audio glue (ticket 30 debt, spec §13): builds the AudioEngine,
// registers synthesized buffers, and turns snapshot event-ring entries into
// SFX + music-state changes. Pure event consumption — the session feeds it
// snapshots; it never touches the sim or the DOM.
import { AudioEngine, type AudioBufferLike, type MusicTrackId, type SfxEventId } from "./engine";
import { chainEscalation, sfxForEvent } from "./eventMap";
import { synthMusic, synthSfx, type SynthData } from "./synth";
import type { Snapshot } from "shared/protocol";

export type { AudioVolumes } from "./engine";

/** Factory seam: sessions inject the platform AudioContext constructor. */
export type AudioContextFactory = () => AudioContext | null;

/** Context surface needed for buffer conversion (subset of AudioContextLike). */
interface BufferFactory {
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
}

/** Convert synthesized data into a real AudioBuffer via the live context. */
function toAudioBuffer(ctx: BufferFactory, s: SynthData): AudioBufferLike {
  const buffer = ctx.createBuffer(1, s.data.length, s.sampleRate);
  buffer.getChannelData(0).set(s.data);
  return buffer;
}
export interface SessionAudio {
  /**
   * User-gesture unlock (browser autoplay policy): creates the context and
   * registers the synthesized buffers. Idempotent; call from the first
   * input/launch handler. consume() is a no-op until this succeeds.
   */
  unlock(): void;
  /** Feed every snapshot; fires SFX for new ring events + music changes. */
  consume(snap: Snapshot): void;
  /** Apply Settings volumes live (sliders + mute). */
  setVolumes(v: { music: number; sfx: number; mute: boolean }): void;
  /** Stop all audio (session teardown). */
  dispose(): void;
}

export function createSessionAudio(factory: AudioContextFactory): SessionAudio {
  const engine = new AudioEngine(factory as never);
  let ctxReady = false;
  let lastEventTick = -1;
  let chain = 0;
  let currentMusic: MusicTrackId | null = null;

  function fireSfx(id: SfxEventId, pitch?: number, gain?: number): void {
    engine.playSfx(id, pitch === undefined ? {} : { pitch, ...(gain !== undefined ? { gain } : {}) });
  }

  function musicFor(snap: Snapshot): MusicTrackId | null {
    if (snap.phase === "gameOver") return "gameOver";
    if (snap.boss !== undefined) return "boss";
    if (snap.phase === "serve") return "level";
    return null; // play / roundClear keep the current track
  }

  return {
    unlock() {
      if (ctxReady) return;
      let ctx: ReturnType<AudioContextFactory> = null;
      try {
        ctx = factory();
      } catch {
        ctx = null;
      }
      if (ctx === null) return;
      if (!engine.ensureContext()) return;
      // Real AudioBuffers via the live context — browsers reject plain
      // objects on AudioBufferSourceNode.buffer.
      for (const [id, s] of Object.entries(synthSfx())) {
        engine.registerBuffer(id, toAudioBuffer(ctx, s));
      }
      for (const [id, s] of Object.entries(synthMusic())) {
        engine.registerBuffer(id, toAudioBuffer(ctx, s));
      }
      ctxReady = true;
    },
    consume(snap: Snapshot): void {
      if (!ctxReady) return;
      // New ring entries only: the ring keeps the last 8 events; anything
      // at or before the watermark already fired.
      const fresh = snap.events.filter((e) => e.tick > lastEventTick);
      const newest = fresh[fresh.length - 1];
      if (newest !== undefined) lastEventTick = newest.tick;
      for (const event of fresh) {
        const sfx = sfxForEvent(event);
        if (sfx !== null) fireSfx(sfx.id, sfx.pitch, sfx.gain);
        if (event.type === "brickBreak") {
          chain++;
          if (chainEscalation(chain)) fireSfx("chainEscalate");
        } else if (event.type === "ballLaunch" || event.type === "ballLoss") {
          chain = 0;
        }
      }
      const track = musicFor(snap);
      if (track !== null && track !== currentMusic) {
        engine.playMusic(track);
        currentMusic = track;
      }
    },
    setVolumes(v: { music: number; sfx: number; mute: boolean }): void {
      engine.setVolumes(v);
    },
    dispose() {
      engine.stopMusic();
      ctxReady = false;
    },
  };
}
