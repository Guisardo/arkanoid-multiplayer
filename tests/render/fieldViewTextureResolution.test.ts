// Ticket 102: the perf ladder's texture resolution has to reach every field.
// FieldView forwards it to its own cached wall; SplitScreenView forwards it to
// every field, so a degraded rung never leaves one field at full resolution.
import { describe, expect, it } from "vitest";
import { FieldView } from "render/fieldView";
import { SplitScreenView } from "render/splitScreen";
import { layoutField } from "render/layout";
import { DEFAULT_THEME } from "content/themes";

function makeFieldView(textureResolution?: number): FieldView {
  return new FieldView({
    player: 0,
    locale: "en-US",
    maxRound: 33,
    layout: layoutField({ x: 0, y: 0, w: 800, h: 600 }),
    ...(textureResolution === undefined ? {} : { textureResolution }),
  });
}

describe("FieldView texture resolution (ticket 102)", () => {
  it("defaults to full resolution", () => {
    expect(makeFieldView().textureResolution).toBe(1);
  });

  it("forwards a downscale to the cached brick wall", () => {
    const view = makeFieldView();
    view.setTextureResolution(0.5);
    expect(view.textureResolution).toBe(0.5);
  });

  it("accepts the resolution at construction (start-on-degraded case)", () => {
    expect(makeFieldView(0.5).textureResolution).toBe(0.5);
  });

  it("recovery restores full resolution", () => {
    const view = makeFieldView();
    view.setTextureResolution(0.5);
    view.setTextureResolution(1);
    expect(view.textureResolution).toBe(1);
  });
});

describe("SplitScreenView texture resolution (ticket 102)", () => {
  it("applies the downscale to every field, not just the first", () => {
    const split = new SplitScreenView({
      viewport: { w: 800, h: 600 },
      players: [0, 1, 2, 3],
      locale: "en-US",
      maxRound: 33,
    });
    expect(split.fieldCount).toBe(4);
    split.setTextureResolution(0.5);
    for (const view of split.views) expect(view.textureResolution).toBe(0.5);
    split.setTextureResolution(1);
    for (const view of split.views) expect(view.textureResolution).toBe(1);
  });

  it("fields rebuilt on resize inherit the current texture resolution", () => {
    const split = new SplitScreenView({
      viewport: { w: 800, h: 600 },
      players: [0, 1],
      locale: "en-US",
      maxRound: 33,
    });
    split.setTextureResolution(0.5);
    split.resize({ w: 400, h: 600 });
    for (const view of split.views) expect(view.textureResolution).toBe(0.5);
  });

  it("a field created at the downscale starts downscaled (constructor path)", () => {
    const split = new SplitScreenView({
      viewport: { w: 800, h: 600 },
      players: [0],
      locale: "en-US",
      maxRound: 33,
      textureResolution: 0.5,
    });
    for (const view of split.views) expect(view.textureResolution).toBe(0.5);
  });
});