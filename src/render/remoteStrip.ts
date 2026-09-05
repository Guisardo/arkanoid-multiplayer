// Remote progress strip (ticket 45, spec §12): top edge above all field
// regions, one row per remote player — name + color, score, R12/33, lives
// (competitive) / downed flag (parallel assist). Mobile landscape
// compresses to name + score. Numbers only; remote fields never rendered.
// DOM overlay (same pattern as touch overlay chrome); Pixi fields stay pure.
import type { ProgressRow } from "app/guestGame";
import { ownerColor } from "shared/playerColors";
import type { Locale } from "ui/strings";
import { t } from "ui/strings";

const STRIP_STYLE_ID = "arkanoid-remote-strip-style";

function ensureStyles(): void {
  if (document.getElementById(STRIP_STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STRIP_STYLE_ID;
  style.textContent =
    ".rs-strip{position:absolute;top:0;left:0;right:0;display:flex;gap:8px;" +
    "justify-content:center;padding:4px 8px;font-family:monospace;pointer-events:none;" +
    "z-index:900;}" +
    ".rs-row{display:flex;gap:8px;align-items:center;background:rgba(10,10,20,0.75);" +
    "padding:2px 8px;border:1px solid #333;font-size:12px;color:#eee;}" +
    ".rs-dot{width:10px;height:10px;border-radius:2px;}" +
    ".rs-name{font-weight:bold;}" +
    ".rs-num{color:#fd4;}" +
    ".rs-down{color:#f66;}";
  document.head.appendChild(style);
}

export interface RemoteStripOptions {
  host: HTMLElement;
  locale: Locale;
  /** Mobile landscape: compress to name + score. */
  compact?: boolean;
}

export class RemoteStrip {
  readonly root: HTMLDivElement;
  private readonly locale: Locale;
  private readonly compact: boolean;
  private rows: ProgressRow[] = [];

  constructor(opts: RemoteStripOptions) {
    ensureStyles();
    this.locale = opts.locale;
    this.compact = opts.compact ?? false;
    this.root = document.createElement("div");
    this.root.className = "rs-strip";
    opts.host.appendChild(this.root);
  }

  /** Replace rows (guest game progress callback drives this). */
  update(rows: readonly ProgressRow[]): void {
    this.rows = [...rows];
    this.render();
  }

  private render(): void {
    this.root.replaceChildren();
    if (this.rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "rs-row";
      empty.textContent = t(this.locale, "mp.remoteProgress");
      this.root.appendChild(empty);
      return;
    }
    for (const row of this.rows) {
      const el = document.createElement("div");
      el.className = "rs-row";

      const dot = document.createElement("span");
      dot.className = "rs-dot";
      dot.style.background = `#${ownerColor(row.player).toString(16).padStart(6, "0")}`;
      el.appendChild(dot);

      const name = document.createElement("span");
      name.className = "rs-name";
      name.textContent = row.name;
      el.appendChild(name);

      const score = document.createElement("span");
      score.className = "rs-num";
      score.textContent = String(row.score);
      el.appendChild(score);

      if (!this.compact) {
        const round = document.createElement("span");
        round.textContent = `R${String(row.round)}/${String(row.maxRound)}`;
        el.appendChild(round);
        if (row.downed) {
          const down = document.createElement("span");
          down.className = "rs-down";
          down.textContent = "▼";
          el.appendChild(down);
        } else {
          const lives = document.createElement("span");
          lives.textContent = `×${String(row.lives)}`;
          el.appendChild(lives);
        }
      }
      this.root.appendChild(el);
    }
  }

  close(): void {
    this.root.remove();
  }
}
