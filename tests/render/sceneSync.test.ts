// sceneSync tests (ticket 54 coverage): diffBricks + fieldSceneModel —
// the snapshot→scene seam (spec §2). Pure — no Pixi.
import { describe, expect, it } from "vitest";
import { diffBricks, fieldSceneModel } from "render/sceneSync";
import { createRoundSim } from "sim/roundSim";
import { getLevel } from "content/levels";
import type { Snapshot } from "shared/protocol";

describe("diffBricks (scene seam)", () => {
  it("empty diff for identical grids", () => {
    const a = [1, 2, 0, 3];
    const d = diffBricks(a, a);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it("added: empty → occupied carries col/row/cell", () => {
    const d = diffBricks([0, 0, 0, 0], [0, 5, 0, 0]);
    expect(d.added.length).toBe(1);
    expect(d.added[0]).toEqual({ index: 1, col: 1, row: 0, cell: 5 });
  });

  it("removed: occupied → empty reports the flat index", () => {
    const d = diffBricks([1, 2, 3, 0], [1, 0, 3, 0]);
    expect(d.removed).toEqual([1]);
  });

  it("changed: occupied → different occupied (silver hit states)", () => {
    const d = diffBricks([2, 0, 0, 0], [9, 0, 0, 0]);
    expect(d.changed.length).toBe(1);
    expect(d.changed[0]).toEqual({ index: 0, col: 0, row: 0, cell: 9 });
  });

  it("mixed diff classifies every cell correctly", () => {
    const prev = [1, 2, 0, 0, 4, 4];
    const next = [1, 0, 7, 0, 9, 4];
    const d = diffBricks(prev, next);
    expect(d.removed).toEqual([1]);
    expect(d.added.map((a) => a.index)).toEqual([2]);
    expect(d.changed.map((c) => c.index)).toEqual([4]);
  });

  it("length mismatch truncates at the shorter grid (never throws)", () => {
    expect(() => diffBricks([1, 2], [1])).not.toThrow();
    const d = diffBricks([1, 2], [1]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });
});

describe("fieldSceneModel (snapshot → view model)", () => {
  function snap(): Snapshot {
    const sim = createRoundSim(getLevel(1), { lives: 3, score: 0 });
    return sim.snapshot();
  }

  it("extracts the field player's view model from a snapshot", () => {
    const s = snap();
    const model = fieldSceneModel(s, 0);
    expect(model).not.toBeNull();
    expect(model!.paddle).toEqual(s.players[0]!.paddle);
    expect(model!.balls.length).toBe(s.balls.length);
    expect(model!.hud.name).toBe("Player 1");
    expect(model!.hud.round).toBe(s.round);
    expect(model!.hud.lives).toBe(3);
  });

  it("returns null for a player not in the snapshot", () => {
    const s = snap();
    expect(fieldSceneModel(s, 7)).toBeNull();
  });

  it("capsules copy by value (no shared refs with the snapshot)", () => {
    const s = snap();
    const model = fieldSceneModel(s, 0);
    expect(model!.capsules).not.toBe(s.capsules);
  });

  it("balls carry x/y/owner only (render shape)", () => {
    const s = snap();
    const model = fieldSceneModel(s, 0);
    for (const b of model!.balls) {
      expect(Object.keys(b).sort()).toEqual(["owner", "x", "y"]);
    }
  });

  it("bricks field is empty (incremental diff owns bricks)", () => {
    const model = fieldSceneModel(snap(), 0);
    expect(model!.bricks).toEqual([]);
  });
});
