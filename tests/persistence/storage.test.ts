import { describe, expect, it } from "vitest";
import {
  Storage,
  STORAGE_KEYS,
  LEGACY_KEYS,
  DEFAULTS,
  type StorageBackend,
} from "persistence/storage";
import { COMPOSITE_KEY, CURRENT_SCHEMA_VERSION, type SaveDocument } from "persistence/saveDocument";
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

interface FakeBackend extends StorageBackend {
  map: Map<string, string>;
  /** Every setItem call, in order — proves the write is a single atomic put. */
  writes: Array<{ key: string; value: string }>;
  removals: string[];
}

function fakeBackend(): FakeBackend {
  const map = new Map<string, string>();
  const writes: Array<{ key: string; value: string }> = [];
  const removals: string[] = [];
  return {
    map,
    writes,
    removals,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      writes.push({ key: k, value: v });
      map.set(k, v);
    },
    removeItem: (k) => {
      removals.push(k);
      map.delete(k);
    },
  };
}

/** Deterministic clock + device id so documents are comparable. */
function testStorage(backend: StorageBackend, clock = { t: 1_700_000_000_000 }): Storage {
  return new Storage(backend, { deviceId: "device-fixed", now: () => clock.t });
}

function readDoc(b: FakeBackend): SaveDocument {
  const raw = b.map.get(COMPOSITE_KEY);
  if (raw === undefined || raw === null) throw new Error("no composite document was written");
  return JSON.parse(raw) as SaveDocument;
}

describe("Storage — composite key (ADR 0008)", () => {
  it("exposes the composite key and the current schema version", () => {
    const s = new Storage(fakeBackend());
    expect(s.key).toBe("arkanoid.save.v1");
    expect(s.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
  });

  it("stores the whole save under one key with the full SaveDocument schema", () => {
    const b = fakeBackend();
    const s = testStorage(b);
    s.savePartial({ name: "Lucas" });
    const doc = readDoc(b);
    expect(doc.schemaVersion).toBe(1);
    expect(doc.updatedAt).toBe(1_700_000_000_000);
    expect(doc.deviceId).toBe("device-fixed");
    expect(doc.settings.name).toBe("Lucas");
    expect(doc.settings.audio).toEqual({ music: 0.8, sfx: 0.8, mute: false });
    expect(doc.settings.display).toEqual({ dprMode: "auto", reducedEffects: false });
    expect(doc.solo).toEqual({ highScore: 0, highestRound: 0 });
    expect([...b.map.keys()]).toEqual([COMPOSITE_KEY]);
  });

  it("round-trips every field of the save through the document", () => {
    const b = fakeBackend();
    const s = testStorage(b);
    s.savePartial({
      name: "Lucas",
      skin: "uuid-1234",
      theme: "theme-5678",
      bindingsKeyboard: "{}",
      bindingsGamepad: "{}",
      audio: { music: 0.5, sfx: 0.3, mute: true },
      display: { dprMode: "1.5", reducedEffects: true },
      language: "es-419",
      soloHighScore: 12345,
      soloHighestRound: 12,
    });
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

  it("writes atomically: exactly one setItem, then the legacy keys are removed", () => {
    const b = fakeBackend();
    b.map.set(STORAGE_KEYS.name, "Legacy");
    b.map.set(STORAGE_KEYS.soloHighScore, "900");
    const s = testStorage(b);

    // The legacy layout is folded into the very same single atomic put.
    s.savePartial({ audio: { music: 0.1, sfx: 0.9, mute: true } });
    expect(b.writes).toHaveLength(1);
    expect(b.writes[0]!.key).toBe(COMPOSITE_KEY);
    expect(b.removals).toEqual([...LEGACY_KEYS]);
    expect([...b.map.keys()]).toEqual([COMPOSITE_KEY]);
    // The migrated legacy record survived the fold.
    expect(readDoc(b).solo.highScore).toBe(900);

    // Every later save is likewise a single put.
    b.writes.length = 0;
    s.savePartial({ name: "Solo" });
    expect(b.writes).toHaveLength(1);
    expect(b.writes[0]!.key).toBe(COMPOSITE_KEY);
  });

  it("reading never mutates storage", () => {
    const b = fakeBackend();
    seedLegacyKeys(b);
    const s = testStorage(b);
    s.loadAll();
    s.loadDocument();
    s.loadAll();
    expect(b.writes).toHaveLength(0);
    expect(b.removals).toHaveLength(0);
    expect(b.map.has(STORAGE_KEYS.name)).toBe(true);
  });

  it("atomic write simulation: a failing setItem leaves the previous save AND the legacy keys intact", () => {
    const map = new Map<string, string>();
    map.set(
      COMPOSITE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: 10,
        deviceId: "device-fixed",
        settings: { ...DEFAULTS, name: "Committed" },
        solo: { highScore: 42, highestRound: 3 },
      }),
    );
    map.set(STORAGE_KEYS.name, "Legacy");
    const backend: StorageBackend = {
      getItem: (k) => map.get(k) ?? null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: (k) => {
        map.delete(k);
      },
    };
    const before = JSON.parse(map.get(COMPOSITE_KEY) ?? "{}") as SaveDocument;
    const s = testStorage(backend);
    s.savePartial({ name: "ShouldNotPersist" });
    // Nothing was torn: the old document and the legacy keys both survive.
    expect(before.settings.name).toBe("Committed");
    expect(map.get(STORAGE_KEYS.name)).toBe("Legacy");
    // And the last good save is still what reads back.
    expect(s.loadAll().name).toBe("Committed");
    expect(s.loadAll().soloHighScore).toBe(42);
  });

  it("never throws when the backend itself is hostile", () => {
    const backend: StorageBackend = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    const s = new Storage(backend, { deviceId: "d", now: () => 1 });
    expect(() => s.loadAll()).not.toThrow();
    expect(s.loadAll()).toEqual(DEFAULTS);
    expect(() => {
      s.writeAll({ ...DEFAULTS, name: "x" });
    }).not.toThrow();
    expect(s.loadAll().name).toBe("Player 1");
  });
});

function seedLegacyKeys(b: FakeBackend): void {
  b.map.set(STORAGE_KEYS.name, "LegacyHero");
  b.map.set(STORAGE_KEYS.skin, "legacy-skin");
  b.map.set(STORAGE_KEYS.audio, JSON.stringify({ music: 0.25, sfx: 0.5, mute: true }));
  b.map.set(STORAGE_KEYS.display, JSON.stringify({ dprMode: "1", reducedEffects: true }));
  b.map.set(STORAGE_KEYS.language, "es-419");
  b.map.set(STORAGE_KEYS.soloHighScore, "777");
  b.map.set(STORAGE_KEYS.soloHighestRound, "9");
}

describe("Storage — read with migration (legacy per-key layout)", () => {
  it("reads the legacy layout transparently and keeps the values", () => {
    const b = fakeBackend();
    seedLegacyKeys(b);
    const s = testStorage(b);
    const all = s.loadAll();
    expect(all.name).toBe("LegacyHero");
    expect(all.skin).toBe("legacy-skin");
    expect(all.audio).toEqual({ music: 0.25, sfx: 0.5, mute: true });
    expect(all.display).toEqual({ dprMode: "1", reducedEffects: true });
    expect(all.language).toBe("es-419");
    expect(all.soloHighScore).toBe(777);
    expect(all.soloHighestRound).toBe(9);
  });

  it("commits the migrated document and deletes the legacy keys on the first write", () => {
    const b = fakeBackend();
    seedLegacyKeys(b);
    const s = testStorage(b);
    s.savePartial({ name: "Renamed" });
    expect([...b.map.keys()]).toEqual([COMPOSITE_KEY]);
    const doc = readDoc(b);
    expect(doc.schemaVersion).toBe(1);
    expect(doc.deviceId).toBe("device-fixed");
    expect(doc.settings.name).toBe("Renamed");
    expect(doc.settings.skin).toBe("legacy-skin");
    expect(doc.settings.display).toEqual({ dprMode: "1", reducedEffects: true });
    expect(doc.solo).toEqual({ highScore: 777, highestRound: 9 });
  });

  it("only migrates once — a later composite document wins over stale legacy keys", () => {
    const b = fakeBackend();
    seedLegacyKeys(b);
    const s = testStorage(b);
    s.savePartial({ name: "Committed" });
    // Someone's ancient build writes a legacy key again after the migration.
    b.map.set(STORAGE_KEYS.name, "StaleGhost");
    expect(s.loadAll().name).toBe("Committed");
  });

  it("prefers the composite document over legacy keys when both exist", () => {
    const b = fakeBackend();
    seedLegacyKeys(b);
    b.map.set(
      COMPOSITE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: 5,
        deviceId: "real-device",
        settings: { ...DEFAULTS, name: "Composite" },
        solo: { highScore: 1, highestRound: 1 },
      }),
    );
    const s = testStorage(b);
    expect(s.loadAll().name).toBe("Composite");
    // Legacy keys are only cleaned up on the next successful write.
    expect(b.map.has(STORAGE_KEYS.name)).toBe(true);
    s.savePartial({ audio: { music: 0.4, sfx: 0.4, mute: false } });
    expect(b.map.has(STORAGE_KEYS.name)).toBe(false);
  });

  it("corrupt legacy values coerce to defaults instead of migrating garbage", () => {
    const b = fakeBackend();
    seedLegacyKeys(b);
    b.map.set(STORAGE_KEYS.audio, "{corrupt json!!");
    b.map.set(STORAGE_KEYS.display, "not json at all");
    b.map.set(STORAGE_KEYS.soloHighScore, "garbage");
    b.map.set(STORAGE_KEYS.name, "");
    const s = testStorage(b);
    const all = s.loadAll();
    expect(all.audio).toEqual(DEFAULTS.audio);
    expect(all.display).toEqual(DEFAULTS.display);
    expect(all.soloHighScore).toBe(0);
    expect(all.name).toBe("");
  });
});

describe("Storage — corruption recovery", () => {
  it("returns defaults when the composite value is not JSON at all", () => {
    const b = fakeBackend();
    b.map.set(COMPOSITE_KEY, "{not json");
    const s = testStorage(b);
    expect(s.loadAll()).toEqual(DEFAULTS);
  });

  it("falls back per field when the document has the wrong shape", () => {
    const b = fakeBackend();
    b.map.set(
      COMPOSITE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: "yesterday",
        deviceId: "",
        settings: { name: 42, audio: { music: 7, sfx: -3, mute: "yes" }, display: { dprMode: "9" } },
        solo: { highScore: "lots" },
      }),
    );
    const s = testStorage(b);
    const all = s.loadAll();
    expect(all.name).toBe(DEFAULTS.name);
    // Out-of-range volumes clamp rather than corrupt the mixer.
    expect(all.audio).toEqual({ music: 1, sfx: 0, mute: false });
    expect(all.display).toEqual({ dprMode: "auto", reducedEffects: false });
    expect(all.soloHighScore).toBe(0);
    const doc = s.loadDocument();
    expect(doc.deviceId).toBe("device-fixed");
    expect(doc.updatedAt).toBe(1_700_000_000_000);
  });

  it("recovers to defaults when the schema version is missing or from the future", () => {
    const b = fakeBackend();
    b.map.set(COMPOSITE_KEY, JSON.stringify({ updatedAt: 1, settings: DEFAULTS }));
    expect(testStorage(b).loadAll()).toEqual(DEFAULTS);

    b.map.set(COMPOSITE_KEY, JSON.stringify({ schemaVersion: 99, settings: DEFAULTS, solo: {} }));
    expect(testStorage(b).loadAll()).toEqual(DEFAULTS);
  });

  it("a corrupt document is not destroyed until a real write replaces it", () => {
    const b = fakeBackend();
    b.map.set(COMPOSITE_KEY, "{broken");
    const s = testStorage(b);
    s.loadAll();
    expect(b.map.get(COMPOSITE_KEY)).toBe("{broken");
    s.savePartial({ name: "Recovered" });
    expect(readDoc(b).settings.name).toBe("Recovered");
  });
});

describe("Storage — device id (sync readiness)", () => {
  it("generates a device id once and persists it", () => {
    const b = fakeBackend();
    const first = new Storage(b, { now: () => 1 });
    const id = first.loadDocument().deviceId;
    expect(id).toMatch(/^[0-9a-f-]{16,}$/i);
    first.savePartial({ name: "A" });
    // A later instance reads the persisted id back rather than minting a new one.
    expect(new Storage(b, { now: () => 2 }).loadDocument().deviceId).toBe(id);
  });

  it("shares one generated id across the several Storage instances on a page", () => {
    const b = fakeBackend();
    expect(new Storage(b).loadDocument().deviceId).toBe(new Storage(b).loadDocument().deviceId);
  });
});

describe("Storage — merge semantics", () => {
  it("returns defaults when empty", () => {
    const s = new Storage(fakeBackend());
    const all = s.loadAll();
    expect(all).toEqual(DEFAULTS);
    expect(all.name).toBe("Player 1");
    expect(all.audio).toEqual({ music: 0.8, sfx: 0.8, mute: false });
    expect(all.display).toEqual({ dprMode: "auto", reducedEffects: false });
    expect(all.soloHighScore).toBe(0);
  });

  it("savePartial merges over current state", () => {
    const s = testStorage(fakeBackend());
    s.savePartial({ audio: { music: 0.1, sfx: 0.9, mute: false } });
    s.savePartial({ audio: { music: 0.1, sfx: 0.9, mute: true } });
    const all = s.loadAll();
    expect(all.audio).toEqual({ music: 0.1, sfx: 0.9, mute: true });
  });

  it("omitted fields are unchanged, and the composite document makes fields clearable", () => {
    const s = testStorage(fakeBackend());
    s.savePartial({ skin: "skin-a", language: "es-419" });
    s.savePartial({ name: "Renamed" });
    expect(s.loadAll().skin).toBe("skin-a");
    // Pre-ADR-0008 `writeAll` skipped nulls, so a skin could never be unset.
    // The document stores nulls, so an explicit null now clears the field.
    s.savePartial({ skin: null });
    expect(s.loadAll().skin).toBeNull();
    expect(s.loadAll().language).toBe("es-419");
  });

  it("recordSolo keeps the max records and never touches settings", () => {
    const b = fakeBackend();
    const s = testStorage(b);
    s.savePartial({ name: "Kept", audio: { music: 0.2, sfx: 0.2, mute: true } });
    s.recordSolo(100, 3);
    s.recordSolo(50, 9);
    const all = s.loadAll();
    expect(all.soloHighScore).toBe(100);
    expect(all.soloHighestRound).toBe(9);
    expect(all.name).toBe("Kept");
    expect(all.audio).toEqual({ music: 0.2, sfx: 0.2, mute: true });
  });

  it("stamps updatedAt on every write", () => {
    const b = fakeBackend();
    const clock = { t: 1000 };
    const s = testStorage(b, clock);
    s.savePartial({ name: "One" });
    clock.t = 2000;
    s.savePartial({ name: "Two" });
    expect(readDoc(b).updatedAt).toBe(2000);
  });
});

describe("settings logic", () => {
  it("loadSettings/saveSettings round-trip with partial merge", () => {
    const s = testStorage(fakeBackend());
    saveSettings(s, { audio: { music: 0.2 } });
    saveSettings(s, { display: { dprMode: "1" } });
    const cur = loadSettings(s);
    expect(cur.audio.music).toBe(0.2);
    expect(cur.audio.sfx).toBe(0.8);
    expect(cur.display.dprMode).toBe("1");
    expect(cur.display.reducedEffects).toBe(false);
  });

  it("appearance: defaults to registry defaults; persists skin + theme UUIDs (spec §16)", () => {
    const s = testStorage(fakeBackend());
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

  it("appearance: persisted inside the composite document's settings", () => {
    const b = fakeBackend();
    const s = testStorage(b);
    saveSettings(s, { appearance: { skinId: SKINS[1]!.id, themeId: THEMES[1]!.id } });
    expect(readDoc(b).settings.skin).toBe(SKINS[1]!.id);
    expect(readDoc(b).settings.theme).toBe(THEMES[1]!.id);
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
    const s = testStorage(fakeBackend());
    const cur = loadSettings(s);
    expect(cur.controls.keyboard).toEqual(DEFAULT_KEYBOARD_BINDINGS);
    expect(cur.controls.gamepad).toEqual(DEFAULT_GAMEPAD_BINDINGS);
  });

  it("saveSettings persists keyboard + gamepad maps in the document", () => {
    const b = fakeBackend();
    const s = testStorage(b);
    const kb: KeyboardBindingsMap = [
      { ...DEFAULT_KEYBOARD_BINDINGS[0]!, launch: ["KeyP"], menu: ["F2"] },
      DEFAULT_KEYBOARD_BINDINGS[1]!,
    ];
    const gp: GamepadBindingsMap = { ...DEFAULT_GAMEPAD_BINDINGS, launch: ["x"] };
    saveSettings(s, { controls: { keyboard: kb, gamepad: gp } });
    const doc = readDoc(b);
    expect(doc.settings.bindingsKeyboard).toBe(serializeKeyboardBindings(kb));
    expect(doc.settings.bindingsGamepad).toBe(serializeGamepadBindings(gp));
    const after = loadSettings(s);
    expect(after.controls.keyboard).toEqual(kb);
    expect(after.controls.gamepad).toEqual(gp);
  });

  it("partial controls save: keyboard-only save keeps gamepad intact", () => {
    const s = testStorage(fakeBackend());
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
    b.map.set(
      COMPOSITE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: 1,
        deviceId: "d",
        settings: { ...DEFAULTS, bindingsKeyboard: "{corrupt!!", bindingsGamepad: "also corrupt" },
        solo: { highScore: 0, highestRound: 0 },
      }),
    );
    const cur = loadSettings(testStorage(b));
    expect(cur.controls.keyboard).toEqual(DEFAULT_KEYBOARD_BINDINGS);
    expect(cur.controls.gamepad).toEqual(DEFAULT_GAMEPAD_BINDINGS);
  });

  it("resetControls restores spec defaults", () => {
    const s = testStorage(fakeBackend());
    saveSettings(s, {
      controls: { keyboard: [{ ...DEFAULT_KEYBOARD_BINDINGS[0]!, launch: ["KeyP"] }] },
    });
    const reset = resetControls(s);
    expect(reset.keyboard).toEqual(DEFAULT_KEYBOARD_BINDINGS);
    expect(reset.gamepad).toEqual(DEFAULT_GAMEPAD_BINDINGS);
    expect(loadSettings(s).controls.keyboard).toEqual(DEFAULT_KEYBOARD_BINDINGS);
  });
});
