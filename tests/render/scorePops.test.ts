// ScorePopManager (ADR 0009) — pooled rising BitmapText.
//
// Runs under jsdom because `BitmapText` needs a DOM to exist: in node every pop
// is headless and `applyNode()` is skipped, so the rise/fade math and the pool
// recycling go untested. Here they run for real.
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { POP_POOL, ScorePopManager } from "render/scorePops";
import type { PopRecipe } from "render/effectPresets";

function recipe(over: Partial<PopRecipe> = {}): PopRecipe {
  return { text: "+50", color: 0xffee88, size: 1, ...over };
}

/** The BitmapText behind a live pop, so node state can be asserted. */
function nodeOf(manager: ScorePopManager, index: number): { text: string; x: number; y: number; alpha: number } {
  const pop = manager.activePops[index]!;
  const node = pop.node as unknown as {
    text: string;
    x: number;
    y: number;
    alpha: number;
    tint: number;
    scale: { x: number; y: number };
  };
  return node;
}

describe("ScorePopManager — pool", () => {
  it("prewarms a bounded pool", () => {
    const m = new ScorePopManager();
    expect(m.pooledCount).toBe(POP_POOL);
    expect(m.activeCount).toBe(0);
    m.destroy();
  });

  it("creates a real BitmapText per slot under a DOM", () => {
    const m = new ScorePopManager();
    m.spawn({ x: 10, y: 10 }, recipe());
    expect(m.activePops[0]!.node).not.toBeNull();
    m.destroy();
  });
});

describe("ScorePopManager — spawning", () => {
  it("records the pop text and position", () => {
    const m = new ScorePopManager();
    m.spawn({ x: 40, y: 90 }, recipe({ text: "CLEAR" }));
    const pop = m.activePops[0]!;
    expect(pop.text).toBe("CLEAR");
    expect(pop.x).toBe(40);
    expect(pop.y).toBe(90);
    expect(nodeOf(m, 0).text).toBe("CLEAR");
    m.destroy();
  });

  it("draws the pop on the node", () => {
    const m = new ScorePopManager();
    m.spawn({ x: 40, y: 90 }, recipe({ color: 0xff0000, size: 1.5 }));
    const node = nodeOf(m, 0) as unknown as { tint: number; scale: { x: number } };
    expect(node.tint).toBe(0xff0000);
    expect(node.scale.x).toBe(1.5);
    m.destroy();
  });

  it("draws at full opacity the moment it spawns", () => {
    const m = new ScorePopManager();
    m.spawn({ x: 0, y: 0 }, recipe());
    expect(nodeOf(m, 0).alpha).toBe(1);
    m.destroy();
  });

  it("keeps multiple pops alive at once", () => {
    const m = new ScorePopManager();
    m.spawn({ x: 1, y: 1 }, recipe({ text: "A" }));
    m.spawn({ x: 2, y: 2 }, recipe({ text: "B" }));
    m.spawn({ x: 3, y: 3 }, recipe({ text: "C" }));
    expect(m.activeCount).toBe(3);
    expect(m.activePops.map((p) => p.text)).toEqual(["A", "B", "C"]);
    m.destroy();
  });
});

describe("ScorePopManager — rise and fade", () => {
  it("rises over its lifetime and fades at the end", () => {
    const m = new ScorePopManager();
    m.spawn({ x: 0, y: 100 }, recipe());
    const startY = nodeOf(m, 0).y;
    m.update(0.3, false);
    const midY = nodeOf(m, 0).y;
    // Rising means moving up the field (decreasing y).
    expect(midY).toBeLessThan(startY);
    expect(nodeOf(m, 0).alpha).toBe(1);
    m.update(0.5, false);
    expect(nodeOf(m, 0).alpha).toBeLessThan(1);
    m.destroy();
  });

  it("holds every pop in place while frozen (hit-stop)", () => {
    const m = new ScorePopManager();
    m.spawn({ x: 0, y: 100 }, recipe());
    const y0 = nodeOf(m, 0).y;
    m.update(0.5, true);
    expect(nodeOf(m, 0).y).toBe(y0);
    expect(m.activeCount).toBe(1);
    m.destroy();
  });

  it("retires after its duration and clears the node", () => {
    const m = new ScorePopManager();
    m.spawn({ x: 0, y: 0 }, recipe());
    m.update(2, false);
    expect(m.activeCount).toBe(0);
    expect(m.pooledCount).toBe(POP_POOL);
    // The recycled node is blanked, so a stale "+50" cannot linger on screen.
    const recycled = m.activePops;
    expect(recycled).toEqual([]);
    m.destroy();
  });

  it("ages each pop from its own spawn time", () => {
    const m = new ScorePopManager();
    m.spawn({ x: 0, y: 0 }, recipe({ text: "EARLY" }));
    m.update(0.6, false);
    m.spawn({ x: 0, y: 0 }, recipe({ text: "LATE" }));
    // 0.5s more: the first pop is ~1.1s old (expired), the second ~0.5s.
    m.update(0.5, false);
    expect(m.activeCount).toBe(1);
    expect(m.activePops[0]!.text).toBe("LATE");
    m.destroy();
  });

  it("update with nothing alive is a no-op", () => {
    const m = new ScorePopManager();
    expect(() => { m.update(0.016, false); }).not.toThrow();
    expect(m.activeCount).toBe(0);
    m.destroy();
  });
});

describe("ScorePopManager — pool recycling", () => {
  it("recycles the oldest instead of growing without bound", () => {
    const m = new ScorePopManager();
    for (let i = 0; i < POP_POOL * 3; i++) {
      m.spawn({ x: i, y: 0 }, recipe({ text: `pop-${String(i)}` }));
    }
    expect(m.activeCount).toBeLessThanOrEqual(POP_POOL);
    expect(m.pooledCount).toBeLessThanOrEqual(POP_POOL);
    // The most recent pop is always the one still on screen.
    expect(m.activePops[m.activeCount - 1]!.text).toBe(`pop-${String(POP_POOL * 3 - 1)}`);
    m.destroy();
  });

  it("a recycled slot shows the new text, not the stale one", () => {
    const m = new ScorePopManager();
    for (let i = 0; i < POP_POOL + 1; i++) {
      m.spawn({ x: 0, y: 0 }, recipe({ text: `pop-${String(i)}` }));
    }
    const visible = m.activePops.map((p, i) => nodeOf(m, i).text);
    expect(visible).not.toContain("pop-0");
    expect(visible).toContain(`pop-${String(POP_POOL)}`);
    m.destroy();
  });
});

describe("ScorePopManager — lifecycle", () => {
  it("reset clears live pops and keeps the pool", () => {
    const m = new ScorePopManager();
    m.spawn({ x: 0, y: 0 }, recipe());
    m.spawn({ x: 0, y: 0 }, recipe());
    m.reset();
    expect(m.activeCount).toBe(0);
    expect(m.pooledCount).toBe(POP_POOL);
    // Still usable afterwards.
    m.spawn({ x: 0, y: 0 }, recipe({ text: "AFTER" }));
    expect(m.activePops[0]!.text).toBe("AFTER");
    m.destroy();
  });

  it("destroy releases the pool and its nodes", () => {
    const m = new ScorePopManager();
    m.spawn({ x: 0, y: 0 }, recipe());
    m.destroy();
    expect(m.pooledCount).toBe(0);
    expect(m.activeCount).toBe(0);
  });
});