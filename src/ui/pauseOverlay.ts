// Coop pause overlay (ticket 48, spec §14): "Paused by [name]" header +
// Resume + Quit. Any player's request paused everyone; any player may
// resume (the button routes through the same resume path); the pauser
// may cancel (its Resume click = cancel when it is the pauser — same
// wire result: unpause). Settings-from-pause is deferred (not in the
// ticket checklist).
import { t, format, type Locale } from "ui/strings";

export interface PauseOverlayOptions {
  host: HTMLElement;
  locale: Locale;
  /** Display name of the player who requested the pause. */
  pausedBy: string;
  /** Resume = unpause (any player); Quit = leave the match. */
  onChoice: (choice: "resume" | "quit") => void;
}

const STYLE_ID = "arkanoid-pause-overlay-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    ".pause-root{position:fixed;inset:0;background:rgba(8,8,16,.92);display:flex;" +
    "align-items:center;justify-content:center;z-index:1000;}" +
    ".pause-panel{background:#181828;color:#eee;padding:24px 32px;border:2px solid #444;" +
    "min-width:320px;display:flex;flex-direction:column;gap:12px;font-family:monospace;}" +
    ".pause-title{font-size:20px;font-weight:bold;margin:0 0 8px;text-align:center;}" +
    ".pause-btn{margin-top:4px;padding:8px 16px;font-family:monospace;min-height:48px;min-width:48px;" +
    "touch-action:manipulation;cursor:pointer;}";
  document.head.appendChild(style);
}

export class PauseOverlay {
  readonly root: HTMLDivElement;

  constructor(opts: PauseOverlayOptions) {
    ensureStyles();
    this.root = document.createElement("div");
    this.root.className = "pause-root";
    const panel = document.createElement("div");
    panel.className = "pause-panel";
    const title = document.createElement("h2");
    title.className = "pause-title";
    title.textContent = format(t(opts.locale, "pause.pausedBy"), { name: opts.pausedBy });
    const resume = document.createElement("button");
    resume.className = "pause-btn";
    resume.textContent = t(opts.locale, "pause.resume");
    resume.addEventListener("click", () => {
      opts.onChoice("resume");
    });
    const quit = document.createElement("button");
    quit.className = "pause-btn";
    quit.textContent = t(opts.locale, "menu.quit");
    quit.addEventListener("click", () => {
      opts.onChoice("quit");
    });
    panel.append(title, resume, quit);
    this.root.appendChild(panel);
    opts.host.appendChild(this.root);
  }

  close(): void {
    this.root.remove();
  }
}
