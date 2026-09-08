// Copy-paste connection screens (spec §9 fallback, ticket 53): when the
// signaling WebSocket is unavailable, host + guest exchange non-trickle
// SDP codes by hand. Host screen shows the offer code + takes the pasted
// answer; guest screen takes the pasted offer + shows the answer code.
// Doubles as the dev connector (no deployed infra needed — spec §17).
// DOM pattern follows settingsScreen; tap targets ≥48 px.
import { t, type Locale } from "ui/strings";

export interface CopyPasteHostScreenOptions {
  host: HTMLElement;
  locale: Locale;
  /** The offer code to display (from connectViaCopyPasteHost). */
  offerCode: string;
  /** Resolves with the guest's answer code (paste box submit). */
  onAnswer: (answerCode: string) => void;
  onCancel: () => void;
}

export interface CopyPasteGuestScreenOptions {
  host: HTMLElement;
  locale: Locale;
  /** Resolves with the host's offer code (paste box submit). */
  onOffer: (offerCode: string) => void;
  /** The answer code to display once the offer is accepted. */
  answerCode: string;
  onCancel: () => void;
}

const STYLE_ID = "arkanoid-copy-paste-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    ".cp-root{position:fixed;inset:0;background:rgba(8,8,16,.92);display:flex;" +
    "align-items:center;justify-content:center;z-index:1000;}" +
    ".cp-panel{background:#181828;color:#eee;padding:24px 32px;border:2px solid #444;" +
    "min-width:320px;max-width:480px;display:flex;flex-direction:column;gap:12px;" +
    "font-family:monospace;}" +
    ".cp-title{font-size:20px;font-weight:bold;margin:0 0 8px;text-align:center;}" +
    ".cp-hint{color:#999;font-size:12px;}" +
    ".cp-code{color:#fd4;font-size:12px;word-break:break-all;" +
    "background:#101020;padding:8px;border:1px solid #333;max-height:120px;overflow:auto;}" +
    ".cp-input{padding:12px;font-family:monospace;min-height:48px;background:#181828;" +
    "color:#eee;border:2px solid #444;width:100%;box-sizing:border-box;}" +
    ".cp-btn{padding:8px 16px;font-family:monospace;min-height:48px;min-width:48px;" +
    "touch-action:manipulation;cursor:pointer;}";
  document.head.appendChild(style);
}

function panel(locale: Locale, titleKey: "cp.hostTitle" | "cp.guestTitle"): {
  root: HTMLDivElement;
  panel: HTMLDivElement;
} {
  ensureStyles();
  const root = document.createElement("div");
  root.className = "cp-root";
  const panelEl = document.createElement("div");
  panelEl.className = "cp-panel";
  const title = document.createElement("h2");
  title.className = "cp-title";
  title.textContent = t(locale, titleKey);
  panelEl.appendChild(title);
  return { root, panel: panelEl };
}

function codeBlock(code: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "cp-code";
  el.dataset.copyCode = "";
  el.textContent = code;
  return el;
}

function hint(text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "cp-hint";
  el.textContent = text;
  return el;
}

function pasteInput(placeholder: string): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  el.className = "cp-input";
  el.dataset.copyPasteInput = "";
  el.placeholder = placeholder;
  el.rows = 3;
  return el;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.className = "cp-btn";
  el.textContent = label;
  el.addEventListener("click", onClick);
  return el;
}

/** Host side: offer code visible, answer pasted in. */
export class CopyPasteHostScreen {
  readonly root: HTMLDivElement;

  constructor(opts: CopyPasteHostScreenOptions) {
    const { root, panel: panelEl } = panel(opts.locale, "cp.hostTitle");
    panelEl.appendChild(hint(t(opts.locale, "cp.hostHint")));
    panelEl.appendChild(codeBlock(opts.offerCode));
    const input = pasteInput(t(opts.locale, "cp.pastePlaceholder"));
    panelEl.appendChild(input);
    const submit = button(t(opts.locale, "cp.submit"), () => {
      const code = input.value.trim();
      if (code !== "") opts.onAnswer(code);
    });
    submit.dataset.copySubmit = "";
    panelEl.appendChild(submit);
    panelEl.appendChild(button(t(opts.locale, "menu.back"), opts.onCancel));
    root.appendChild(panelEl);
    opts.host.appendChild(root);
    this.root = root;
  }

  close(): void {
    this.root.remove();
  }
}

/** Guest side: offer pasted in, answer code visible. */
export class CopyPasteGuestScreen {
  readonly root: HTMLDivElement;

  constructor(opts: CopyPasteGuestScreenOptions) {
    const { root, panel: panelEl } = panel(opts.locale, "cp.guestTitle");
    panelEl.appendChild(hint(t(opts.locale, "cp.guestHint")));
    const input = pasteInput(t(opts.locale, "cp.pastePlaceholder"));
    panelEl.appendChild(input);
    const submit = button(t(opts.locale, "cp.submit"), () => {
      const code = input.value.trim();
      if (code !== "") opts.onOffer(code);
    });
    submit.dataset.copySubmit = "";
    panelEl.appendChild(submit);
    panelEl.appendChild(hint(t(opts.locale, "cp.guestAnswerHint")));
    panelEl.appendChild(codeBlock(opts.answerCode));
    panelEl.appendChild(button(t(opts.locale, "menu.back"), opts.onCancel));
    root.appendChild(panelEl);
    opts.host.appendChild(root);
    this.root = root;
  }

  close(): void {
    this.root.remove();
  }
}
