// Squash & stretch on the paddle and ball sprites (ADR 0009, audit §4.4).
//
// Volume is conserved (scaleX * scaleY === 1) so an impact deforms the shape
// without changing its apparent area — the classic game-feel trick. The state
// holds the target deformation separately from the live interpolation, so
// easing always reads from the original rather than compounding on itself.
//
// Scope note (differs from ADR 0009's sketch, which had a `SquashStretch.apply`
// that multiplied onto FieldView's sprite): FieldView sizes its sprites from
// the snapshot every sync, so the orchestrator writes the live pair straight
// onto `sprite.scale` *after* the sync. Sprites are only present when a skin
// texture loaded — in procedural-geometry mode there is nothing to scale, and
// the squash channel is a no-op rather than a second source of truth.

export type StretchTarget = "ball" | "paddle";

interface Stretch {
  /** Deformation requested by the last `hit` — the interpolation endpoint. */
  targetX: number;
  targetY: number;
  /** Live interpolation, eased toward the target as remaining life runs out. */
  scaleX: number;
  scaleY: number;
  remaining: number;
  duration: number;
}

const TARGETS: readonly StretchTarget[] = ["ball", "paddle"];

export class SquashStretch {
  private readonly state: Record<StretchTarget, Stretch> = {
    ball: { targetX: 1, targetY: 1, scaleX: 1, scaleY: 1, remaining: 0, duration: 1 },
    paddle: { targetX: 1, targetY: 1, scaleX: 1, scaleY: 1, remaining: 0, duration: 1 },
  };

  // Note: no `setEnabled` here, unlike particles/flash/shake. Squash is an
  // impact-readability channel, so reduced-effects mode keeps it (audit §8).

  /** Kick off a squash. Replaces any squash already in flight. */
  hit(target: StretchTarget, scaleX: number, scaleY: number, duration: number): void {
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return;
    if (scaleX <= 0 || scaleY <= 0) return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const s = this.state[target];
    s.targetX = scaleX;
    s.targetY = scaleY;
    s.scaleX = scaleX;
    s.scaleY = scaleY;
    s.remaining = duration;
    s.duration = duration;
  }

  scaleX(target: StretchTarget): number {
    return this.state[target].scaleX;
  }

  scaleY(target: StretchTarget): number {
    return this.state[target].scaleY;
  }

  isSquashing(target: StretchTarget): boolean {
    return this.state[target].remaining > 0;
  }

  /**
   * Ease the deformation back to neutral. `frozen` holds it (hit-stop), which
   * is what sells the freeze — the squash sticks at its peak for the beat.
   */
  update(dt: number, frozen: boolean): void {
    if (frozen) return;
    for (const target of TARGETS) {
      const s = this.state[target];
      if (s.remaining <= 0) continue;
      s.remaining = Math.max(0, s.remaining - dt);
      const t = s.duration > 0 ? s.remaining / s.duration : 0;
      // Ease-out: full deformation at t=1, neutral at t=0, soft landing.
      const e = t * t;
      s.scaleX = 1 + (s.targetX - 1) * e;
      s.scaleY = 1 + (s.targetY - 1) * e;
      if (s.remaining === 0) {
        s.scaleX = 1;
        s.scaleY = 1;
      }
    }
  }

  reset(): void {
    for (const target of TARGETS) {
      const s = this.state[target];
      s.targetX = 1;
      s.targetY = 1;
      s.scaleX = 1;
      s.scaleY = 1;
      s.remaining = 0;
    }
  }
}
