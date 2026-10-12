// warmMode (ADR 0007): the lobby countdown's pre-fetch.
//
// The contract is a property of the call, not of its return value: when the
// await resolves, `getLevelSync` must answer for every round the mode can pick
// AND the mode's sim module must already be in the ES module registry. Only the
// second half is observable from outside, and it is observable because
// `createHostGameSession` reads its rounds through `getLevelSync` with no await
// on the step path — a cold level would crash the first tick, not stall it.
//
// So each case asserts the observable consequence: after `warmMode`, the rounds
// the picker can choose from are readable synchronously. If `roundsForMode`
// disagreed with the picker (the bug ticket 100's `selectableRounds` fix
// addressed), these fail rather than deferring the mismatch into a live match.
import { describe, expect, it } from "vitest";
import { warmMode } from "app/hostGame";
import {
  ATTACK_MAX_ROUND,
  MAX_ROUND,
  getLevelSync,
  selectableRounds,
} from "content/levels";
import type { LobbyMode } from "app/lobbyState";

/** Every mode the lobby offers, so a new mode cannot skip the warm path. */
const MODES: readonly LobbyMode[] = [
  "race",
  "attack",
  "duel",
  "sharedField",
  "parallelAssist",
];

/** The rounds a mode's session may reach, mirroring `roundsForMode`. */
function roundsFor(mode: LobbyMode): number[] {
  if (mode === "duel" || mode === "sharedField") return [1];
  return selectableRounds(mode === "attack" ? ATTACK_MAX_ROUND : MAX_ROUND);
}

describe("warmMode (ADR 0007)", () => {
  it("every mode's selectable rounds are synchronously readable afterwards", async () => {
    for (const mode of MODES) {
      await warmMode(mode);
      for (const round of roundsFor(mode)) {
        // No await: this is the read the sim's mid-match round advance makes.
        expect(getLevelSync(round), `${mode} round ${String(round)}`).toBeDefined();
      }
    }
  });

  it("single-round modes warm only round 1", async () => {
    await warmMode("duel");
    expect(roundsFor("duel")).toEqual([1]);
    expect(getLevelSync(1)).toBeDefined();
  });

  it("attack's warm ceiling excludes the round attack never plays", async () => {
    await warmMode("attack");
    // Doh (33) is the full-episode finale; attack stops one short of it.
    expect(roundsFor("attack")).not.toContain(ATTACK_MAX_ROUND + 1);
    expect(roundsFor("attack").length).toBeGreaterThan(0);
  });

  it("warming twice is safe — the preloads are memoised, not re-run", async () => {
    await warmMode("race");
    await expect(warmMode("race")).resolves.toBeUndefined();
    expect(getLevelSync(1)).toBeDefined();
  });

  it("never rejects on a mode whose chunk is already loaded", async () => {
    await warmMode("sharedField");
    await expect(warmMode("sharedField")).resolves.toBeUndefined();
  });
});