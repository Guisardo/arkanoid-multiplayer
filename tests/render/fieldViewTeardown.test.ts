// FieldView / SplitScreenView teardown (ticket #151).
//
// Regression: the solo resize handler and the multiplayer render teardown
// destroyed a view's container directly, never its VisualEffects — leaking the
// pooled particles and pop BitmapTexts of every field ever torn down.
import { describe, expect, it, vi } from "vitest";
import { FieldView } from "render/fieldView";
import { SplitScreenView } from "render/splitScreen";
import { layoutField } from "render/layout";

function makeView(): FieldView {
  return new FieldView({
    layout: layoutField({ x: 0, y: 0, w: 800, h: 600 }),
    player: 0,
    locale: "en-US",
    maxRound: 33,
  });
}

function makeSplit(): SplitScreenView {
  return new SplitScreenView({ viewport: { w: 800, h: 600 }, players: [0, 1], locale: "en-US", maxRound: 33 });
}

describe("FieldView.destroy (ticket #151)", () => {
  it("releases the effects orchestrator, then the display tree", () => {
    const view = makeView();
    const effects = vi.spyOn(view.visualEffects, "destroy");
    view.destroy();
    expect(effects).toHaveBeenCalledTimes(1);
    expect(view.container.destroyed).toBe(true);
  });

  it("is idempotent — a second destroy is a no-op, not a throw", () => {
    const view = makeView();
    const effects = vi.spyOn(view.visualEffects, "destroy");
    view.destroy();
    expect(() => {
      view.destroy();
    }).not.toThrow();
    expect(effects).toHaveBeenCalledTimes(1);
  });
});

describe("SplitScreenView teardown (ticket #151)", () => {
  it("a resize rebuild destroys every old field through FieldView.destroy", () => {
    const split = makeSplit();
    const old = [...split.views];
    const spies = old.map((v) => vi.spyOn(v, "destroy"));
    split.resize({ w: 1000, h: 600 });
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(split.views.every((v) => !old.includes(v))).toBe(true);
  });

  it("destroy() tears down every field and the split container", () => {
    const split = makeSplit();
    const spies = split.views.map((v) => vi.spyOn(v.visualEffects, "destroy"));
    split.destroy();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(split.container.destroyed).toBe(true);
    expect(split.views).toHaveLength(0);
  });
});
