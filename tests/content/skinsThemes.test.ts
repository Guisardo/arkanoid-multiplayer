import { describe, expect, it } from "vitest";
import { SKINS, DEFAULT_SKIN, DEFAULT_SKIN_ID, getSkin, skinByIndex } from "content/skins";
import { THEMES, DEFAULT_THEME, DEFAULT_THEME_ID, getTheme } from "content/themes";
import { CAPSULE_PILLS, pillFor } from "content/capsulePills";
import { BOSSES, DOH_BOSS, getBoss } from "content/bosses";
import { skinPassesGate, contrastRatio, GLOW_MIN_CONTRAST } from "content/readabilityGate";
import { PLAYER_COLORS } from "shared/playerColors";
import type { CapsuleTypeId } from "shared/protocol";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("skin/theme registries (spec §13)", () => {
  it("skin ids are UUIDs and unique", () => {
    const ids = new Set(SKINS.map((s) => s.id));
    expect(ids.size).toBe(SKINS.length);
    for (const s of SKINS) expect(s.id).toMatch(UUID_RE);
  });

  it("theme ids are UUIDs and unique", () => {
    const ids = new Set(THEMES.map((t) => t.id));
    expect(ids.size).toBe(THEMES.length);
    for (const t of THEMES) expect(t.id).toMatch(UUID_RE);
  });

  it("brick-set ids inside themes are unique", () => {
    const ids = new Set(THEMES.map((t) => t.brickSet.id));
    expect(ids.size).toBe(THEMES.length);
  });

  it("no id collisions across registries (skins vs themes vs bosses)", () => {
    const all = [...SKINS.map((s) => s.id), ...THEMES.map((t) => t.id), ...BOSSES.map((b) => b.id)];
    expect(new Set(all).size).toBe(all.length);
  });

  it("lookups: known ids resolve, unknown/null fall back", () => {
    expect(getSkin(DEFAULT_SKIN_ID)).toBe(DEFAULT_SKIN);
    expect(getSkin("nope")).toBeNull();
    expect(getSkin(null)).toBeNull();
    expect(getTheme(DEFAULT_THEME_ID)).toBe(DEFAULT_THEME);
    expect(getTheme("nope")).toBeNull();
    expect(getTheme(null)).toBeNull();
    expect(getBoss(DOH_BOSS.id)).toBe(DOH_BOSS);
    expect(getBoss("nope")).toBeNull();
  });

  it("skinByIndex maps compact session indices; out-of-range → default", () => {
    expect(skinByIndex(0)).toBe(DEFAULT_SKIN);
    expect(skinByIndex(SKINS.length - 1).id).toBe(SKINS[SKINS.length - 1]?.id);
    expect(skinByIndex(255)).toBe(DEFAULT_SKIN);
    expect(skinByIndex(-1)).toBe(DEFAULT_SKIN);
  });

  it("every skin has full paddle + ball set with provenance", () => {
    for (const s of SKINS) {
      expect(s.paddle.trimThickness).toBeGreaterThan(0);
      expect(s.ball.radius).toBeGreaterThan(0);
      expect(s.paddle.provenance.license).toBe("CC0");
      expect(s.ball.provenance.license).toBe("CC0");
    }
  });

  it("every theme covers tiers 1..6 + silver + gold", () => {
    for (const t of THEMES) {
      for (let tier = 1; tier <= 6; tier++) {
        expect(t.brickSet.tierColors[tier], `${t.name} tier ${String(tier)}`).toBeDefined();
      }
      expect(t.brickSet.silverColor).toBeDefined();
      expect(t.brickSet.goldColor).toBeDefined();
    }
  });
});

describe("capsule pills (spec §13)", () => {
  it("one pill per CapsuleTypeId — all 10 letters", () => {
    const letters = new Set(CAPSULE_PILLS.map((p) => p.letter));
    const expected: readonly CapsuleTypeId[] = ["B", "C", "D", "E", "L", "M", "P", "S", "R", "?"];
    expect(letters.size).toBe(10);
    for (const l of expected) expect(letters.has(l)).toBe(true);
  });

  it("pill colors are distinct enough to read at game scale", () => {
    const colors = new Set(CAPSULE_PILLS.map((p) => p.color));
    expect(colors.size).toBe(CAPSULE_PILLS.length);
  });

  it("letter contrasts with pill body (readable glyph)", () => {
    for (const p of CAPSULE_PILLS) {
      expect(contrastRatio(p.letterColor, p.color)).toBeGreaterThanOrEqual(3);
    }
  });

  it("pillFor resolves every type; unknown falls back to E", () => {
    for (const p of CAPSULE_PILLS) expect(pillFor(p.letter)).toBe(p);
    expect(pillFor("X").letter).toBe("E");
  });
});

describe("readability gate (spec §13 hard constraint)", () => {
  it("every shipped skin passes the gate over every shipped theme", () => {
    for (const skin of SKINS) {
      for (const theme of THEMES) {
        expect(
          skinPassesGate(skin, theme),
          `${skin.name} × ${theme.name}`,
        ).toBe(true);
      }
    }
  });

  it("owner glow: every player color contrasts over every theme background", () => {
    for (const theme of THEMES) {
      for (const color of PLAYER_COLORS) {
        expect(
          contrastRatio(color, theme.background.color),
          `P color ${String(color)} on ${theme.name}`,
        ).toBeGreaterThanOrEqual(GLOW_MIN_CONTRAST);
      }
    }
  });

  it("ball skins are white-base (tintable) — owner tint is render-time, never authored PNGs", () => {
    for (const s of SKINS) {
      expect(s.ball.baseColor).toBeGreaterThanOrEqual(0xf0f0f0);
    }
  });

  it("gate rejects a dark ball skin (not tintable)", () => {
    expect(
      skinPassesGate(
        {
          paddle: DEFAULT_SKIN.paddle,
          ball: { ...DEFAULT_SKIN.ball, baseColor: 0x101018 },
        },
        DEFAULT_THEME,
      ),
    ).toBe(false);
  });

  it("gate rejects a low-contrast theme background", () => {
    const bad = {
      ...DEFAULT_THEME,
      background: { ...DEFAULT_THEME.background, color: 0xf84828 },
    };
    expect(skinPassesGate(DEFAULT_SKIN, bad)).toBe(false);
  });
});
