// Full-field flash layer (ADR 0009, audit §4.6).
//
// A single additive quad over the play field. This class owns only the
// color/alpha *state*; FieldView owns the `Graphics` quad and the orchestrator
// writes this state onto it. Keeping the geometry out of here means the flash
// is pure state and testable without Pixi — and there is exactly one quad per
// field rather than two that can disagree.
//
// White is the hit flash, saturated colors are the event-tier flashes (red
// loss, gold clear, magenta chain), black is a fade-out.

import type { FlashRecipe } from "./effectPresets";

export class FlashLayer {
  /** Current alpha (1 → 0 across the flash's life). */
  private alpha = 0;
  private color = 0xffffff;
  private remaining = 0;
  private duration = 0;
  private peak = 0;
  private enabled = true;

  get isFlashing(): boolean {
    return this.remaining > 0;
  }

  get currentAlpha(): number {
    return this.alpha;
  }

  get currentColor(): number {
    return this.color;
  }

  /** Reduced-effects mode drops flashes entirely. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.remaining = 0;
    this.alpha = 0;
  }

  /**
   * Start a flash. A stronger flash wins over a weaker one already running, so
   * a boss kill doesn't get downgraded by a brick break mid-flash.
   */
  flash(recipe: FlashRecipe): void {
    if (!this.enabled) return;
    if (!Number.isFinite(recipe.duration) || recipe.duration <= 0) return;
    const peak = Math.max(0, Math.min(1, recipe.intensity));
    if (peak <= 0) return;
    if (peak >= this.alpha) {
      this.color = recipe.color;
      this.peak = peak;
      this.duration = recipe.duration;
      this.remaining = recipe.duration;
      this.alpha = peak;
    }
  }

  /** Advance the fade. `frozen` holds it (hit-stop). */
  update(dt: number, frozen: boolean): void {
    if (this.remaining <= 0) {
      this.alpha = 0;
      return;
    }
    if (frozen) return;
    this.remaining = Math.max(0, this.remaining - dt);
    const t = this.duration > 0 ? this.remaining / this.duration : 0;
    // Ease out — flashes should snap on and fade gently.
    this.alpha = this.peak * t * t;
    if (this.remaining === 0) this.alpha = 0;
  }

  reset(): void {
    this.remaining = 0;
    this.alpha = 0;
    this.color = 0xffffff;
  }
}
