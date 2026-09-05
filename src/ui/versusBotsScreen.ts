// Versus bots trimmed config screen (ticket 51, spec §6.2): variant picker
// with player-count validation, match structure, difficulty selector
// (session-wide, default Normal). No room code, no ready check.
// DOM pattern follows settingsScreen; tap targets ≥48 px.
import { t, type Locale, type StringKey } from "ui/strings";
import type { BotVariant } from "sim/versusBots";
import { botCountFor, validateBotsSetup } from "sim/versusBots";
import type { BotDifficulty } from "sim/bot";

export interface VersusBotsConfig {
  variant: BotVariant;
  bots: number;
  difficulty: BotDifficulty;
}

export interface VersusBotsConfigScreenOptions {
  host: HTMLElement;
  locale: Locale;
  initial?: Partial<VersusBotsConfig>;
  onStart: (config: VersusBotsConfig) => void;
  onBack: () => void;
}

const STYLE_ID = "arkanoid-versus-bots-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    ".vb-root{position:fixed;inset:0;background:rgba(8,8,16,.92);display:flex;" +
    "align-items:center;justify-content:center;z-index:1000;}" +
    ".vb-panel{background:#181828;color:#eee;padding:24px 32px;border:2px solid #444;" +
    "min-width:320px;display:flex;flex-direction:column;gap:12px;font-family:monospace;}" +
    ".vb-title{font-size:20px;font-weight:bold;margin:0 0 8px;text-align:center;}" +
    ".vb-row{display:flex;align-items:center;justify-content:space-between;gap:12px;}" +
    ".vb-btn{padding:8px 16px;font-family:monospace;min-height:48px;min-width:48px;" +
    "touch-action:manipulation;cursor:pointer;}" +
    ".vb-btn.selected{border:2px solid #fd4;color:#fd4;}" +
    ".vb-error{color:#e33;font-size:12px;min-height:16px;}";
  document.head.appendChild(style);
}

const VARIANT_KEYS: Record<BotVariant, StringKey> = {
  race: "menu.race",
  attack: "menu.attack",
  duel: "menu.duel",
  sharedField: "menu.sharedField",
  parallelAssist: "menu.parallelAssist",
};

export class VersusBotsConfigScreen {
  readonly root: HTMLDivElement;
  private readonly opts: VersusBotsConfigScreenOptions;
  private config: VersusBotsConfig;
  private errorEl: HTMLElement;
  private botButtons: HTMLButtonElement[] = [];
  private startBtn: HTMLButtonElement;

  constructor(opts: VersusBotsConfigScreenOptions) {
    ensureStyles();
    this.opts = opts;
    this.config = {
      variant: opts.initial?.variant ?? "race",
      bots: opts.initial?.bots ?? 1,
      difficulty: opts.initial?.difficulty ?? "normal",
    };

    this.root = document.createElement("div");
    this.root.className = "vb-root";
    const panel = document.createElement("div");
    panel.className = "vb-panel";

    const title = document.createElement("h2");
    title.className = "vb-title";
    title.textContent = t(opts.locale, "menu.versusBots");
    panel.appendChild(title);

    // Variant picker.
    panel.appendChild(this.label(t(opts.locale, "vb.variant")));
    const variantRow = document.createElement("div");
    variantRow.style.display = "flex";
    variantRow.style.flexWrap = "wrap";
    variantRow.style.gap = "8px";
    for (const v of Object.keys(VARIANT_KEYS) as BotVariant[]) {
      const btn = document.createElement("button");
      btn.className = "vb-btn";
      btn.textContent = t(opts.locale, VARIANT_KEYS[v]);
      btn.addEventListener("click", () => {
        this.config.variant = v;
        // Clamp bots into the new variant's range.
        const { min, max } = botCountFor(v);
        this.config.bots = Math.max(min, Math.min(max, this.config.bots));
        this.refresh();
      });
      variantRow.appendChild(btn);
    }
    panel.appendChild(variantRow);

    // Bot count picker.
    panel.appendChild(this.label(t(opts.locale, "vb.bots")));
    const botRow = document.createElement("div");
    botRow.style.display = "flex";
    botRow.style.gap = "8px";
    for (let n = 1; n <= 3; n++) {
      const btn = document.createElement("button");
      btn.className = "vb-btn";
      btn.textContent = String(n);
      btn.addEventListener("click", () => {
        this.config.bots = n;
        this.refresh();
      });
      botRow.appendChild(btn);
      this.botButtons.push(btn);
    }
    panel.appendChild(botRow);

    // Difficulty selector (session-wide, default Normal).
    panel.appendChild(this.label(t(opts.locale, "vb.difficulty")));
    const diffRow = document.createElement("div");
    diffRow.style.display = "flex";
    diffRow.style.gap = "8px";
    for (const d of ["easy", "normal", "hard"] as BotDifficulty[]) {
      const btn = document.createElement("button");
      btn.className = "vb-btn";
      btn.textContent = t(opts.locale, difficultyKey(d));
      btn.addEventListener("click", () => {
        this.config.difficulty = d;
        this.refresh();
      });
      diffRow.appendChild(btn);
    }
    panel.appendChild(diffRow);

    this.errorEl = document.createElement("div");
    this.errorEl.className = "vb-error";
    panel.appendChild(this.errorEl);

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.flexDirection = "column";
    actions.style.gap = "8px";
    this.startBtn = document.createElement("button");
    this.startBtn.className = "vb-btn";
    this.startBtn.textContent = t(opts.locale, "vb.start");
    this.startBtn.addEventListener("click", () => {
      if (validateBotsSetup(this.config.variant, 1, this.config.bots) === null) {
        this.opts.onStart(this.config);
      }
    });
    const back = document.createElement("button");
    back.className = "vb-btn";
    back.textContent = t(opts.locale, "menu.back");
    back.addEventListener("click", () => {
      this.opts.onBack();
    });
    actions.append(this.startBtn, back);
    panel.appendChild(actions);

    this.root.appendChild(panel);
    opts.host.appendChild(this.root);
    this.refresh();
  }

  close(): void {
    this.root.remove();
  }

  private refresh(): void {
    const { min, max } = botCountFor(this.config.variant);
    for (let i = 0; i < this.botButtons.length; i++) {
      const btn = this.botButtons[i];
      if (!btn) continue;
      const n = i + 1;
      const inRange = n >= min && n <= max;
      btn.disabled = !inRange;
      btn.classList.toggle("selected", n === this.config.bots && inRange);
    }
    const err = validateBotsSetup(this.config.variant, 1, this.config.bots);
    this.errorEl.textContent = err !== null ? t(this.opts.locale, "vb.invalidSetup") : "";
    this.startBtn.disabled = err !== null;
  }

  private label(text: string): HTMLElement {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.fontSize = "12px";
    el.style.color = "#999";
    return el;
  }
}

function difficultyKey(d: BotDifficulty): StringKey {
  switch (d) {
    case "easy":
      return "vb.difficultyEasy";
    case "normal":
      return "vb.difficultyNormal";
    case "hard":
      return "vb.difficultyHard";
  }
}
