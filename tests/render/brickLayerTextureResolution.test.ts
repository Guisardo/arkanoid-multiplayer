// Ticket 102: the cached brick-wall texture is recorded at the perf ladder's
// texture resolution. This suite extends the ADR 0005 seam list with the
// resolution seam — a rung change must re-record the cache at the new
// resolution, and node has no GPU, so the recorded options are observed on the
// RenderGroup rather than on a GPU texture.
import { describe, expect, it, beforeEach } from "vitest";
import { BrickLayer, MAX_WALL_TEXTURE_EDGE, resetBrickContexts, wallCacheResolution } from "render/brickLayer";
import { DEFAULT_THEME } from "content/themes";
import { BRICK_COLS, BRICK_ROWS, FIELD_H } from "shared/gridConstants";

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

// Ticket #151: Pixi records a cached render group at its *local* bounds ×
// resolution, and the wall's local space is field units — so resolution 1
// meant one texel per field unit, stretched ~7.5× (× DPR) on screen. The
// cache now matches the screen density the wall is drawn at.
describe("brick layer cache matches screen density (ticket #151)", () => {
  it("wallCacheResolution = layout scale × renderer resolution × rung factor", () => {
    expect(wallCacheResolution(3, 2, 1)).toBe(6);
    expect(wallCacheResolution(3, 2, 0.5)).toBe(3);
    expect(wallCacheResolution(1.5, 1, 1)).toBe(1.5);
  });

  it("caps the texture so its tallest edge stays within MAX_WALL_TEXTURE_EDGE", () => {
    expect(wallCacheResolution(20, 2, 1)).toBe(MAX_WALL_TEXTURE_EDGE / FIELD_H);
  });

  it("ignores unusable factors instead of asking for a zero-size texture", () => {
    expect(wallCacheResolution(0, 2, 1)).toBe(2);
    expect(wallCacheResolution(3, Number.NaN, 1)).toBe(3);
    expect(wallCacheResolution(3, 2, -1)).toBe(6);
  });

  it("records the cache at the field's on-screen density", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME, layoutScale: 3.2, rendererResolution: 2 });
    expect(cacheOptionsOf(layer).resolution).toBeCloseTo(6.4);
    expect(layer.cacheResolution).toBeCloseTo(6.4);
    layer.destroy();
  });

  it("the degraded rung halves the on-screen density, not an absolute 0.5", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME, layoutScale: 3, rendererResolution: 2 });
    layer.setTextureResolution(0.5);
    expect(cacheOptionsOf(layer).resolution).toBe(3);
    layer.destroy();
  });

  it("a renderer resolution change (DPR rung) re-records at the new density", () => {
    const layer = new BrickLayer({ theme: DEFAULT_THEME, layoutScale: 3, rendererResolution: 2 });
    layer.sync(new Array<number>(BRICK_COLS * BRICK_ROWS).fill(1));
    layer.setRendererResolution(1.5);
    expect(cacheOptionsOf(layer).resolution).toBe(4.5);
    expect(layer.gridDropped).toBe(true);
    layer.destroy();
  });
});
