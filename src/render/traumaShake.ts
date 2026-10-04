// Trauma-based camera shake (ADR 0009). Pure math: the orchestrator reads
// `offset()` and writes it to the field container, so this is unit-testable
// without Pixi and never touches the scene itself.
//
// Trauma decays linearly and displacement is trauma² (quadratic), which is the
// standard model — small hits barely register, big ones land hard. The noise
// is summed sines rather than `Math.random()` so the motion is smooth and
// reproducible frame to frame.

export interface ShakeOffset {
  x: number;
  y: number;
  /** Roll, radians. */
  rotation: number;
}

export interface TraumaShakeOptions {
  /** Trauma lost per second (1 = fully decayed in one second). */
  decay?: number;
  /** Peak offset in field units at trauma = 1. */
  maxOffset?: { x: number; y: number };
  /** Peak roll in radians at trauma = 1. */
  maxRoll?: number;
}

const DEFAULTS = {
  decay: 1.3,
  maxOffset: { x: 3.5, y: 2 },
  maxRoll: 0.05,
} as const;

export class TraumaShake {
  private trauma = 0;
  private clock = 0;
  private readonly current: ShakeOffset = { x: 0, y: 0, rotation: 0 };

  /** Displacement computed by the last `update()`. Reading it is side-effect free. */
  get offset(): ShakeOffset {
    return this.current;
  }

  constructor(private readonly opts: TraumaShakeOptions = {}) {}

  /** Accumulate trauma. Clamped to 1 so a burst can't fling the field. */
  addTrauma(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  get traumaLevel(): number {
    return this.trauma;
  }

  /** Advance the decay and recompute the offset. */
  update(dt: number): ShakeOffset {
    if (this.trauma <= 0) {
      this.trauma = 0;
      this.current.x = 0;
      this.current.y = 0;
      this.current.rotation = 0;
      return this.current;
    }
    const decay = this.opts.decay ?? DEFAULTS.decay;
    const maxOffset = this.opts.maxOffset ?? DEFAULTS.maxOffset;
    const maxRoll = this.opts.maxRoll ?? DEFAULTS.maxRoll;
    this.trauma = Math.max(0, this.trauma - decay * dt);
    this.clock += dt * 30;
    const shake = this.trauma * this.trauma; // quadratic falloff
    const t = this.clock;
    const nx = Math.sin(t * 1.7) * 0.6 + Math.sin(t * 2.3) * 0.4;
    const ny = Math.sin(t * 2.9) * 0.6 + Math.sin(t * 3.1) * 0.4;
    const nr = Math.sin(t * 1.1) * 0.6 + Math.sin(t * 1.9) * 0.4;
    this.current.x = maxOffset.x * shake * nx;
    this.current.y = maxOffset.y * shake * ny;
    this.current.rotation = maxRoll * shake * nr;
    return this.current;
  }

  reset(): void {
    this.trauma = 0;
    this.clock = 0;
    this.current.x = 0;
    this.current.y = 0;
    this.current.rotation = 0;
  }
}
