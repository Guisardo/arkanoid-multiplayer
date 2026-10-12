// Cross-tab save conflict prompt (ticket 103).
//
// Two tabs of the same origin share one save. `classifyWrite` normally settles
// that with last-write-wins, which is right for the overwhelming majority of
// writes (a settings tweak in the background tab should just appear). But when
// both tabs changed something since they last agreed, the other tab genuinely
// deleted work — a solo run, a high score. That case is not resolvable by a
// clock, so it comes here.
//
// This screen therefore shows BOTH versions and lets the player choose. It is
// deliberately its own small screen rather than a reuse of `EndScreen`: that
// one reports a finished match, this reports an unfinished decision, and only
// the storage layer ever shows it.
//
// The two documents are shown by the same summary line the boot-time Continue
// prompt uses (score / round / name). That is not a stylistic echo — those
// three fields are what a player would actually miss about a save, so
// summarising by anything else (a raw JSON dump, a timestamp) would tell them
// less at the moment they are choosing.
import { t, format, type Locale } from "ui/strings";
import type { SaveDocument } from "persistence/saveDocument";

/** Which side survived. The caller writes it through the normal save path. */
export type ConflictChoice = "local" | "remote";

export interface ConflictMergeOptions {
  host: HTMLElement;
  locale: Locale;
  /** What this tab holds. */
  local: SaveDocument;
  /** What the other tab announced. */
  remote: SaveDocument;
  onChoice: (choice: ConflictChoice) => void;
}

const STYLE_ID = "arkanoid-conflict-merge-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    ".cm-root{position:fixed;inset:0;background:rgba(8,8,16,.92);display:flex;" +
    "align-items:center;justify-content:center;z-index:1001;}" +
    ".cm-panel{background:#181828;color:#eee;padding:24px 32px;border:2px solid #444;" +
    "min-width:340px;max-width:min(90vw,460px);display:flex;flex-direction:column;gap:12px;" +
    "font-family:monospace;}" +
    ".cm-title{font-size:20px;font-weight:bold;margin:0 0 4px;text-align:center;}" +
    ".cm-body{margin:0 0 8px;color:#aaa;line-height:1.4;}" +
    ".cm-choices{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;}" +
    ".cm-choice{display:flex;flex-direction:column;gap:6px;align-items:center;padding:8px 12px;" +
    "min-height:48px;min-width:120px;cursor:pointer;background:#22223a;color:#eee;border:2px solid #555;" +
    "font-family:monospace;}" +
    ".cm-choice:hover,.cm-choice:focus-visible{border-color:#fd4;}" +
    ".cm-choice-label{font-size:13px;color:#fd4;}" +
    ".cm-choice-summary{font-size:12px;color:#ccc;}";
  document.head.appendChild(style);
}

export class ConflictMergeScreen {
  readonly root: HTMLDivElement;

  constructor(opts: ConflictMergeOptions) {
    ensureStyles();
    this.root = document.createElement("div");
    this.root.className = "cm-root";
    this.root.dataset.conflictMerge = "";

    const panel = document.createElement("div");
    panel.className = "cm-panel";

    const title = document.createElement("h2");
    title.className = "cm-title";
    title.textContent = t(opts.locale, "save.conflictTitle");

    const body = document.createElement("p");
    body.className = "cm-body";
    body.textContent = t(opts.locale, "save.conflictBody");

    const choices = document.createElement("div");
    choices.className = "cm-choices";
    choices.append(
      this.choice(opts, "local", opts.local, t(opts.locale, "save.conflictThisTab")),
      this.choice(opts, "remote", opts.remote, t(opts.locale, "save.conflictOtherTab")),
    );

    panel.append(title, body, choices);
    this.root.appendChild(panel);
    opts.host.appendChild(this.root);
  }

  private choice(
    opts: ConflictMergeOptions,
    side: ConflictChoice,
    doc: SaveDocument,
    label: string,
  ): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "cm-choice";
    b.dataset.conflictChoice = side;

    const caption = document.createElement("span");
    caption.className = "cm-choice-label";
    caption.textContent = label;

    const summary = document.createElement("span");
    summary.className = "cm-choice-summary";
    summary.dataset.conflictSummary = side;
    summary.textContent = format(t(opts.locale, "save.conflictSummary"), {
      score: doc.solo.highScore,
      round: doc.solo.highestRound,
      name: doc.settings.name,
    });

    b.append(caption, summary);
    b.addEventListener("click", () => {
      opts.onChoice(side);
    });
    return b;
  }

  close(): void {
    this.root.remove();
  }
}