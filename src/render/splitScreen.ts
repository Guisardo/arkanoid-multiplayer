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
  /**
   * Ticket 102: initial cached-wall texture resolution for every field. The
   * perf ladder's degraded rung passes 0.5; it also survives resize rebuilds,
   * which construct fresh FieldViews.
   */
  textureResolution?: number;
  /**
   * Ticket 100: px reserved above every field region (the remote progress
   * strip band). Regions and `regionOf` both honour it, so the fields shrink
   * to fit instead of being shifted down and clipped.
   */
  topInset?: number;
}

export class SplitScreenView {
  readonly container = new Container();
  private fields: FieldView[] = [];
  private readonly opts: SplitScreenOptions;
  /** Ticket 102: live cached-wall texture resolution, reapplied on rebuild. */
  private wallResolution: number;
  /** Ticket 100: last snapshots, replayed after a rebuild so the HUD never blanks. */
  private lastSnapshots: readonly Snapshot[] = [];

  constructor(opts: SplitScreenOptions) {
    this.opts = opts;
    this.wallResolution = opts.textureResolution ?? 1;
    this.rebuild();
  }

  private rebuild(): void {
    for (const v of this.fields) {
      // Destroy the effects orchestrator first: it owns pooled particles and
      // BitmapText nodes that the container teardown would otherwise leak.
      v.visualEffects.destroy();
      v.container.destroy({ children: true });
    }
    this.container.removeChildren();
    this.fields = [];
    const regions: Region[] = splitRegions(this.opts.viewport, this.opts.players.length, this.opts.topInset);
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
        textureResolution: this.wallResolution,
      });
      this.fields.push(view);
      this.container.addChild(view.container);
    }
  }

  /**
   * Resize → recompute regions (never collapses fields). The fresh FieldViews
   * are re-synced with the last snapshots so name/lives/score/round are drawn
   * immediately rather than after the next network or sim tick.
   */
  resize(viewport: { w: number; h: number }): void {
    this.opts.viewport = viewport;
    this.rebuild();
    // Events are NOT replayed: the old fields already played them, and a
    // second pass would re-trigger shake/particles/pops on the fresh ones.
    this.lastSnapshots.forEach((snap, i) => this.fields[i]?.sync(snap, false));
  }

  /** Sync each field with its snapshot (index-aligned). */
  sync(snapshots: readonly Snapshot[]): void {
    this.lastSnapshots = snapshots;
    for (let i = 0; i < this.fields.length && i < snapshots.length; i++) {
      const view = this.fields[i];
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
    for (const v of this.fields) {
      if (dt === undefined) v.tickEffectsAuto();
      else v.tickEffects(dt);
    }
  }

  /** Ticket 100 probe: each field's rendered HUD strip text, index-aligned. */
  hudLines(): (readonly [string, string])[] {
    return this.fields.map((v) => v.hudLines);
  }

  /** A field's live effect state — read by tests and session diagnostics. */
  effectsStateOf(index: number): EffectsState | null {
    return this.fields[index]?.effectsState ?? null;
  }

  get fieldCount(): number {
    return this.fields.length;
  }

  /**
   * Ticket 53 (N2): the screen-px region of a local player's field — the
   * mouse/touch overlay anchor. Null when the player has no field here.
   */
  regionOf(player: number): { x: number; y: number; w: number; h: number } | null {
    const regions: Region[] = splitRegions(this.opts.viewport, this.opts.players.length, this.opts.topInset);
    const i = this.opts.players.indexOf(player);
    const region = regions[i];
    if (i < 0 || region === undefined) return null;
    return { ...region };
  }

  /** Ticket 54: context-restore resync — invalidate every field's caches. */
  invalidate(): void {
    for (const v of this.fields) v.invalidate();
  }

  /** Ticket 54: live reduced-effects toggle on every field. */
  setReducedEffects(reduced: boolean): void {
    for (const v of this.fields) v.setReducedEffects(reduced);
  }

  /**
   * Ticket 102: cached-wall texture resolution on every field. A degraded
   * rung must downscale ALL fields — leaving one at full resolution would keep
   * its cache at full size and forfeit part of the memory saving.
   */
  setTextureResolution(resolution: number): void {
    this.wallResolution = resolution;
    for (const v of this.fields) v.setTextureResolution(resolution);
  }

  /** The live fields — read by tests and session diagnostics. */
  get views(): readonly FieldView[] {
    return this.fields;
  }
}
