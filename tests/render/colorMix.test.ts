import { describe, expect, it } from "vitest";
import { darken, lighten, mixColor } from "render/colorMix";

describe("color mixing (issue #160)", () => {
  it("returns the endpoints at t = 0 and t = 1", () => {
    expect(mixColor(0x3cbcfc, 0x101018, 0)).toBe(0x3cbcfc);
    expect(mixColor(0x3cbcfc, 0x101018, 1)).toBe(0x101018);
  });

  it("mixes each channel independently and rounds", () => {
    expect(mixColor(0x000000, 0xff8040, 0.5)).toBe(0x804020);
  });

  it("lighten mixes toward white, darken toward black", () => {
    expect(lighten(0x804020, 0.5)).toBe(0xc0a090);
    expect(darken(0x804020, 0.5)).toBe(0x402010);
  });

  it("rejects a mix factor outside [0, 1]", () => {
    expect(() => mixColor(0, 0xffffff, 1.5)).toThrow(/mixColor: t must be in \[0, 1\] \(t=1\.5\)/);
    expect(() => lighten(0, -0.1)).toThrow(RangeError);
  });
});
