// spriteSheet tests (ticket 54 coverage): texture cache + loader paths.
// Node-guarded: spriteTexture returns null without DOM; rememberTexture
// + loadSkinSprites run against a mocked Pixi Assets in jsdom.
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// Mock Pixi Assets for the new AssetPack manifest-based loading
vi.mock("pixi.js", () => {
  return {
    Assets: {
      init: vi.fn().mockResolvedValue(undefined),
      loadBundle: vi.fn().mockResolvedValue(undefined),
      get: (alias: string) => ({ texture: alias }),
    },
  };
});

import {
  loadSkinSprites,
  rememberTexture,
  SPRITE_PATHS,
  spriteTexture,
} from "render/spriteSheet";

describe("spriteSheet (CC0 sprite cache)", () => {
  it("SPRITE_PATHS covers paddles, balls, backgrounds with atlas frame names", () => {
    expect(Object.keys(SPRITE_PATHS.paddles).length).toBe(3);
    expect(Object.keys(SPRITE_PATHS.balls).length).toBe(3);
    expect(Object.keys(SPRITE_PATHS.backgrounds).length).toBe(1);
    // Verify the new format uses frame names (not full paths)
    expect(SPRITE_PATHS.paddles.red).toBe("paddle-a-red.png");
    expect(SPRITE_PATHS.balls.red).toBe("ball-red.png");
    expect(SPRITE_PATHS.backgrounds.pixelSpace).toBe("pixel-space.png");
  });

  it("spriteTexture returns null for unknown paths", () => {
    expect(spriteTexture("unknown.png")).toBeNull();
  });

  it("rememberTexture caches; spriteTexture returns the same instance", () => {
    const tex = { texture: "x" } as never;
    rememberTexture("paddle-a-red.png", tex);
    expect(spriteTexture("paddle-a-red.png")).toBe(tex);
  });

  it("loadSkinSprites initializes Assets with manifest and loads default bundle", async () => {
    const { Assets } = await import("pixi.js");
    const initSpy = vi.spyOn(Assets, "init");
    const loadBundleSpy = vi.spyOn(Assets, "loadBundle");
    await loadSkinSprites();
    expect(initSpy).toHaveBeenCalledWith({ manifest: expect.any(String) });
    expect(loadBundleSpy).toHaveBeenCalledWith("default");
    initSpy.mockRestore();
    loadBundleSpy.mockRestore();
  });

  it("load failure degrades silently (never throws)", async () => {
    const { Assets } = await import("pixi.js");
    const initSpy = vi.spyOn(Assets, "init").mockRejectedValue(new Error("404"));
    await expect(loadSkinSprites()).resolves.toBeUndefined();
    initSpy.mockRestore();
  });
});