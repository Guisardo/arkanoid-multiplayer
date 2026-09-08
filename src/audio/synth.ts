// Procedural audio synthesis (ticket 30 debt, spec §13): jsfxr-style SFX
// and chiptune music rendered to raw Float32 sample data — deterministic,
// pure, no assets. The session converts these into real AudioBuffers via
// the live AudioContext (browsers reject plain objects as AudioBuffer);
// pitch variance rides the engine's playbackRate (eventMap), not
// re-synthesis.

export const SAMPLE_RATE = 44100;

/** Deterministic 0..1 RNG (mulberry32) — same seed, same buffers. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rendered sample data: mono Float32 at SAMPLE_RATE. */
export interface SynthData {
  readonly data: Float32Array;
  readonly sampleRate: number;
}

function synth(data: Float32Array): SynthData {
  return { data, sampleRate: SAMPLE_RATE };
}

/** Render `seconds` of audio from a pure sample fn (t in seconds). */
function render(seconds: number, fn: (t: number) => number): SynthData {
  const n = Math.max(1, Math.round(seconds * SAMPLE_RATE));
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = fn(i / SAMPLE_RATE);
  return synth(data);
}

// ---- Oscillators + envelopes ----

function square(phase: number): number {
  return phase % 1 < 0.5 ? 1 : -1;
}

function saw(phase: number): number {
  return 2 * (phase % 1) - 1;
}

function tri(phase: number): number {
  const p = phase % 1;
  return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
}

/** Percussive decay envelope: 1 → 0 over `seconds`. */
function decay(t: number, seconds: number): number {
  return Math.max(0, 1 - t / seconds);
}

/** Attack-decay envelope peaking at `attack` seconds. */
function attackDecay(t: number, attack: number, seconds: number): number {
  if (t < attack) return t / attack;
  return Math.max(0, 1 - (t - attack) / (seconds - attack));
}

/** Frequency sweep helper: exponential from a to b over `seconds`. */
function sweep(t: number, seconds: number, fromHz: number, toHz: number): number {
  const k = Math.pow(toHz / fromHz, 1 / seconds);
  return fromHz * Math.pow(k, t);
}

// ---- SFX recipes (one buffer per SfxEventId) ----

/** Sequenced blips: notes as [startSec, hz, lenSec]. */
function blips(
  notes: readonly (readonly [number, number, number])[],
  wave: (p: number) => number,
  gain: number,
): SynthData {
  let total = 0;
  for (const [start, , len] of notes) total = Math.max(total, start + len);
  return render(total + 0.02, (t) => {
    let out = 0;
    for (const [start, hz, len] of notes) {
      if (t < start || t > start + len) continue;
      const lt = t - start;
      out += wave(hz * lt) * attackDecay(lt, 0.005, len) * 0.9;
    }
    return out * gain;
  });
}

/** All SFX buffers, keyed exactly as the engine registers them. */
export function synthSfx(): Record<string, SynthData> {
  return {
    "sfx:brickHit": blips([[0, 880, 0.07], [0.02, 660, 0.05]], square, 0.5),
    "sfx:chainEscalate": blips([[0, 440, 0.05], [0.06, 554, 0.05], [0.12, 659, 0.08]], square, 0.55),
    "sfx:paddleHit": render(0.09, (t) => tri(220 * t) * decay(t, 0.09) * 0.9),
    "sfx:wallHit": blips([[0, 330, 0.04]], square, 0.3),
    "sfx:capsuleCatch": blips([[0, 660, 0.06], [0.07, 990, 0.09]], square, 0.5),
    "sfx:capsuleEffect": blips([[0, 523, 0.05], [0.05, 659, 0.05], [0.1, 784, 0.05], [0.15, 1047, 0.1]], tri, 0.5),
    "sfx:ballLoss": render(0.45, (t) => saw(sweep(t, 0.45, 400, 55) * t) * decay(t, 0.45) * 0.7),
    "sfx:roundClear": blips([[0, 523, 0.1], [0.11, 659, 0.1], [0.22, 784, 0.1], [0.33, 1047, 0.25]], square, 0.55),
    "sfx:attack": render(0.18, (t) => (square(110 * t) * 0.5 + (rng(7)() * 2 - 1) * 0.3) * decay(t, 0.18) * 0.8),
    "sfx:assist": blips([[0, 392, 0.12], [0.02, 494, 0.12], [0.04, 587, 0.16]], tri, 0.5),
    "sfx:launch": render(0.12, (t) => square(sweep(t, 0.12, 200, 640) * t) * decay(t, 0.12) * 0.5),
  };
}

// ---- Music ----

/** Semitone offset → frequency (A4 = 440). */
function note(semitone: number): number {
  return 440 * Math.pow(2, semitone / 12);
}

interface TrackSpec {
  bpm: number;
  /** Lead notes: [beat, semitone, beatsLen]. */
  lead: readonly (readonly [number, number, number])[];
  /** Bass notes: [beat, semitone, beatsLen]. */
  bass: readonly (readonly [number, number, number])[];
  /** Total length in beats (loop point). */
  beats: number;
}

function renderTrack(spec: TrackSpec): SynthData {
  const spb = 60 / spec.bpm; // seconds per beat
  const total = spec.beats * spb + 0.05;
  return render(total, (t) => {
    let out = 0;
    for (const [beat, semi, lenBeats] of spec.lead) {
      const start = beat * spb;
      const len = lenBeats * spb;
      if (t < start || t > start + len) continue;
      const lt = t - start;
      // 16th-note gate keeps the chiptune pulse; envelope dies before the
      // note end so the loop seam is silent.
      const gate = lt % (spb / 2) < (spb / 2) * 0.8 ? 1 : 0;
      out += square(note(semi) * lt) * attackDecay(lt, 0.004, len) * gate * 0.32;
    }
    for (const [beat, semi, lenBeats] of spec.bass) {
      const start = beat * spb;
      const len = lenBeats * spb;
      if (t < start || t > start + len) continue;
      const lt = t - start;
      out += tri(note(semi) * lt) * attackDecay(lt, 0.006, len) * 0.5;
    }
    return out;
  });
}

/** All music buffers, keyed exactly as the engine registers them. */
export function synthMusic(): Record<string, SynthData> {
  // Level: bright major arp loop, 8 beats @ 130 BPM.
  const level: TrackSpec = {
    bpm: 130,
    beats: 8,
    lead: [
      [0, 4, 0.5], [0.5, 7, 0.5], [1, 12, 0.5], [1.5, 7, 0.5],
      [2, 9, 0.5], [2.5, 4, 0.5], [3, 7, 0.5], [3.5, 9, 0.5],
      [4, 5, 0.5], [4.5, 9, 0.5], [5, 12, 0.5], [5.5, 9, 0.5],
      [6, 7, 0.5], [6.5, 4, 0.5], [7, 7, 0.5], [7.5, 12, 0.5],
    ],
    bass: [[0, -8, 2], [2, -5, 2], [4, -7, 2], [6, -5, 2]],
  };
  // Boss: minor, driving, 8 beats @ 145 BPM.
  const boss: TrackSpec = {
    bpm: 145,
    beats: 8,
    lead: [
      [0, 7, 0.25], [0.5, 8, 0.25], [1, 7, 0.25], [1.5, 3, 0.25],
      [2, 10, 0.25], [2.5, 8, 0.25], [3, 7, 0.25], [3.5, 5, 0.25],
      [4, 7, 0.25], [4.5, 10, 0.25], [5, 12, 0.25], [5.5, 10, 0.25],
      [6, 8, 0.25], [6.5, 7, 0.25], [7, 5, 0.25], [7.5, 3, 0.25],
    ],
    bass: [[0, -12, 1], [1, -12, 1], [2, -10, 1], [3, -10, 1], [4, -12, 1], [5, -12, 1], [6, -14, 1], [7, -14, 1]],
  };
  // Round intro: 1.5-beat fanfare jingle (one-shot).
  const roundIntro: TrackSpec = {
    bpm: 150,
    beats: 3,
    lead: [[0, 0, 0.5], [0.5, 4, 0.5], [1, 7, 0.5], [1.5, 12, 1.25]],
    bass: [[0, -12, 3]],
  };
  // Game over: descending minor cadence (one-shot).
  const gameOver: TrackSpec = {
    bpm: 90,
    beats: 4,
    lead: [[0, 7, 1], [1, 3, 1], [2, 0, 1], [3, -5, 1]],
    bass: [[0, -5, 1], [1, -8, 1], [2, -12, 1], [3, -17, 1]],
  };
  return {
    "music:level": renderTrack(level),
    "music:boss": renderTrack(boss),
    "music:roundIntro": renderTrack(roundIntro),
    "music:gameOver": renderTrack(gameOver),
  };
}
