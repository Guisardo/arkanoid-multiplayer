import { describe, expect, it } from "vitest";
import { GAME_FONT_CHARS } from "render/gameFont";

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
