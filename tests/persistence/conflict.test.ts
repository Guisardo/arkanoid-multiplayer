// Ticket 103: conflict resolution for the composite save key.
//
// Two tabs (or, later, two devices) can both write `arkanoid.save.v1`. The
// document already carries `updatedAt` + `deviceId` (ADR 0008 §6) precisely so
// this seam can answer "whose write is it?". These tests pin the two outcomes:
//
//   1. `resolveConflict` picks the winner by timestamp, falling back to deviceId
//      when two writes land on the same millisecond — the clock is not a total
//      order across tabs, so the id breaks the tie deterministically.
//   2. A genuinely divergent pair (both writes newer than the common base)
//      is reported as a conflict, so the caller can offer the manual merge UI
//      instead of silently discarding a tab's save.
//
// Pure functions, no storage: the seam is "given two stored documents, which
// one wins and is there anything for the user to decide?"
import { describe, expect, it } from "vitest";
import {
  classifyWrite,
  isDivergent,
  resolveConflict,
  type SaveDocument,
  type WriteClassification,
} from "persistence/conflict";

const BASE: SaveDocument = {
  schemaVersion: 1,
  updatedAt: 1_000,
  deviceId: "device-base",
  settings: {
    name: "Player 1",
    skin: null,
    theme: null,
    bindingsKeyboard: null,
    bindingsGamepad: null,
    audio: { music: 0.8, sfx: 0.8, mute: false },
    display: { dprMode: "auto", reducedEffects: false },
    language: null,
  },
  solo: { highScore: 0, highestRound: 0 },
};

function doc(overrides: Partial<SaveDocument> & { deviceId: string }): SaveDocument {
  return {
    ...structuredClone(BASE),
    ...structuredClone(overrides),
  };
}

describe("resolveConflict — last write wins (ticket 103)", () => {
  it("keeps the document with the newer updatedAt", () => {
    const mine = doc({ updatedAt: 2_000, deviceId: "a", solo: { highScore: 10, highestRound: 1 } });
    const theirs = doc({ updatedAt: 3_000, deviceId: "b", solo: { highScore: 99, highestRound: 2 } });
    expect(resolveConflict(mine, theirs).winner).toBe(theirs);
  });

  it("keeps the local document when it is newer", () => {
    const mine = doc({ updatedAt: 9_000, deviceId: "a" });
    const theirs = doc({ updatedAt: 1_000, deviceId: "b" });
    expect(resolveConflict(mine, theirs).winner).toBe(mine);
  });

  it("breaks a same-millisecond tie by deviceId, so every tab agrees", () => {
    const mine = doc({ updatedAt: 5_000, deviceId: "aaa" });
    const theirs = doc({ updatedAt: 5_000, deviceId: "bbb" });
    // Whichever wins, the two tabs must reach the SAME answer.
    expect(resolveConflict(mine, theirs).winner.deviceId).toBe(
      resolveConflict(theirs, mine).winner.deviceId,
    );
  });

  it("the tie-break is stable across argument order (no flapping)", () => {
    const mine = doc({ updatedAt: 5_000, deviceId: "aaa" });
    const theirs = doc({ updatedAt: 5_000, deviceId: "bbb" });
    expect(resolveConflict(mine, theirs).winner).toEqual(resolveConflict(theirs, mine).winner);
  });

  it("a write from a different device is still beaten by a newer local one", () => {
    const mine = doc({ updatedAt: 5_000, deviceId: "aaa" });
    const theirs = doc({ updatedAt: 4_000, deviceId: "zzz" });
    expect(resolveConflict(mine, theirs).winner.deviceId).toBe("aaa");
  });
});

describe("isDivergent — when the user has a real choice (ticket 103)", () => {
  it("is false when one document is a strict superset by recency", () => {
    const base = doc({ updatedAt: 1_000, deviceId: "a" });
    const newer = doc({ updatedAt: 2_000, deviceId: "b" });
    expect(isDivergent(base, newer, base)).toBe(false);
  });

  it("is true when both sides moved on from the common base", () => {
    const base = doc({ updatedAt: 1_000, deviceId: "base" });
    // Each side changed something the other did not — the only shape that
    // genuinely costs the player data whichever way the winner is picked.
    const mine = doc({ updatedAt: 2_000, deviceId: "a", settings: { ...BASE.settings, name: "Mine" } });
    const theirs = doc({
      updatedAt: 3_000,
      deviceId: "b",
      solo: { highScore: 500, highestRound: 4 },
    });
    expect(isDivergent(mine, theirs, base)).toBe(true);
  });

  it("is false when the two sides are byte-identical", () => {
    const base = doc({ updatedAt: 1_000, deviceId: "base" });
    const mine = doc({ updatedAt: 2_000, deviceId: "a" });
    expect(isDivergent(mine, structuredClone(mine), base)).toBe(false);
  });

  it("is false when only the local side moved on", () => {
    const base = doc({ updatedAt: 1_000, deviceId: "base" });
    const mine = doc({ updatedAt: 5_000, deviceId: "a" });
    const theirs = structuredClone(base);
    expect(isDivergent(mine, theirs, base)).toBe(false);
  });

  it("a remote write by the SAME device with identical content is not a conflict", () => {
    const base = doc({ updatedAt: 1_000, deviceId: "a" });
    const mine = doc({ updatedAt: 2_000, deviceId: "a" });
    const theirs = doc({ updatedAt: 3_000, deviceId: "a" });
    expect(isDivergent(mine, theirs, base)).toBe(false);
  });

  it("two tabs of ONE install that each changed something are a conflict", () => {
    // Tabs in one browser share the persisted deviceId, and BroadcastChannel
    // only ever connects tabs of one browser — so a same-device short-circuit
    // would make the merge prompt unreachable over the channel.
    const base = doc({ updatedAt: 1_000, deviceId: "install" });
    const mine = doc({
      updatedAt: 2_000,
      deviceId: "install",
      settings: { ...BASE.settings, name: "Tab A" },
    });
    const theirs = doc({
      updatedAt: 3_000,
      deviceId: "install",
      solo: { highScore: 500, highestRound: 4 },
    });
    expect(isDivergent(mine, theirs, base)).toBe(true);
    expect(classifyWrite(mine, theirs, base)).toBe<WriteClassification>("conflict");
  });
});

describe("resolveConflict — a total order (ticket 103)", () => {
  it("picks the same winner from either tab when timestamp AND deviceId both tie", () => {
    // Same install, same millisecond, different content: with a content-blind
    // order both tabs would call the other's write a loser and stay diverged.
    const a = doc({ updatedAt: 5_000, deviceId: "install", solo: { highScore: 1, highestRound: 1 } });
    const b = doc({ updatedAt: 5_000, deviceId: "install", solo: { highScore: 2, highestRound: 1 } });
    expect(resolveConflict(a, b).winner).toEqual(resolveConflict(b, a).winner);
  });
});

describe("classifyWrite — what the writer should do with an incoming value (ticket 103)", () => {
  it("ignores an incoming write that loses the comparison", () => {
    const mine = doc({ updatedAt: 5_000, deviceId: "a" });
    const incoming = doc({ updatedAt: 4_000, deviceId: "b" });
    expect(classifyWrite(mine, incoming, mine)).toBe<WriteClassification>("ignore");
  });

  it("applies an incoming write that clearly wins", () => {
    const mine = doc({ updatedAt: 1_000, deviceId: "a" });
    const incoming = doc({ updatedAt: 5_000, deviceId: "b" });
    expect(classifyWrite(mine, incoming, mine)).toBe<WriteClassification>("apply");
  });

  it("is a no-op when the incoming write is identical to the current one", () => {
    const mine = doc({ updatedAt: 5_000, deviceId: "a" });
    expect(classifyWrite(mine, structuredClone(mine), mine)).toBe<WriteClassification>("same");
  });

  it("escalates a genuine divergence to a conflict for the merge UI", () => {
    const base = doc({ updatedAt: 1_000, deviceId: "base" });
    const mine = doc({ updatedAt: 2_000, deviceId: "a", settings: { ...BASE.settings, name: "Mine" } });
    const theirs = doc({
      updatedAt: 3_000,
      deviceId: "b",
      solo: { highScore: 500, highestRound: 4 },
    });
    expect(classifyWrite(mine, theirs, base)).toBe<WriteClassification>("conflict");
  });
});
