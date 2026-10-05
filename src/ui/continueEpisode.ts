// Boot-time Continue prompt (ticket 89). A crash, a closed tab or a killed tab
// used to mean the whole solo run was gone; this offers the two honest ways
// back in — Continue (this round, fresh lives, score penalty, the same deal as
// a game-over Continue) or Restart (round 1, score 0).
//
// Deliberately its own small screen rather than a reuse of `EndScreen`: the end
// screen reads results, this reads a *pending* record, and only the boot path
// ever shows it. Named for the CONTEXT.md term "Continue", with the end-screen
// button labels so the player learns one pair of words, not two.
import { t, format, type Locale } from "ui/strings";
import type { EpisodeState } from "persistence/saveDocument";

export type ContinueEpisodeChoice = "continue" | "restart";

export interface ContinueEpisodeOptions {
  host: HTMLElement;
  locale: Locale;
  /** The persisted record being offered (already checked as continuable). */
  episode: EpisodeState;
  onChoice: (choice: ContinueEpisodeChoice) => void;
}

const STYLE_ID = "arkanoid-continue-episode-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    ".ce-root{position:fixed;inset:0;background:rgba(8,8,16,.92);display:flex;" +
    "align-items:center;justify-content:center;z-index:1000;}" +
    ".ce-panel{background:#181828;color:#eee;padding:24px 32px;border:2px solid #444;" +
    "min-width:320px;max-width:min(90vw,420px);display:flex;flex-direction:column;gap:12px;" +
    "font-family:monospace;}" +
    ".ce-title{font-size:20px;font-weight:bold;margin:0 0 4px;text-align:center;}" +
    ".ce-summary{text-align:center;color:#fd4;margin:0 0 4px;}" +
    ".ce-hint{margin:0 0 8px;color:#aaa;line-height:1.4;}" +
    ".ce-btn{padding:8px 16px;font-family:monospace;min-height:48px;min-width:48px;" +
    "touch-action:manipulation;cursor:pointer;}";
  document.head.appendChild(style);
}

export class ContinueEpisodeScreen {
  readonly root: HTMLDivElement;

  constructor(opts: ContinueEpisodeOptions) {
    ensureStyles();
    this.root = document.createElement("div");
    this.root.className = "ce-root";
    this.root.dataset.continueEpisode = "";

    const panel = document.createElement("div");
    panel.className = "ce-panel";

    const title = document.createElement("h2");
    title.className = "ce-title";
    title.textContent = t(opts.locale, "solo.continueTitle");

    const summary = document.createElement("p");
    summary.className = "ce-summary";
    summary.dataset.continueSummary = "";
    summary.textContent = format(t(opts.locale, "solo.continueSummary"), {
      round: opts.episode.round,
      score: opts.episode.score,
    });

    const hint = document.createElement("p");
    hint.className = "ce-hint";
    hint.textContent = t(opts.locale, "solo.continuePenalty");

    panel.append(title, summary, hint, this.button(opts, "continue"), this.button(opts, "restart"));
    this.root.appendChild(panel);
    opts.host.appendChild(this.root);
  }

  private button(opts: ContinueEpisodeOptions, choice: ContinueEpisodeChoice): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "ce-btn";
    b.dataset.continueChoice = choice;
    b.textContent = t(opts.locale, choice === "continue" ? "end.continue" : "end.restart");
    b.addEventListener("click", () => {
      opts.onChoice(choice);
    });
    return b;
  }

  close(): void {
    this.root.remove();
  }
}
