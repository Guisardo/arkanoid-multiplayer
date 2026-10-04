// Hit-stop / freeze frames (ADR 0009, audit §4.3).
//
// The sim runs a fixed 60 Hz accumulator (app/loop.ts) and must never stall —
// competitive integrity depends on it. So hit-stop is *visual only*: it tells
// the orchestrator to hold effect animations for N rendered frames while the
// sim keeps ticking underneath.
//
// Counted in rendered frames, not wall-clock ms. On the perf ladder's 30 fps
// rung (renderEvery: 2) a "6 frame" freeze therefore lasts twice as long in
// real time as at 60 fps. That is deliberate: the point of a freeze is that the
// *picture* stops, and a freeze measured in wall-clock would skip frames on a
// slow device — which reads as a stutter rather than an impact.

export class HitStop {
  private remaining = 0;

  /**
   * Request a freeze. Longer requests win over shorter ones already in flight,
   * so a boss kill during a brick-break freeze still lands as one long beat
   * instead of being cut short.
   */
  trigger(frames: number): void {
    if (!Number.isFinite(frames) || frames <= 0) return;
    this.remaining = Math.max(this.remaining, Math.floor(frames));
  }

  /** Frames still to hold. */
  get pending(): number {
    return this.remaining;
  }

  /**
   * Consume one rendered frame. Returns true when the frame should be frozen —
   * the caller skips advancing its own animations but keeps drawing.
   */
  consumeFrame(): boolean {
    if (this.remaining <= 0) return false;
    this.remaining--;
    return true;
  }

  reset(): void {
    this.remaining = 0;
  }
}
