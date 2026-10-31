// FieldView → BrickLayer wall-cache density plumbing (ticket #151).
//
// The wall cache was recorded at one texel per field unit and stretched by the
// layout scale × DPR, which blurred every brick. The view must hand its own
// layout scale and the renderer resolution to the layer, through construction,
// DPR rung changes and split-screen rebuilds alike.
import { describe, expect, it } from "vitest";
import { FieldView } from "render/fieldView";
import { SplitScreenView } from "render/splitScreen";
import { layoutField } from "render/layout";

const region = { x: 0, y: 0, w: 800, h: 600 };

function makeView(over: { rendererResolution?: number; textureResolution?: number } = {}): FieldView {
  return new FieldView({ layout: layoutField(region), player: 0, locale: "en-US", maxRound: 33, ...over });
}

describe("field view wall-cache density (ticket #151)", () => {
  it("records the wall at layout scale × renderer resolution", () => {
    const view = makeView({ rendererResolution: 2 });
    expect(view.wallCacheResolution).toBeCloseTo(layoutField(region).scale * 2);
  });

  it("applies the perf-ladder factor on top of the screen density", () => {
    const view = makeView({ rendererResolution: 2, textureResolution: 0.5 });
    expect(view.wallCacheResolution).toBeCloseTo(layoutField(region).scale);
  });

  it("follows a renderer resolution change", () => {
    const view = makeView({ rendererResolution: 2 });
    view.setRendererResolution(1);
    expect(view.wallCacheResolution).toBeCloseTo(layoutField(region).scale);
  });

  it("split-screen fields keep the live renderer resolution across a resize rebuild", () => {
    const split = new SplitScreenView({
      viewport: { w: 800, h: 600 },
      players: [0, 1],
      locale: "en-US",
      maxRound: 33,
      rendererResolution: 2,
    });
    split.setRendererResolution(1.5);
    split.resize({ w: 1000, h: 600 });
    const scales = split.views.map((v) => v.wallCacheResolution);
    expect(scales).toHaveLength(2);
    expect(split.wallCacheResolutions).toEqual(scales);
    // Every rebuilt field derives its density from the live 1.5, not the initial 2.
    const expectedFirst = layoutField({ x: 0, y: 0, w: 500, h: 600 }).scale * 1.5;
    expect(scales[0]).toBeCloseTo(expectedFirst, 1);
  });
});
