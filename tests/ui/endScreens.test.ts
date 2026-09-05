// @vitest-environment jsdom
// End screens tests (ticket 50): standings per mode (Race finish order,
// Duel round wins, Attack points), coop outcome + counters, solo records,
// DOM renderers (both locales, choice wiring).
import { describe, expect, it } from "vitest";
import {
  raceStandings,
  duelStandings,
  attackStandings,
  coopOutcome,
  soloEnd,
  EndScreen,
  type EndScreenChoice,
} from "ui/endScreens";
import type { MatchState } from "sim/multiField";
import type { DuelMatchResult } from "sim/duel";
import type { AssistMatchState } from "sim/assistSession";

function matchState(over: Partial<MatchState> = {}): MatchState {
  return {
    round: 1,
    roundPoints: [0, 0],
    levelsCleared: [0, 0],
    bricksThisLevel: [0, 0],
    matchWinner: null,
    phase: "playing",
    ...over,
  };
}

describe("competitive standings", () => {
  it("Race: finish order by levels cleared, then bricks (ties share rank)", () => {
    const s = matchState({ levelsCleared: [3, 5], bricksThisLevel: [10, 2] });
    const rows = raceStandings(s, ["Ana", "Beto"]);
    expect(rows[0]).toMatchObject({ player: 1, name: "Beto", rank: 1 });
    expect(rows[1]).toMatchObject({ player: 0, name: "Ana", rank: 2 });
  });

  it("Race: equal metrics share the same rank", () => {
    const s = matchState({ levelsCleared: [2, 2], bricksThisLevel: [7, 7] });
    const rows = raceStandings(s, ["Ana", "Beto"]);
    expect(rows[0]?.rank).toBe(1);
    expect(rows[1]?.rank).toBe(1);
  });

  it("Duel: round wins from the match result scores", () => {
    const result: DuelMatchResult = { winner: 0, scores: [3, 1] };
    const rows = duelStandings(result, ["Ana", "Beto"]);
    expect(rows[0]).toMatchObject({ player: 0, metric: 3, rank: 1 });
    expect(rows[1]).toMatchObject({ player: 1, metric: 1, rank: 2 });
  });

  it("Duel draw: winner -1 → both metrics equal, shared rank 1", () => {
    const result: DuelMatchResult = { winner: -1, scores: [2, 2] };
    const rows = duelStandings(result, ["Ana", "Beto"]);
    expect(rows[0]?.rank).toBe(1);
    expect(rows[1]?.rank).toBe(1);
  });

  it("Attack: points ordering", () => {
    const s = matchState({ levelsCleared: [1, 4], bricksThisLevel: [0, 0] });
    const rows = attackStandings(s, ["Ana", "Beto"]);
    expect(rows[0]?.player).toBe(1);
    expect(rows[0]?.rank).toBe(1);
  });
});

describe("coop outcome", () => {
  it("won: cleared=true, team score, round reached, per-player counters", () => {
    const state: AssistMatchState = { round: 12, teamScore: 8400, phase: "won" };
    const o = coopOutcome(
      state,
      [
        { player: 0, name: "Ana", bricks: 120, capsules: 9 },
        { player: 1, name: "Beto", bricks: 80, capsules: 14 },
      ],
      33,
    );
    expect(o.cleared).toBe(true);
    expect(o.teamScore).toBe(8400);
    expect(o.roundReached).toBe(12);
    expect(o.maxRound).toBe(33);
    expect(o.perPlayer).toHaveLength(2);
    expect(o.perPlayer[1]).toMatchObject({ bricks: 80, capsules: 14 });
  });

  it("lost: cleared=false when all downed", () => {
    const state: AssistMatchState = { round: 7, teamScore: 2100, phase: "lost" };
    const o = coopOutcome(state, [], 33);
    expect(o.cleared).toBe(false);
  });
});

describe("solo end", () => {
  it("game over: canContinue, records maxed against current run", () => {
    const e = soloEnd(false, 5000, 9, { highScore: 4000, highestRound: 12 });
    expect(e.canContinue).toBe(true);
    expect(e.highScore).toBe(5000); // new record
    expect(e.highestRound).toBe(12); // old record holds
  });

  it("episode complete: no continue", () => {
    const e = soloEnd(true, 20000, 33, { highScore: 20000, highestRound: 33 });
    expect(e.canContinue).toBe(false);
    expect(e.episodeComplete).toBe(true);
  });
});

describe("EndScreen DOM", () => {
  function dom(): { host: HTMLElement } {
    const host = document.body;
    host.innerHTML = "";
    return { host };
  }

  it("competitive: winner banner + ranked rows + rematch/lobby/quit", () => {
    const { host } = dom();
    const choices: EndScreenChoice[] = [];
    const screen = new EndScreen({
      host,
      locale: "en-US",
      data: {
        kind: "competitive",
        mode: "race",
        standings: raceStandings(matchState({ levelsCleared: [3, 5] }), ["Ana", "Beto"]),
      },
      onChoice: (c) => {
        choices.push(c);
      },
    });
    const text = screen.root.textContent ?? "";
    expect(text).toContain("Beto wins!");
    expect(text).toContain("Finished #");
    const btns = [...screen.root.querySelectorAll("button")].map((b) => b.textContent);
    expect(btns).toEqual(["Rematch", "Return to lobby", "Quit"]);
    const rematch = screen.root.querySelectorAll("button")[0]!;
    rematch.click();
    expect(choices).toEqual(["rematch"]);
    screen.close();
    expect(host.querySelector(".end-root")).toBeNull();
  });

  it("coop: outcome banner + team score + counters + lobby/quit", () => {
    const { host } = dom();
    const screen = new EndScreen({
      host,
      locale: "en-US",
      data: {
        kind: "coop",
        outcome: coopOutcome(
          { round: 12, teamScore: 8400, phase: "won" },
          [{ player: 0, name: "Ana", bricks: 120, capsules: 9 }],
          33,
        ),
      },
      onChoice: () => {},
    });
    const text = screen.root.textContent ?? "";
    expect(text).toContain("Episode cleared!");
    expect(text).toContain("Team score");
    expect(text).toContain("120 bricks · 9 capsules");
    const btns = [...screen.root.querySelectorAll("button")].map((b) => b.textContent);
    expect(btns).toEqual(["Return to lobby", "Quit"]);
    screen.close();
  });

  it("solo game over: Continue/Restart/Quit + records", () => {
    const { host } = dom();
    const screen = new EndScreen({
      host,
      locale: "en-US",
      data: { kind: "solo", end: soloEnd(false, 5000, 9, { highScore: 4000, highestRound: 12 }) },
      onChoice: () => {},
    });
    const text = screen.root.textContent ?? "";
    expect(text).toContain("Game over");
    expect(text).toContain("High score");
    expect(text).toContain("5000");
    const btns = [...screen.root.querySelectorAll("button")].map((b) => b.textContent);
    expect(btns).toEqual(["Continue", "Restart", "Quit"]);
    screen.close();
  });

  it("solo episode complete: no Continue button", () => {
    const { host } = dom();
    const screen = new EndScreen({
      host,
      locale: "en-US",
      data: { kind: "solo", end: soloEnd(true, 20000, 33, { highScore: 20000, highestRound: 33 }) },
      onChoice: () => {},
    });
    const btns = [...screen.root.querySelectorAll("button")].map((b) => b.textContent);
    expect(btns).toEqual(["Restart", "Quit"]);
    screen.close();
  });

  it("es-419 strings render", () => {
    const { host } = dom();
    const screen = new EndScreen({
      host,
      locale: "es-419",
      data: {
        kind: "competitive",
        mode: "duel",
        standings: duelStandings({ winner: 0, scores: [3, 1] }, ["Ana", "Beto"]),
      },
      onChoice: () => {},
    });
    const text = screen.root.textContent ?? "";
    expect(text).toContain("¡Gana Ana!");
    expect(text).toContain("rondas ganadas");
    screen.close();
  });
});
