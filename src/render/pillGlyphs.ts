// Capsule pill letter glyphs (spec §13): 3×5 pixel font for the 10 capsule
// letters — drawn as 1×1 logical-unit rects over the pill body (pill-template
// + glyph composite). Pure data — unit-testable headless.
export const PILL_LETTERS = ["B", "C", "D", "E", "L", "M", "P", "S", "R", "?"] as const;

/** 5 rows × 3 cols, "1" = pixel on. */
export const PILL_GLYPHS: Record<(typeof PILL_LETTERS)[number], readonly string[]> = {
  B: ["111", "101", "110", "101", "111"],
  C: ["111", "100", "100", "100", "111"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "101", "101", "101"],
  P: ["111", "101", "111", "100", "100"],
  S: ["111", "100", "111", "001", "111"],
  R: ["111", "101", "110", "101", "101"],
  "?": ["110", "001", "010", "000", "010"],
};

/** Glyph pixels as (x, y) offsets from glyph top-left (3×5 grid). */
export function glyphPixels(letter: string): Array<{ x: number; y: number }> {
  const glyph = (PILL_GLYPHS as Partial<Record<string, readonly string[]>>)[letter];
  if (!glyph) return [];
  const pixels: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < glyph.length; y++) {
    const row = glyph[y] ?? "";
    for (let x = 0; x < row.length; x++) {
      if (row[x] === "1") pixels.push({ x, y });
    }
  }
  return pixels;
}
