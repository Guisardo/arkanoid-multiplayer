import { describe, expect, it } from "vitest";
import { RENDERER_CONFIG } from "render/appShell";

describe("renderer config (spec §3)", () => {
  it("locks antialias off", () => {
    expect(RENDERER_CONFIG.antialias).toBe(false);
  });
  it("locks context alpha off", () => {
    expect(RENDERER_CONFIG.useContextAlpha).toBe(false);
  });
  it("prefers webgl", () => {
    expect(RENDERER_CONFIG.preference).toBe("webgl");
  });
});
