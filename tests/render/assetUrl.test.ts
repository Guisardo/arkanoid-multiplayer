import { describe, expect, it } from "vitest";
import { joinAssetUrl } from "render/assetUrl";

describe("asset URL join (ticket 55)", () => {
  it("root base keeps the path unchanged", () => {
    expect(joinAssetUrl("/", "/assets/paddles/paddle-a-red.png")).toBe(
      "/assets/paddles/paddle-a-red.png",
    );
  });

  it("subpath base prefixes the path", () => {
    expect(joinAssetUrl("/arkanoid-multiplayer/", "/assets/balls/ball-red.png")).toBe(
      "/arkanoid-multiplayer/assets/balls/ball-red.png",
    );
  });

  it("base without trailing slash still joins cleanly", () => {
    expect(joinAssetUrl("/arkanoid-multiplayer", "/assets/backgrounds/pixel-space.png")).toBe(
      "/arkanoid-multiplayer/assets/backgrounds/pixel-space.png",
    );
  });

  it("relative path gets its leading slash", () => {
    expect(joinAssetUrl("/arkanoid-multiplayer/", "assets/balls/ball-red.png")).toBe(
      "/arkanoid-multiplayer/assets/balls/ball-red.png",
    );
  });

  it("absolute URLs pass through untouched", () => {
    expect(joinAssetUrl("/arkanoid-multiplayer/", "https://example.com/sprite.png")).toBe(
      "https://example.com/sprite.png",
    );
    expect(joinAssetUrl("/arkanoid-multiplayer/", "data:image/png;base64,xxx")).toBe(
      "data:image/png;base64,xxx",
    );
  });
});
