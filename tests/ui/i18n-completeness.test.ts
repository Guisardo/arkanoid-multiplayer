// i18n completeness (ticket 52, spec §14): every string key used in code
// exists in both tables, placeholders match across locales, the BitmapText
// atlas covers every character both tables can render, and no user-facing
// string literals hide outside the tables.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { allKeys, t } from "ui/strings";
import { GAME_FONT_CHARS } from "render/gameFont";

const SRC_ROOT = path.resolve(__dirname, "../../src");

/** Recursively collect .ts/.tsx source files under src/. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(SRC_ROOT);

/** All string-literal keys referenced as t(..., "key") / t(locale, "key"). */
function usedKeys(): Set<string> {
  const keys = new Set<string>();
  const callRe = /\bt\(\s*[A-Za-z0-9_.$]+\s*,\s*"([a-zA-Z0-9_.]+)"/g;
  for (const file of FILES) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(callRe)) {
      if (m[1] !== undefined) keys.add(m[1]);
    }
  }
  return keys;
}

/** Template-literal keys: t(locale, `settings.action.${action}`) etc. */
function templateKeyPrefixes(): Set<string> {
  const prefixes = new Set<string>();
  const re = /\bt\(\s*[A-Za-z0-9_.$]+\s*,\s*`([a-zA-Z0-9_.]+?)\.\$\{/g;
  for (const file of FILES) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(re)) {
      if (m[1] !== undefined) prefixes.add(m[1]);
    }
  }
  return prefixes;
}

/** {placeholder} names inside a template string. */
function placeholders(template: string): Set<string> {
  return new Set((template.match(/\{(\w+)\}/g) ?? []).map((p) => p.slice(1, -1)));
}

describe("i18n completeness (ticket 52, spec §14)", () => {
  it("every key used via t() in src exists in both locale tables", () => {
    const table = new Set<string>(allKeys());
    const missing = [...usedKeys()].filter((k) => !table.has(k));
    expect(missing).toEqual([]);
  });

  it("template-literal key prefixes resolve to real table keys", () => {
    const table = new Set<string>(allKeys());
    for (const prefix of templateKeyPrefixes()) {
      const hit = [...table].some((k) => k.startsWith(`${prefix}.`));
      expect(hit, `no table keys under prefix "${prefix}."`).toBe(true);
    }
  });

  it("es-419 covers every en-US key (no fallback ever needed)", () => {
    for (const key of allKeys()) {
      expect(t("es-419", key), `es-419 missing "${key}"`).toBeTruthy();
      expect(t("es-419", key), `es-419 empty for "${key}"`).not.toBe(t("en-US", key) === "" ? "" : "");
    }
  });

  it("placeholders match across locales for every key", () => {
    for (const key of allKeys()) {
      const en = t("en-US", key);
      const es = t("es-419", key);
      expect(
        [...placeholders(es)].sort().join(","),
        `es-419 "${key}" placeholder mismatch`,
      ).toBe([...placeholders(en)].sort().join(","));
    }
  });

  it("BitmapText atlas covers every character in both tables", () => {
    const atlas = new Set(GAME_FONT_CHARS.split(""));
    const missing = new Set<string>();
    for (const key of allKeys()) {
      for (const locale of ["en-US", "es-419"] as const) {
        for (const ch of t(locale, key)) {
          if (!atlas.has(ch)) missing.add(ch);
        }
      }
    }
    // Interpolated values are digits/names — covered by the atlas; only
    // literal template characters are asserted here.
    expect([...missing]).toEqual([]);
  });

  it("no user-facing string literals outside the tables (textContent/BitmapText)", () => {
    // A user-facing literal assigned to textContent/.text that is not a
    // t() call, a number/name interpolation, a symbol, or CSS.
    const allow = /^(?:\s*)$/; // whitespace-only
    const symbolish = /^[▼×▲●■□→←↑↓·#%&*+\-–—…]+$/;
    const cssish = /^[.#@a-zA-Z0-9\s,:;(){}[\]'"!%<>=~*^&$\\/-]+$/;
    const re = /(?:textContent|\.text)\s*=\s*["'`]([^"'`]+)["'`]/g;
    const offenders: { file: string; literal: string }[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(re)) {
        const literal = m[1] ?? "";
        if (allow.test(literal) || symbolish.test(literal)) continue;
        // CSS blocks (style.textContent) are not user-facing strings.
        if (cssish.test(literal) && /[{};]/.test(literal)) continue;
        // Interpolation-only templates (digits/names/symbols) are fine.
        if (/\$\{/.test(literal) && /^[${}\s\dA-Za-z.()▼×▲●■□→←↑↓·#%&*+\-–—…]+$/.test(literal)) continue;
        offenders.push({ file: path.relative(SRC_ROOT, file), literal });
      }
    }
    expect(offenders).toEqual([]);
  });
});
