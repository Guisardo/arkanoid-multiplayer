// Progress rows (spec §12): the same row builder feeds guests (over the wire)
// and the host's own remote strip (ticket 100), so the host sees guest
// progress instead of an empty band.
import { describe, expect, it } from "vitest";
import { collectProgressRows, packProgress, unpackProgress, wireRowToProgress } from "app/hostProgress";
import { createRoundSim } from "sim/roundSim";
import { getLevelSync } from "content/levels";
import type { Snapshot } from "shared/protocol";

function snapshotWith(players: { player: number; score: number; lives: number; state?: "playing" | "downed" | "removed" }[], round = 4): Snapshot {
  const base = createRoundSim(getLevelSync(1), { lives: 3, score: 0 }).snapshot();
  const template = base.players[0]!;
  return {
    ...base,
    round,
    players: players.map((p) => ({ ...template, player: p.player, name: `P${String(p.player)}`, score: p.score, lives: p.lives, state: p.state ?? "playing" })),
  };
}

describe("collectProgressRows", () => {
  const players = [{ player: 0 }, { player: 1 }, { player: 2 }];

  it("single-field modes: every non-excluded player comes from the one shared snapshot", () => {
    const snap = snapshotWith([
      { player: 0, score: 10, lives: 3 },
      { player: 1, score: 200, lives: 2 },
      { player: 2, score: 3000, lives: 1 },
    ]);
    const rows = collectProgressRows(players, new Set([0]), [snap]);
    expect(rows).toEqual([
      { player: 1, score: 200, round: 4, lives: 2, state: 0 },
      { player: 2, score: 3000, round: 4, lives: 1, state: 0 },
    ]);
  });

  it("parallel modes: each field's snapshot renumbers its lone player to 0, yet rows keep global ids", () => {
    // multiField remaps every field's player to index 0 — the strip must still
    // report player 1 and player 2 from their own fields.
    const fields = [
      snapshotWith([{ player: 0, score: 11, lives: 5 }], 2),
      snapshotWith([{ player: 0, score: 222, lives: 4 }], 3),
      snapshotWith([{ player: 0, score: 3333, lives: 3 }], 4),
    ];
    const rows = collectProgressRows(players, new Set([0]), fields);
    expect(rows).toEqual([
      { player: 1, score: 222, round: 3, lives: 4, state: 0 },
      { player: 2, score: 3333, round: 4, lives: 3, state: 0 },
    ]);
  });

  it("maps downed to state 1 and removed to state 2", () => {
    const snap = snapshotWith([
      { player: 0, score: 0, lives: 3 },
      { player: 1, score: 0, lives: 0, state: "downed" },
      { player: 2, score: 0, lives: 0, state: "removed" },
    ]);
    const rows = collectProgressRows(players, new Set([0]), [snap]);
    expect(rows.map((r) => r.state)).toEqual([1, 2]);
  });

  it("skips players whose snapshot row is missing", () => {
    const snap = snapshotWith([{ player: 0, score: 5, lives: 3 }]);
    expect(collectProgressRows(players, new Set([0]), [snap])).toEqual([]);
  });

  it("survives a pack/unpack round trip", () => {
    const rows = [{ player: 1, score: 123456, round: 17, lives: 4, state: 1 }];
    expect(unpackProgress(packProgress(rows))).toEqual(rows);
  });
});

describe("wireRowToProgress", () => {
  it("names the player, caps nothing, and flags downed", () => {
    const row = wireRowToProgress({ player: 1, score: 9, round: 2, lives: 0, state: 1 }, ["Ann", "Bo"], 33);
    expect(row).toEqual({ player: 1, name: "Bo", score: 9, round: 2, maxRound: 33, lives: 0, downed: true });
  });

  it("falls back to P<n> when no name is known", () => {
    expect(wireRowToProgress({ player: 3, score: 0, round: 1, lives: 5, state: 0 }, [], 33).name).toBe("P4");
  });
});
