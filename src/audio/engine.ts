// Audio engine (spec §13): SFX + music over WebAudio. Never blocks the
// sim/render loop — decode at init, trigger off the hot path. Chiptune
// aesthetic; procedural jsfxr-style synthesis fills gaps until CC0 packs
// are committed (asset commit lands with ticket 29/30 content pass).
export interface AudioVolumes {
  music: number;
  sfx: number;
  mute: boolean;
}

export type SfxEventId =
  | "brickHit"
  | "chainEscalate"
  | "paddleHit"
  | "wallHit"
  | "capsuleCatch"
  | "capsuleEffect"
  | "ballLoss"
  | "roundClear"
  | "attack"
  | "assist"
  | "launch";

export type MusicTrackId = "level" | "boss" | "roundIntro" | "gameOver";

/** Minimal AudioContext surface the engine needs (injectable for tests). */
export interface AudioContextLike {
  readonly sampleRate: number;
  readonly destination: AudioNode;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  createGain(): GainNodeLike;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
}

export interface AudioBufferLike {
  readonly duration: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null;
  playbackRate: AudioParamLike;
  connect(node: AudioNode): AudioBufferSourceNodeLike;
  start(when?: number): void;
  stop(when?: number): void;
  disconnect(): unknown;
}

export interface AudioParamLike {
  value: number;
}

export interface GainNodeLike extends AudioNode {
  gain: AudioParamLike;
}

export interface AudioNode {
  connect(node: AudioNode): AudioNode;
  disconnect(): unknown;
}

export type AudioContextFactory = () => AudioContextLike | null;

export class AudioEngine {
  private ctx: AudioContextLike | null = null;
  private masterGain: GainNodeLike | null = null;
  private musicGain: GainNodeLike | null = null;
  private sfxGain: GainNodeLike | null = null;
  private readonly buffers = new Map<string, AudioBufferLike>();
  private readonly musicSources = new Set<AudioBufferSourceNodeLike>();
  private volumes: AudioVolumes = { music: 0.8, sfx: 0.8, mute: false };
  private currentMusic: MusicTrackId | null = null;

  constructor(private readonly factory: AudioContextFactory) {}

  /** Init lazily (browser autoplay policies require a user gesture). */
  ensureContext(): boolean {
    if (this.ctx) return true;
    const ctx = this.factory();
    if (!ctx) return false;
    this.ctx = ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.connect(this.masterGain);
    this.sfxGain = ctx.createGain();
    this.sfxGain.connect(this.masterGain);
    this.applyVolumes();
    return true;
  }

  setVolumes(v: Partial<AudioVolumes>): void {
    this.volumes = { ...this.volumes, ...v };
    this.applyVolumes();
  }

  getVolumes(): AudioVolumes {
    return { ...this.volumes };
  }

  private applyVolumes(): void {
    if (!this.masterGain || !this.musicGain || !this.sfxGain) return;
    const m = this.volumes.mute ? 0 : this.volumes.music;
    const s = this.volumes.mute ? 0 : this.volumes.sfx;
    this.masterGain.gain.value = 1;
    this.musicGain.gain.value = m;
    this.sfxGain.gain.value = s;
  }

  /** Register a decoded buffer under an id (music tracks, committed assets). */
  registerBuffer(id: string, buffer: AudioBufferLike): void {
    this.buffers.set(id, buffer);
  }

  /** Fire an SFX: pitch multiplier + gain, off the hot path. */
  playSfx(id: SfxEventId, opts: { pitch?: number; gain?: number } = {}): void {
    if (!this.ensureContext() || !this.ctx || !this.sfxGain) return;
    const buffer = this.buffers.get(`sfx:${id}`);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = opts.pitch ?? 1;
    const g = this.ctx.createGain();
    g.gain.value = opts.gain ?? 1;
    src.connect(g).connect(this.sfxGain);
    src.start();
  }

  /** Loop a music track; stops any current track first. */
  playMusic(id: MusicTrackId): void {
    if (!this.ensureContext() || !this.ctx || !this.musicGain) return;
    if (this.currentMusic === id) return;
    this.stopMusic();
    const buffer = this.buffers.get(`music:${id}`);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.musicGain);
    src.start();
    this.musicSources.add(src);
    this.currentMusic = id;
  }

  stopMusic(): void {
    for (const src of this.musicSources) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
      src.disconnect();
    }
    this.musicSources.clear();
    this.currentMusic = null;
  }

  get playingMusic(): MusicTrackId | null {
    return this.currentMusic;
  }
}
