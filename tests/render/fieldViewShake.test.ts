// Regression: the shake layer is pivoted on the field center, so its resting
// position must stay the center once the effects orchestrator writes its
// (0,0)-at-rest offset. Writing the offset raw shifted the whole field by the
// pivot and rendered it off-screen in every mode.
import { describe, expect, it } from "vitest";
import type { Container } from "pixi.js";
import { FieldView } from "render/fieldView";
import { layoutField } from "render/layout";
import { FIELD_H, FIELD_W } from "shared/gridConstants";
import type { Snapshot } from "shared/protocol";
import { createRoundSim } from "sim/roundSim";
import { getLevelSync } from "content/levels";

function makeView(): FieldView {
  return new FieldView({
    layout: layoutField({ x: 0, y: 0, w: 800, h: 600 }),
    player: 0,
    locale: "en-US",
    maxRound: 33,
  });
}

/** The shake layer is the last child mounted on the field container. */
function shakeLayerOf(view: FieldView): Container {
  const fieldContainer = view.container.children[2] as Container;
  return fieldContainer.children[fieldContainer.children.length - 1] as Container;
}

/** A real round-start snapshot with the given event ring. */
function snapWith(events: Snapshot["events"]): Snapshot {
  const sim = createRoundSim(getLevelSync(1), { lives: 3, score: 0 });
  return { ...sim.snapshot(), events };
}

describe("FieldView shake layer placement", () => {
  it("keeps the field content in place at rest after an effects tick", () => {
    const view = makeView();
    view.sync(snapWith([]));
    view.tickEffects(0.016);
    const layer = shakeLayerOf(view);
    expect(layer.x).toBe(FIELD_W / 2);
    expect(layer.y).toBe(FIELD_H / 2);
    expect(layer.rotation).toBe(0);
    // Net transform of a field point is identity: pivot cancels position.
    expect(layer.x - layer.pivot.x).toBe(0);
    expect(layer.y - layer.pivot.y).toBe(0);
    view.container.destroy({ children: true });
  });

  it("shakes around the field center, never away from it", () => {
    const view = makeView();
    view.sync(snapWith([{ type: "bossDead", source: 0, target: -1, tick: 5 }]));
    for (let i = 0; i < 10; i++) {
      view.tickEffects(0.016);
      const layer = shakeLayerOf(view);
      expect(Math.abs(layer.x - layer.pivot.x)).toBeLessThan(FIELD_W / 4);
      expect(Math.abs(layer.y - layer.pivot.y)).toBeLessThan(FIELD_H / 4);
    }
    view.container.destroy({ children: true });
  });

  it("returns exactly to the center once the shake expires", () => {
    const view = makeView();
    view.sync(snapWith([{ type: "brickBreak", source: 0, target: 1, tick: 5 }]));
    for (let i = 0; i < 400; i++) view.tickEffects(0.016);
    const layer = shakeLayerOf(view);
    expect(layer.x).toBeCloseTo(FIELD_W / 2, 6);
    expect(layer.y).toBeCloseTo(FIELD_H / 2, 6);
    expect(layer.rotation).toBe(0);
    view.container.destroy({ children: true });
  });
});
