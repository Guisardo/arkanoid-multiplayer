import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { SKINS, DEFAULT_SKIN, DEFAULT_SKIN_ID, getSkin, skinByIndex } from "content/skins";
import { THEMES, DEFAULT_THEME, DEFAULT_THEME_ID, getTheme } from "content/themes";
import { CAPSULE_PILLS, pillFor } from "content/capsulePills";
import { BOSSES, DOH_BOSS, getBoss } from "content/bosses";
import { skinPassesGate, contrastRatio, GLOW_MIN_CONTRAST } from "content/readabilityGate";
import { PLAYER_COLORS } from "shared/playerColors";
import { SPRITE_PATHS } from "content/spriteFrames";
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

  it("every referenced sprite is in the AssetPack atlas (atlas frame)", () => {
    // The art is packed into one atlas per bundle (ticket 87): boot/ and
    // gameplay/. A sprite may live in either, so take the union of their frames.
    const assetsDir = path.join(process.cwd(), "public", "assets");
    const atlasFrames = new Set<string>();
    for (const bundleDir of ["boot", "gameplay"]) {
      const dir = path.join(assetsDir, bundleDir);
      const tables = readdirSync(dir).filter((f) => f.endsWith(".png.json"));
      expect(tables.length, `${bundleDir} atlas JSON must exist`).toBeGreaterThan(0);
      for (const file of tables) {
        const atlas = JSON.parse(readFileSync(path.join(dir, file), "utf-8")) as {
          frames: Record<string, unknown>;
        };
        for (const frame of Object.keys(atlas.frames)) atlasFrames.add(frame);
      }
    }
    
    // Issue #152: the key is looked up verbatim in the frame cache, so it must
    // equal the frame name exactly. Comparing `path.basename` once let stale
    // "/assets/paddles/..." paths pass while every lookup missed.
    const keys: Array<{ owner: string; key: string }> = [];
    for (const s of SKINS) {
      if (s.paddle.sprite !== null) keys.push({ owner: `${s.name} paddle`, key: s.paddle.sprite });
      if (s.ball.sprite !== null) keys.push({ owner: `${s.name} ball`, key: s.ball.sprite });
    }
    for (const t of THEMES) {
      if (t.background.sprite !== null) keys.push({ owner: `${t.name} background`, key: t.background.sprite });
    }
    expect(keys.length).toBeGreaterThan(0);
    for (const { owner, key } of keys) {
      expect(atlasFrames.has(key), `${owner}: "${key}" must be an atlas frame name`).toBe(true);
    }
  });

  it("every Skin/Field theme sprite key is one the loader registers", () => {
    const registered = new Set<string>([
      ...Object.values(SPRITE_PATHS.paddles),
      ...Object.values(SPRITE_PATHS.balls),
      ...Object.values(SPRITE_PATHS.backgrounds),
    ]);
    for (const s of SKINS) {
      expect(registered.has(s.paddle.sprite ?? ""), `${s.name} paddle`).toBe(true);
      expect(registered.has(s.ball.sprite ?? ""), `${s.name} ball`).toBe(true);
    }
    expect(THEMES.some((t) => t.background.sprite === "pixel-space.png")).toBe(true);
    for (const t of THEMES) {
      if (t.background.sprite !== null) expect(registered.has(t.background.sprite), t.name).toBe(true);
    }
  });

  it("every Skin shares the one white-base ball frame", () => {
    for (const s of SKINS) expect(s.ball.sprite, s.name).toBe("ball-base.png");
  });

  it("sourced sprites carry sourced provenance; procedural ones declare it", () => {
    for (const s of SKINS) {
      const sourced = s.paddle.sprite !== null || s.ball.sprite !== null;
      expect(s.paddle.provenance.production === "sourced").toBe(sourced);
      expect(s.ball.provenance.production === "sourced").toBe(sourced);
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
