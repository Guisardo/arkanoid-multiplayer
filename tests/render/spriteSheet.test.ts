// spriteSheet tests (ticket 54 coverage): texture cache + loader paths.
// Node-guarded: spriteTexture returns null without DOM; rememberTexture
// + loadSkinSprites run against a mocked Pixi Assets in jsdom.
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const loadedPaths: string[] = [];

vi.mock("pixi.js", () => {
  return {
    Assets: {
      load: async (path: string): Promise<unknown> => {
        await Promise.resolve();
        loadedPaths.push(path);
        return { texture: path };
      },
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
  it("SPRITE_PATHS covers paddles, balls, backgrounds", () => {
    expect(Object.keys(SPRITE_PATHS.paddles).length).toBe(3);
    expect(Object.keys(SPRITE_PATHS.balls).length).toBe(3);
    expect(Object.keys(SPRITE_PATHS.backgrounds).length).toBe(1);
  });

  it("spriteTexture returns null for unknown paths", () => {
    expect(spriteTexture("/assets/nope.png")).toBeNull();
  });

  it("rememberTexture caches; spriteTexture returns the same instance", () => {
    const tex = { texture: "x" } as never;
    rememberTexture("/assets/paddles/paddle-a-red.png", tex);
    expect(spriteTexture("/assets/paddles/paddle-a-red.png")).toBe(tex);
  });

  it("loadSkinSprites loads every shipped path once", async () => {
    loadedPaths.length = 0;
    await loadSkinSprites();
    const expected = [
      ...Object.values(SPRITE_PATHS.paddles),
      ...Object.values(SPRITE_PATHS.balls),
      ...Object.values(SPRITE_PATHS.backgrounds),
    ];
    expect(loadedPaths.sort()).toEqual([...expected].sort());
  });

  it("load failure degrades silently (never throws)", async () => {
    const { Assets } = await import("pixi.js");
    const spy = vi.spyOn(Assets, "load").mockRejectedValue(new Error("404"));
    await expect(loadSkinSprites()).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
