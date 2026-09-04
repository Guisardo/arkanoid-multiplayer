import { describe, expect, it } from "vitest";
import { Storage, STORAGE_KEYS, DEFAULTS, type StorageBackend } from "persistence/storage";
import { loadSettings, saveSettings, effectiveDpr, resetControls } from "ui/settings";
import { SKINS, DEFAULT_SKIN_ID } from "content/skins";
import { THEMES, DEFAULT_THEME_ID } from "content/themes";
import {
  DEFAULT_GAMEPAD_BINDINGS,
  DEFAULT_KEYBOARD_BINDINGS,
  serializeGamepadBindings,
  serializeKeyboardBindings,
  type GamepadBindingsMap,
  type KeyboardBindingsMap,
} from "input/bindings";

function fakeBackend(): StorageBackend & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe("Storage (spec §16 key table)", () => {
  it("returns defaults when empty", () => {
    const s = new Storage(fakeBackend());
    const all = s.loadAll();
    expect(all).toEqual(DEFAULTS);
    expect(all.name).toBe("Player 1");
    expect(all.audio).toEqual({ music: 0.8, sfx: 0.8, mute: false });
    expect(all.display).toEqual({ dprMode: "auto", reducedEffects: false });
    expect(all.soloHighScore).toBe(0);
  });

  it("typed round-trip across the full key table", () => {
    const b = fakeBackend();
    const s = new Storage(b);
    s.writeString(STORAGE_KEYS.name, "Lucas");
    s.writeString(STORAGE_KEYS.skin, "uuid-1234");
    s.writeString(STORAGE_KEYS.theme, "theme-5678");
    s.writeString(STORAGE_KEYS.bindingsKeyboard, "{}");
    s.writeString(STORAGE_KEYS.bindingsGamepad, "{}");
    s.writeJSON(STORAGE_KEYS.audio, { music: 0.5, sfx: 0.3, mute: true });
    s.writeJSON(STORAGE_KEYS.display, { dprMode: "1.5", reducedEffects: true });
    s.writeString(STORAGE_KEYS.language, "es-419");
    s.writeNumber(STORAGE_KEYS.soloHighScore, 12345);
    s.writeNumber(STORAGE_KEYS.soloHighestRound, 12);
    const all = s.loadAll();
    expect(all.name).toBe("Lucas");
    expect(all.skin).toBe("uuid-1234");
    expect(all.theme).toBe("theme-5678");
    expect(all.audio).toEqual({ music: 0.5, sfx: 0.3, mute: true });
    expect(all.display).toEqual({ dprMode: "1.5", reducedEffects: true });
    expect(all.language).toBe("es-419");
    expect(all.soloHighScore).toBe(12345);
    expect(all.soloHighestRound).toBe(12);
  });

  it("corrupt/unparseable values fall back to defaults, never throw", () => {
    const b = fakeBackend();
    b.map.set(STORAGE_KEYS.audio, "{corrupt json!!");
    b.map.set(STORAGE_KEYS.display, "not json at all");
    b.map.set(STORAGE_KEYS.soloHighScore, "garbage");
    b.map.set(STORAGE_KEYS.name, "");
    const s = new Storage(b);
    const all = s.loadAll();
    expect(all.audio).toEqual(DEFAULTS.audio);
    expect(all.display).toEqual(DEFAULTS.display);
    expect(all.soloHighScore).toBe(0);
    expect(all.name).toBe("");
  });

  it("savePartial merges over current state", () => {
    const s = new Storage(fakeBackend());
    s.savePartial({ audio: { music: 0.1, sfx: 0.9, mute: false } });
    s.savePartial({ audio: { music: 0.1, sfx: 0.9, mute: true } });
    const all = s.loadAll();
    expect(all.audio).toEqual({ music: 0.1, sfx: 0.9, mute: true });
  });

  it("recordSolo keeps the max records", () => {
    const s = new Storage(fakeBackend());
    s.recordSolo(100, 3);
    s.recordSolo(50, 9);
    const all = s.loadAll();
    expect(all.soloHighScore).toBe(100);
    expect(all.soloHighestRound).toBe(9);
  });
});

describe("settings logic", () => {
  it("loadSettings/saveSettings round-trip with partial merge", () => {
    const s = new Storage(fakeBackend());
    saveSettings(s, { audio: { music: 0.2 } });
    saveSettings(s, { display: { dprMode: "1" } });
    const cur = loadSettings(s);
    expect(cur.audio.music).toBe(0.2);
    expect(cur.audio.sfx).toBe(0.8);
    expect(cur.display.dprMode).toBe("1");
    expect(cur.display.reducedEffects).toBe(false);
  });

  it("appearance: defaults to registry defaults; persists skin + theme UUIDs (spec §16)", () => {
    const s = new Storage(fakeBackend());
    const cur = loadSettings(s);
    expect(cur.appearance.skinId).toBe(DEFAULT_SKIN_ID);
    expect(cur.appearance.themeId).toBe(DEFAULT_THEME_ID);
    saveSettings(s, { appearance: { skinId: "6f2a1c34-9b8e-4d5a-8f21-0c4d7e9a1b20" } });
    saveSettings(s, { appearance: { themeId: "7b2c8d4e-1a63-4f9b-8e2d-6c4a9f3b7e15" } });
    const after = loadSettings(s);
    expect(after.appearance.skinId).toBe("6f2a1c34-9b8e-4d5a-8f21-0c4d7e9a1b20");
    expect(after.appearance.themeId).toBe("7b2c8d4e-1a63-4f9b-8e2d-6c4a9f3b7e15");
    // partial merge: skin survives a theme-only save
    saveSettings(s, { appearance: { themeId: "1e4a9c7b-3f52-4d68-9c81-a5b3e7f2d904" } });
    const merged = loadSettings(s);
    expect(merged.appearance.skinId).toBe("6f2a1c34-9b8e-4d5a-8f21-0c4d7e9a1b20");
    expect(merged.appearance.themeId).toBe("1e4a9c7b-3f52-4d68-9c81-a5b3e7f2d904");
  });

  it("appearance: stored under settings.skin / settings.theme keys (§16 key table)", () => {
    const b = fakeBackend();
    const s = new Storage(b);
    saveSettings(s, { appearance: { skinId: SKINS[1]!.id, themeId: THEMES[1]!.id } });
    expect(b.map.get(STORAGE_KEYS.skin)).toBe(SKINS[1]!.id);
    expect(b.map.get(STORAGE_KEYS.theme)).toBe(THEMES[1]!.id);
  });

  it("effectiveDpr: auto caps at 2; numeric modes cap at 2", () => {
    expect(effectiveDpr("auto", 3)).toBe(2);
    expect(effectiveDpr("auto", 1.25)).toBe(1.25);
    expect(effectiveDpr("2", 3)).toBe(2);
    expect(effectiveDpr("1.5", 3)).toBe(1.5);
    expect(effectiveDpr("1", 3)).toBe(1);
  });
});

describe("controls settings (ticket 41)", () => {
  it("loadSettings returns default bindings when nothing stored", () => {
    const s = new Storage(fakeBackend());
    const cur = loadSettings(s);
    expect(cur.controls.keyboard).toEqual(DEFAULT_KEYBOARD_BINDINGS);
    expect(cur.controls.gamepad).toEqual(DEFAULT_GAMEPAD_BINDINGS);
  });

  it("saveSettings persists keyboard + gamepad maps under §16 keys", () => {
    const b = fakeBackend();
    const s = new Storage(b);
    const kb: KeyboardBindingsMap = [
      { ...DEFAULT_KEYBOARD_BINDINGS[0]!, launch: ["KeyP"], menu: ["F2"] },
      DEFAULT_KEYBOARD_BINDINGS[1]!,
    ];
    const gp: GamepadBindingsMap = { ...DEFAULT_GAMEPAD_BINDINGS, launch: ["x"] };
    saveSettings(s, { controls: { keyboard: kb, gamepad: gp } });
    expect(b.map.get(STORAGE_KEYS.bindingsKeyboard)).toBe(serializeKeyboardBindings(kb));
    expect(b.map.get(STORAGE_KEYS.bindingsGamepad)).toBe(serializeGamepadBindings(gp));
    const after = loadSettings(s);
    expect(after.controls.keyboard).toEqual(kb);
    expect(after.controls.gamepad).toEqual(gp);
  });

  it("partial controls save: keyboard-only save keeps gamepad intact", () => {
    const s = new Storage(fakeBackend());
    const gp: GamepadBindingsMap = { ...DEFAULT_GAMEPAD_BINDINGS, fire1: ["a"] };
    saveSettings(s, { controls: { gamepad: gp } });
    saveSettings(s, {
      controls: { keyboard: [{ ...DEFAULT_KEYBOARD_BINDINGS[0]!, left: ["KeyJ"] }] },
    });
    const after = loadSettings(s);
    expect(after.controls.gamepad).toEqual(gp);
    expect(after.controls.keyboard[0]!.left).toEqual(["KeyJ"]);
  });

  it("corrupt stored maps fall back to defaults (never throw)", () => {
    const b = fakeBackend();
    b.map.set(STORAGE_KEYS.bindingsKeyboard, "{corrupt!!");
    b.map.set(STORAGE_KEYS.bindingsGamepad, "also corrupt");
    const s = new Storage(b);
    const cur = loadSettings(s);
    expect(cur.controls.keyboard).toEqual(DEFAULT_KEYBOARD_BINDINGS);
    expect(cur.controls.gamepad).toEqual(DEFAULT_GAMEPAD_BINDINGS);
  });

  it("resetControls restores spec defaults", () => {
    const s = new Storage(fakeBackend());
    saveSettings(s, {
      controls: { keyboard: [{ ...DEFAULT_KEYBOARD_BINDINGS[0]!, launch: ["KeyP"] }] },
    });
    const reset = resetControls(s);
    expect(reset.keyboard).toEqual(DEFAULT_KEYBOARD_BINDINGS);
    expect(reset.gamepad).toEqual(DEFAULT_GAMEPAD_BINDINGS);
    expect(loadSettings(s).controls.keyboard).toEqual(DEFAULT_KEYBOARD_BINDINGS);
  });
});
