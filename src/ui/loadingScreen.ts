// Gameplay-bundle loading screen (ticket 87).
//
// The gameplay bundle is deferred to match start, so on a cold first match the
// player waits for it. This is what they look at while they do: a progress bar
// driven by `ensureGameplayAssets(onProgress)`. It is shown only when there is
// something to wait for — a bundle already in the cache never flashes it.
import { format, t, type Locale } from "ui/strings";

export interface LoadingScreenOptions {
  host: HTMLElement;
  locale: Locale;
}

const STYLE_ID = "arkanoid-loading-screen-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    ".ls-root{position:fixed;inset:0;background:rgba(8,8,16,.92);display:flex;" +
    "align-items:center;justify-content:center;z-index:1002;}" +
    ".ls-panel{background:#181828;color:#eee;padding:24px 32px;border:2px solid #444;" +
    "min-width:280px;max-width:min(90vw,420px);display:flex;flex-direction:column;gap:12px;" +
    "font-family:monospace;text-align:center;}" +
    ".ls-title{font-size:16px;margin:0;}" +
    ".ls-track{height:12px;background:#22223a;border:2px solid #555;overflow:hidden;}" +
    ".ls-fill{height:100%;width:0;background:#fd4;}" +
    ".ls-percent{font-size:13px;color:#ccc;}";
  document.head.appendChild(style);
}

export class LoadingScreen {
  readonly root: HTMLDivElement;
  private readonly track: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly percent: HTMLSpanElement;
  private readonly locale: Locale;

  constructor(opts: LoadingScreenOptions) {
    ensureStyles();
    this.locale = opts.locale;
    const label = t(opts.locale, "loading.gameplay");

    this.root = document.createElement("div");
    this.root.className = "ls-root";
    this.root.dataset.loadingScreen = "";

    const panel = document.createElement("div");
    panel.className = "ls-panel";

    const title = document.createElement("p");
    title.className = "ls-title";
    title.textContent = label;

    this.track = document.createElement("div");
    this.track.className = "ls-track";
    this.track.setAttribute("role", "progressbar");
    this.track.setAttribute("aria-label", label);
    this.track.setAttribute("aria-valuemin", "0");
    this.track.setAttribute("aria-valuemax", "100");

    this.fill = document.createElement("div");
    this.fill.className = "ls-fill";
    this.track.appendChild(this.fill);

    this.percent = document.createElement("span");
    this.percent.className = "ls-percent";

    panel.append(title, this.track, this.percent);
    this.root.appendChild(panel);
    opts.host.appendChild(this.root);
    this.setProgress(0);
  }

  /** Show `progress` (0..1). Out-of-range clamps; a non-finite value reads as 0. */
  setProgress(progress: number): void {
    const percent = Number.isFinite(progress) ? Math.round(Math.min(1, Math.max(0, progress)) * 100) : 0;
    this.track.setAttribute("aria-valuenow", String(percent));
    this.fill.style.width = `${String(percent)}%`;
    this.percent.textContent = format(t(this.locale, "loading.percent"), { percent });
  }

  /** Remove the screen. Idempotent. */
  close(): void {
    this.root.remove();
  }
}
