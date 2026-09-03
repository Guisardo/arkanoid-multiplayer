import { describe, expect, it } from "vitest";
import { KeyboardAdapter, KEYSET_1, KEYSET_2 } from "input/keyboard";

describe("KeyboardAdapter (input frame seam)", () => {
  it("right key → axis +1", () => {
    const kb = new KeyboardAdapter({ player: 0 }, [KEYSET_1]);
    kb.keyDown("ArrowRight");
    expect(kb.sampleFrame(0).axisX).toBe(1);
  });

  it("left key → axis −1; both keys cancel to 0", () => {
    const kb = new KeyboardAdapter({ player: 0 }, [KEYSET_1]);
    kb.keyDown("ArrowLeft");
    expect(kb.sampleFrame(0).axisX).toBe(-1);
    kb.keyDown("ArrowRight");
    expect(kb.sampleFrame(1).axisX).toBe(0);
  });

  it("launch is an edge event — held key fires once", () => {
    const kb = new KeyboardAdapter({ player: 0 }, [KEYSET_1]);
    kb.keyDown("Space");
    expect(kb.sampleFrame(0).launch).toBe(true);
    kb.keyDown("Space"); // ignored, still held
    expect(kb.sampleFrame(1).launch).toBe(false);
    kb.keyUp("Space");
    kb.keyDown("Space");
    expect(kb.sampleFrame(2).launch).toBe(true);
  });

  it("fire edges buffer max 1 per slot per tick", () => {
    const kb = new KeyboardAdapter({ player: 0 }, [KEYSET_1]);
    kb.keyDown("1");
    kb.keyDown("1");
    const f = kb.sampleFrame(0);
    expect(f.actions.fire[0]).toBe(true);
    expect(kb.sampleFrame(1).actions.fire[0]).toBe(false);
  });

  it("solo adapter merges both keysets onto P1", () => {
    const kb = KeyboardAdapter.solo();
    kb.keyDown("KeyD");
    expect(kb.sampleFrame(0).axisX).toBe(1);
    kb.keyUp("KeyD");
    kb.keyDown("KeyW");
    expect(kb.sampleFrame(1).launch).toBe(true);
  });

  it("axis clamps to [-1..1] regardless of keys", () => {
    const kb = new KeyboardAdapter({ player: 0 }, [KEYSET_1, KEYSET_2]);
    kb.keyDown("ArrowRight");
    kb.keyDown("KeyD");
    const axis = kb.sampleFrame(0).axisX;
    expect(axis).toBeGreaterThanOrEqual(-1);
    expect(axis).toBeLessThanOrEqual(1);
  });

  it("frames carry player id and tick", () => {
    const kb = KeyboardAdapter.player(1);
    const f = kb.sampleFrame(42);
    expect(f.player).toBe(1);
    expect(f.tick).toBe(42);
  });
});
