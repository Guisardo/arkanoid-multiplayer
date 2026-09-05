// End screens + between-match flow (ticket 50, spec §6/§14): every mode's
// ending. Pure data shaping (ranking, metric extraction, counters, records)
// + DOM renderers following the settingsScreen pattern. Mode sims stay the
// source of truth — this module only shapes their results for display.
import { t, format, type Locale, type StringKey } from "ui/strings";
import type { MatchState } from "sim/multiField";
import type { AssistMatchState } from "sim/assistSession";
import type { DuelMatchResult } from "sim/duel";

// ---- Pure data shaping (unit-tested) ----

export type CompetitiveMode = "race" | "duel" | "attack";

export interface StandingRow {
  player: number;
  name: string;
  score: number;
  /** Per-mode metric: Race = finish order (1 = first), Duel = round wins, Attack = points. */
  metric: number;
  rank: number;
}

/** Race standings: finish order by levels cleared, then bricks this level. */
export function raceStandings(state: MatchState, names: readonly string[]): StandingRow[] {
  return rank(
    names.map((name, player) => ({
      player,
      name,
      score: 0,
      metric: (state.levelsCleared[player] ?? 0) * 10000 + (state.bricksThisLevel[player] ?? 0),
    })),
  );
}

/** Duel standings: round wins (result carries the final scores). */
export function duelStandings(result: DuelMatchResult, names: readonly [string, string]): StandingRow[] {
  return rank([
    { player: 0, name: names[0], score: result.scores[0], metric: result.scores[0] },
    { player: 1, name: names[1], score: result.scores[1], metric: result.scores[1] },
  ]);
}

/** Attack standings: points (race score + attack economy merged by the session). */
export function attackStandings(state: MatchState, names: readonly string[]): StandingRow[] {
  return rank(
    names.map((name, player) => ({
      player,
      name,
      score: 0,
      metric: (state.levelsCleared[player] ?? 0) * 10000 + (state.bricksThisLevel[player] ?? 0),
    })),
  );
}
function rank(rows: Array<{ player: number; name: string; score: number; metric: number }>): StandingRow[] {
  const sorted = [...rows].sort((a, b) => b.metric - a.metric);
  const out: StandingRow[] = [];
  let rank = 0;
  let prevMetric = Number.NaN;
  for (const r of sorted) {
    if (r.metric !== prevMetric) {
      rank = out.length + 1;
      prevMetric = r.metric;
    }
    out.push({ ...r, rank });
  }
  return out;
}

export interface CoopOutcome {
  /** true = episode/range cleared, false = lives exhausted / all downed. */
  cleared: boolean;
  teamScore: number;
  roundReached: number;
  maxRound: number;
  perPlayer: Array<{ player: number; name: string; bricks: number; capsules: number }>;
}

/** Coop outcome from an assist session state + per-player counters. */
export function coopOutcome(
  state: AssistMatchState,
  counters: ReadonlyArray<{ player: number; name: string; bricks: number; capsules: number }>,
  maxRound: number,
): CoopOutcome {
  return {
    cleared: state.phase === "won",
    teamScore: state.teamScore,
    roundReached: state.round,
    maxRound,
    perPlayer: counters.map((c) => ({ ...c })),
  };
}

export interface SoloEnd {
  episodeComplete: boolean;
  score: number;
  round: number;
  highScore: number;
  highestRound: number;
  /** Continue cost already applied by the episode (score −60%); shown only on game over. */
  canContinue: boolean;
}

/** Solo end data: episode complete vs game over + records. */
export function soloEnd(
  episodeComplete: boolean,
  score: number,
  round: number,
  records: { highScore: number; highestRound: number },
): SoloEnd {
  return {
    episodeComplete,
    score,
    round,
    highScore: Math.max(records.highScore, score),
    highestRound: Math.max(records.highestRound, round),
    canContinue: !episodeComplete,
  };
}

// ---- DOM renderers (settingsScreen pattern) ----

export type EndScreenChoice = "rematch" | "lobby" | "quit" | "continue" | "restart";

export interface EndScreenOptions {
  host: HTMLElement;
  locale: Locale;
  /** Competitive standings, coop outcome, or solo end — exactly one. */
  data:
    | { kind: "competitive"; mode: CompetitiveMode; standings: StandingRow[] }
    | { kind: "coop"; outcome: CoopOutcome }
    | { kind: "solo"; end: SoloEnd };
  onChoice: (choice: EndScreenChoice) => void;
  /** Solo only: Continue label shows the applied score penalty. */
  continueScoreFactor?: number;
}

const STYLE_ID = "arkanoid-end-screen-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    ".end-root{position:fixed;inset:0;background:rgba(8,8,16,.92);display:flex;" +
    "align-items:center;justify-content:center;z-index:1000;}" +
    ".end-panel{background:#181828;color:#eee;padding:24px 32px;border:2px solid #444;" +
    "min-width:320px;display:flex;flex-direction:column;gap:12px;font-family:monospace;}" +
    ".end-title{font-size:20px;font-weight:bold;margin:0 0 8px;text-align:center;}" +
    ".end-row{display:flex;justify-content:space-between;gap:16px;}" +
    ".end-btn{margin-top:4px;padding:8px 16px;font-family:monospace;min-height:48px;min-width:48px;" +
    "touch-action:manipulation;cursor:pointer;}";
  document.head.appendChild(style);
}

export class EndScreen {
  readonly root: HTMLDivElement;

  constructor(opts: EndScreenOptions) {
    ensureStyles();
    this.root = document.createElement("div");
    this.root.className = "end-root";
    const panel = document.createElement("div");
    panel.className = "end-panel";

    const title = document.createElement("h2");
    title.className = "end-title";
    const rows = document.createElement("div");
    rows.style.display = "contents";

    if (opts.data.kind === "competitive") {
      const d = opts.data;
      title.textContent = d.standings[0]
        ? format(t(opts.locale, "end.winner"), { name: d.standings[0].name })
        : t(opts.locale, "end.draw");
      rows.append(...competitiveRows(opts.locale, d.mode, d.standings));
      panel.append(title, rows, buttonRow(opts, ["rematch", "lobby", "quit"]));
    } else if (opts.data.kind === "coop") {
      const o = opts.data.outcome;
      title.textContent = t(opts.locale, o.cleared ? "end.episodeCleared" : "end.livesExhausted");
      const team = row(t(opts.locale, "end.teamScore"), String(o.teamScore));
      const reached = row(
        t(opts.locale, "end.roundReached"),
        format(t(opts.locale, "hud.roundOf"), { round: o.roundReached, max: o.maxRound }),
      );
      rows.append(team, reached);
      for (const p of o.perPlayer) {
        rows.append(
          row(
            p.name,
            format(t(opts.locale, "end.coopCounters"), { bricks: p.bricks, capsules: p.capsules }),
          ),
        );
      }
      panel.append(title, rows, buttonRow(opts, ["lobby", "quit"]));
    } else {
      const e = opts.data.end;
      title.textContent = t(opts.locale, e.episodeComplete ? "end.episodeComplete" : "end.gameOver");
      rows.append(
        row(t(opts.locale, "hud.score"), String(e.score)),
        row(t(opts.locale, "end.highScore"), String(e.highScore)),
        row(t(opts.locale, "end.highestRound"), String(e.highestRound)),
      );
      const choices: EndScreenChoice[] = e.canContinue ? ["continue", "restart", "quit"] : ["restart", "quit"];
      panel.append(title, rows, buttonRow(opts, choices));
    }

    this.root.appendChild(panel);
    opts.host.appendChild(this.root);
  }

  close(): void {
    this.root.remove();
  }
}

function competitiveRows(locale: Locale, mode: CompetitiveMode, standings: StandingRow[]): HTMLElement[] {
  const metricKey: Record<CompetitiveMode, StringKey> = {
    race: "end.metricFinishOrder",
    duel: "end.metricRoundWins",
    attack: "end.metricPoints",
  };
  return standings.map((s) =>
    row(
      `${String(s.rank)}. ${s.name}`,
      `${format(t(locale, metricKey[mode]), { n: s.metric })} · ${String(s.score)}`,
    ),
  );
}

function buttonRow(opts: EndScreenOptions, choices: EndScreenChoice[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.gap = "8px";
  for (const c of choices) {
    const btn = document.createElement("button");
    btn.className = "end-btn";
    btn.textContent = t(opts.locale, choiceKey(c));
    btn.addEventListener("click", () => {
      opts.onChoice(c);
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

function choiceKey(c: EndScreenChoice): StringKey {
  switch (c) {
    case "rematch":
      return "end.rematch";
    case "lobby":
      return "end.lobby";
    case "quit":
      return "menu.quit";
    case "continue":
      return "end.continue";
    case "restart":
      return "end.restart";
  }
}

function row(label: string, value: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "end-row";
  const l = document.createElement("span");
  l.textContent = label;
  const v = document.createElement("span");
  v.textContent = value;
  el.append(l, v);
  return el;
}
