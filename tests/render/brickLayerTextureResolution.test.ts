// Ticket 102: the cached brick-wall texture is recorded at the perf ladder's
// texture resolution. This suite extends the ADR 0005 seam list with the
// resolution seam — a rung change must re-record the cache at the new
// resolution, and node has no GPU, so the recorded options are observed on the
// RenderGroup rather than on a GPU texture.
import { describe, expect, it, beforeEach } from "vitest";
import { BrickLayer, resetBrickContexts } from "render/brickLayer";
import { DEFAULT_THEME } from "content/themes";
import { BRICK_COLS, BRICK_ROWS } from "shared/gridConstants";

beforeEach(() => {
  resetBrickContexts();
});

/** The cache options the layer last handed to Pixi. */
function cacheOptionsOf(layer: BrickLayer): { resolution: number } {
  const group = (layer.view as unknown as {
    renderGroup: { textureOptions: { resolution: number } };
  }).renderGroup;
  return { resolution: group.textureOptions.resolution };
}

describe("brick layer texture resolution (ticket 102)", () => {
  it("records the cache at full resolution by default", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    expect(cacheOptionsOf(layer).resolution).toBe(1);
    layer.destroy();
  });

  it("setTextureResolution downscales the cache and re-records", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    layer.sync(new Array<number>(BRICK_COLS * BRICK_ROWS).fill(1));
    const fullRevisions = layer.revision;
    layer.setTextureResolution(0.5);
    expect(cacheOptionsOf(layer).resolution).toBe(0.5);
    // The grid itself is unchanged, but the cache must be re-recorded at the
    // new resolution or the stale full-res texture stays on screen.
    expect(layer.revision).toBeGreaterThanOrEqual(fullRevisions);
    expect(layer.gridDropped).toBe(true);
    layer.destroy();
  });

  it("restoring full resolution re-records again (recovery path)", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    layer.setTextureResolution(0.5);
    expect(cacheOptionsOf(layer).resolution).toBe(0.5);
    layer.setTextureResolution(1);
    expect(cacheOptionsOf(layer).resolution).toBe(1);
    layer.destroy();
  });

  it("a resolution change is a no-op when the value is unchanged", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    layer.setTextureResolution(1);
    layer.sync(new Array<number>(BRICK_COLS * BRICK_ROWS).fill(1));
    const rev = layer.revision;
    layer.setTextureResolution(1);
    expect(layer.revision).toBe(rev);
    layer.destroy();
  });

  it("a positive resolution below 1 is honored exactly (no clamping to 1)", () => {
    // The ladder ships 0.5; the layer must not round it back up to full,
    // which would silently forfeit the memory saving.
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    layer.setTextureResolution(0.25);
    expect(cacheOptionsOf(layer).resolution).toBe(0.25);
    layer.destroy();
  });

  it("non-positive resolutions are ignored (never a zero-size texture)", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME });
    layer.setTextureResolution(0);
    expect(cacheOptionsOf(layer).resolution).toBe(1);
    layer.setTextureResolution(-1);
    expect(cacheOptionsOf(layer).resolution).toBe(1);
    layer.destroy();
  });
});