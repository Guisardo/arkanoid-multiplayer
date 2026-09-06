// Competitive quit-confirm overlay (ticket 48, spec §14): Esc/Start/touch
// pause icon in a competitive remote match opens THIS — the sim never
// pauses behind it. Quit = removal scored as loss; Cancel = keep playing.
import { t, type Locale } from "ui/strings";

export interface QuitConfirmOptions {
  host: HTMLElement;
  locale: Locale;
  /** Confirm = quit (removal); Cancel = dismiss, keep playing. */
  onChoice: (choice: "quit" | "cancel") => void;
}

const STYLE_ID = "arkanoid-quit-confirm-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    ".quit-root{position:fixed;inset:0;background:rgba(8,8,16,.92);display:flex;" +
    "align-items:center;justify-content:center;z-index:1000;}" +
    ".quit-panel{background:#181828;color:#eee;padding:24px 32px;border:2px solid #444;" +
    "min-width:320px;display:flex;flex-direction:column;gap:12px;font-family:monospace;}" +
    ".quit-title{font-size:20px;font-weight:bold;margin:0 0 8px;text-align:center;}" +
    ".quit-btn{margin-top:4px;padding:8px 16px;font-family:monospace;min-height:48px;min-width:48px;" +
    "touch-action:manipulation;cursor:pointer;}";
  document.head.appendChild(style);
}

export class QuitConfirm {
  readonly root: HTMLDivElement;

  constructor(opts: QuitConfirmOptions) {
    ensureStyles();
    this.root = document.createElement("div");
    this.root.className = "quit-root";
    const panel = document.createElement("div");
    panel.className = "quit-panel";
    const title = document.createElement("h2");
    title.className = "quit-title";
    title.textContent = t(opts.locale, "pause.quitConfirm");
    const quit = document.createElement("button");
    quit.className = "quit-btn";
    quit.textContent = t(opts.locale, "menu.quit");
    quit.addEventListener("click", () => {
      opts.onChoice("quit");
    });
    const cancel = document.createElement("button");
    cancel.className = "quit-btn";
    cancel.textContent = t(opts.locale, "menu.back");
    cancel.addEventListener("click", () => {
      opts.onChoice("cancel");
    });
    panel.append(title, quit, cancel);
    this.root.appendChild(panel);
    opts.host.appendChild(this.root);
  }

  close(): void {
    this.root.remove();
  }
}
