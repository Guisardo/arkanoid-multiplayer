// Split-screen composition (ticket 34, spec §12): desktop N-across equal
// columns with 8 px gutters, per-field HUD strips, letterboxed fields.
// Consumes Snapshots only.
import { Container } from "pixi.js";
import type { Snapshot } from "shared/protocol";
import { splitRegions, layoutField, type Region } from "./layout";
import { FieldView } from "./fieldView";
import type { Locale } from "ui/strings";

export interface SplitScreenOptions {
  viewport: { w: number; h: number };
  players: number[];
  locale: Locale;
  maxRound: number;
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
    for (const v of this.views) v.container.destroy({ children: true });
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

  get fieldCount(): number {
    return this.views.length;
  }
}
