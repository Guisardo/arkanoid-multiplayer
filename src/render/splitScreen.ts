// Split-screen composition (ticket 34, spec §12): desktop N-across equal
// columns with 8 px gutters, per-field HUD strips, letterboxed fields.
// Consumes Snapshots only. Ticket 44: per-player skin UUIDs + host-chosen
// field theme flow into each FieldView.
import { Container } from "pixi.js";
import type { Snapshot } from "shared/protocol";
import { splitRegions, layoutField, type Region } from "./layout";
import { FieldView } from "./fieldView";
import type { EffectsState } from "./visualEffects";
import type { Locale } from "ui/strings";

export interface SplitScreenOptions {
  viewport: { w: number; h: number };
  players: number[];
  locale: Locale;
  maxRound: number;
  /** Per-player skin UUIDs, index-aligned with players (ticket 44). */
  skinIds?: readonly string[];
  /** Host-chosen field theme UUID (ticket 44; default when absent). */
  themeId?: string;
  /** Ticket 54: reduced-effects mode on every field. */
  reducedEffects?: boolean;
}

export class SplitScreenView {
  readonly container = new Container();
  private views: FieldView[] = [];
  private readonly opts: SplitScreenOptions;

  constructor(opts: SplitScreenOptions) {
    this.opts = opts;
    this.rebuild();
  }

  private rebuild(): void {
    for (const v of this.views) {
      // Destroy the effects orchestrator first: it owns pooled particles and
      // BitmapText nodes that the container teardown would otherwise leak.
      v.visualEffects.destroy();
      v.container.destroy({ children: true });
    }
    this.container.removeChildren();
    this.views = [];
    const regions: Region[] = splitRegions(this.opts.viewport, this.opts.players.length);
    for (let i = 0; i < this.opts.players.length; i++) {
      const region = regions[i];
      const player = this.opts.players[i];
      if (!region || player === undefined) continue;
      const view = new FieldView({
        layout: layoutField(region),
        player,
        locale: this.opts.locale,
        maxRound: this.opts.maxRound,
        skinId: this.opts.skinIds?.[i],
        // Full per-player array (ticket 56): single-field variants render
        // every player's paddle — FieldView resolves each by player index.
        skinIds: this.opts.skinIds,
        themeId: this.opts.themeId,
        reducedEffects: this.opts.reducedEffects ?? false,
      });
      this.views.push(view);
      this.container.addChild(view.container);
    }
  }

  /** Resize → recompute regions (never collapses fields). */
  resize(viewport: { w: number; h: number }): void {
    this.opts.viewport = viewport;
    this.rebuild();
  }

  /** Sync each field with its snapshot (index-aligned). */
  sync(snapshots: readonly Snapshot[]): void {
    for (let i = 0; i < this.views.length && i < snapshots.length; i++) {
      const view = this.views[i];
      const snap = snapshots[i];
      if (view && snap) view.sync(snap);
    }
  }

  /**
   * ADR 0009: advance and apply every field's visual effects for one rendered
   * frame. Separate from sync() because dt must reflect the real frame gap —
   * on the perf ladder's 30 fps rung a rendered frame is ~33 ms. Pass no dt to
   * let each FieldView measure its own wall clock.
   */
  tickEffects(dt?: number): void {
    for (const v of this.views) {
      if (dt === undefined) v.tickEffectsAuto();
      else v.tickEffects(dt);
    }
  }

  /** A field's live effect state — read by tests and session diagnostics. */
  effectsStateOf(index: number): EffectsState | null {
    return this.views[index]?.effectsState ?? null;
  }

  get fieldCount(): number {
    return this.views.length;
  }

  /**
   * Ticket 53 (N2): the screen-px region of a local player's field — the
   * mouse/touch overlay anchor. Null when the player has no field here.
   */
  regionOf(player: number): { x: number; y: number; w: number; h: number } | null {
    const regions: Region[] = splitRegions(this.opts.viewport, this.opts.players.length);
    const i = this.opts.players.indexOf(player);
    const region = regions[i];
    if (i < 0 || region === undefined) return null;
    return { ...region };
  }

  /** Ticket 54: context-restore resync — invalidate every field's caches. */
  invalidate(): void {
    for (const v of this.views) v.invalidate();
  }

  /** Ticket 54: live reduced-effects toggle on every field. */
  setReducedEffects(reduced: boolean): void {
    for (const v of this.views) v.setReducedEffects(reduced);
  }
}
