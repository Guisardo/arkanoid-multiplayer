// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { GAME_FONT_CHARS, GAME_FONT_NAME, installGameFont } from "render/gameFont";

describe("BitmapText atlas charset (spec §14)", () => {
  it("covers Basic Latin letters and digits", () => {
    for (const ch of "abcdefghijklmnopqrstuvwxyz0123456789") {
      expect(GAME_FONT_CHARS).toContain(ch);
    }
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      expect(GAME_FONT_CHARS).toContain(ch);
    }
  });
  it("covers Latin-1 Supplement accents required by both locales", () => {
    for (const ch of ["á", "é", "í", "ó", "ú", "ñ", "ü", "¿", "¡"]) {
      expect(GAME_FONT_CHARS).toContain(ch);
    }
  });
  it("covers uppercase accents (punctuation-safe names)", () => {
    for (const ch of ["Á", "É", "Í", "Ó", "Ú", "Ñ", "Ü"]) {
      expect(GAME_FONT_CHARS).toContain(ch);
    }
  });
  it("has no duplicate characters", () => {
    const set = new Set(GAME_FONT_CHARS.split(""));
    expect(set.size).toBe(GAME_FONT_CHARS.length);
  });
});

describe("installGameFont (runtime atlas)", () => {
  it("installs the BitmapFont once with the full charset (browser path)", async () => {
    const installs: Array<Record<string, unknown>> = [];
    const { BitmapFont, TextStyle } = await import("pixi.js");
    const spy = vi.spyOn(BitmapFont, "install").mockImplementation((opts) => {
      installs.push(opts as Record<string, unknown>);
      return {} as never;
    });
    try {
      installGameFont();
      installGameFont(); // second call: no-op (installed flag)
      expect(installs.length).toBe(1);
      expect(installs[0]!.name).toBe(GAME_FONT_NAME);
      expect(installs[0]!.chars).toBe(GAME_FONT_CHARS);
      expect(installs[0]!.resolution).toBe(2);
      expect(installs[0]!.style).toBeInstanceOf(TextStyle);
    } finally {
      spy.mockRestore();
    }
  });
});
