import { describe, expect, it, vi } from "vitest";
import { availableRounds, getLevel, getLevelSync, preloadLevels, ATTACK_MAX_ROUND } from "content/levels";

describe("lazy level loading (ADR 0007)", () => {
  it("availableRounds stays sync and lists every shipped round", () => {
    expect(availableRounds()).toEqual(Array.from({ length: 33 }, (_, i) => i + 1));
    // Sync by construction: no await anywhere in the call above.
    expect(ATTACK_MAX_ROUND).toBe(32);
  });

  it("getLevel resolves the round's data", async () => {
    const level = await getLevel(1);
    expect(level.round).toBe(1);
    expect(level.grid).toHaveLength(18);
    expect(level.baseBallSpeed).toBe(110);
    const doh = await getLevel(33);
    expect(doh.round).toBe(33);
    expect(doh.grid[1]).toBe("GGGGGGGGGGGGG");
  });

  it("caches a loaded round in memory — a second call serves the same instance", async () => {
    const first = await getLevel(7);
    // Tamper with the cached instance: if the second call re-imported the JSON
    // module it would come back pristine.
    first.grid[0] = "TAMPERED";
    const second = await getLevel(7);
    expect(second).toBe(first);
    expect(second.grid[0]).toBe("TAMPERED");
  });

  it("getLevelSync is the sync fallback: throws before a round is loaded", async () => {
    vi.resetModules();
    const fresh = await import("content/levels");
    expect(() => { fresh.getLevelSync(4); }).toThrow(/round 4 not loaded/);
    const level = await fresh.getLevel(4);
    expect(fresh.getLevelSync(4)).toBe(level);
  });

  it("rejects a round that does not exist", async () => {
    vi.resetModules();
    const fresh = await import("content/levels");
    await expect(fresh.getLevel(0)).rejects.toThrow(/no level data for round 0/);
    await expect(fresh.getLevel(34)).rejects.toThrow(/no level data for round 34/);
  });

  it("preloadLevels warms the cache for a range", async () => {
    vi.resetModules();
    const fresh = await import("content/levels");
    expect(() => { fresh.getLevelSync(12); }).toThrow();
    await fresh.preloadLevels([12, 13, 14]);
    expect(fresh.getLevelSync(12)).toBe(await fresh.getLevel(12));
    expect(fresh.getLevelSync(14).round).toBe(14);
  });

  it("loads every shipped round clean — validation runs on the load path", async () => {
    vi.resetModules();
    const fresh = await import("content/levels");
    // assertValidLevel runs inside getLevel, so a round whose own data broke
    // its rules would reject here, naming the round.
    for (const round of availableRounds()) {
      await expect(fresh.getLevel(round)).resolves.toMatchObject({ round });
    }
  });
});
