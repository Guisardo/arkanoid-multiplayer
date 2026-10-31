// Bolt Brick flash (ticket #148, spec #140 Variant C): a Brick a Bolt hits
// flashes white for ~0.12 s. Pure state, like `FlashLayer`: the orchestrator
// paints it onto FieldView's flash Graphics. Unlike the full-field flash it is
// a readability cue (it marks *which* Brick took the hit), so reduced effects
// keep it.

/** Flash colour: plain white, like the classic hit flash. */
export const BRICK_FLASH_COLOR = 0xffffff;
/** Flash life, seconds. */
export const BRICK_FLASH_SECONDS = 0.12;
/** Flashes alive at once: two Bolts per shot, four Paddles, with headroom. */
export const BRICK_FLASH_POOL = 16;

interface LiveFlash {
  index: number;
  remaining: number;
}

export class BrickFlashes {
  private readonly live: LiveFlash[] = [];
  private readonly pool: LiveFlash[] = [];

  constructor() {
    for (let i = 0; i < BRICK_FLASH_POOL; i++) this.pool.push({ index: -1, remaining: 0 });
  }

  /** Flash a cell; a cell already flashing restarts. Pool exhaustion recycles the oldest. */
  flash(index: number): void {
    const existing = this.live.find((f) => f.index === index);
    if (existing !== undefined) {
      existing.remaining = BRICK_FLASH_SECONDS;
      return;
    }
    const slot = this.pool.pop() ?? this.live.shift();
    if (slot === undefined) return;
    slot.index = index;
    slot.remaining = BRICK_FLASH_SECONDS;
    this.live.push(slot);
  }

  /** Advance; `frozen` holds the flashes (hit-stop). */
  update(dt: number, frozen: boolean): void {
    if (frozen) return;
    let keep = 0;
    for (const f of this.live) {
      f.remaining -= dt;
      if (f.remaining > 0) this.live[keep++] = f;
      else this.pool.push(f);
    }
    this.live.length = keep;
  }

  /** Cells flashing now, oldest first. */
  get indices(): number[] {
    return this.live.map((f) => f.index);
  }

  /** Live flashes with their alpha (1 → 0 over the flash life). */
  forEach(fn: (index: number, alpha: number) => void): void {
    for (const f of this.live) fn(f.index, f.remaining / BRICK_FLASH_SECONDS);
  }

  reset(): void {
    for (const f of this.live) this.pool.push(f);
    this.live.length = 0;
  }
}
