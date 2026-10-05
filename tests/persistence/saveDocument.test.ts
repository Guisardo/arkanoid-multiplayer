import { describe, expect, it } from "vitest";
import {
  COMPOSITE_KEY,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  defaultDocument,
  documentFromLegacy,
  migrateDocument,
  newDeviceId,
  normalizeDocument,
  normalizeEpisode,
  normalizeSettings,
  normalizeSolo,
  stateFromDocument,
  type DocumentMeta,
  type SaveDocument,
} from "persistence/saveDocument";

const META: DocumentMeta = { now: 1_700_000_000_000, deviceId: "device-fixed" };

function v1(over: Partial<SaveDocument> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    updatedAt: 123,
    deviceId: "abc-123",
    settings: { ...DEFAULT_SETTINGS, name: "Hero" },
    solo: { highScore: 10, highestRound: 2 },
    ...over,
  };
}

describe("composite key", () => {
  it("is the versioned key the game owns", () => {
    expect(COMPOSITE_KEY).toBe("arkanoid.save.v1");
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
  });
});

describe("defaultDocument", () => {
  it("is a complete v1 document stamped with the injected meta", () => {
    const doc = defaultDocument(META);
    expect(doc).toEqual({
      schemaVersion: 1,
      updatedAt: 1_700_000_000_000,
      deviceId: "device-fixed",
      settings: {
        name: "Player 1",
        skin: null,
        theme: null,
        bindingsKeyboard: null,
        bindingsGamepad: null,
        audio: { music: 0.8, sfx: 0.8, mute: false },
        display: { dprMode: "auto", reducedEffects: false },
        language: null,
      },
      solo: { highScore: 0, highestRound: 0 },
    });
  });

  it("hands out an independent settings object each time", () => {
    const a = defaultDocument(META);
    const b = defaultDocument(META);
    a.settings.audio.music = 0;
    expect(b.settings.audio.music).toBe(0.8);
    expect(DEFAULT_SETTINGS.audio.music).toBe(0.8);
  });
});

describe("migrateDocument", () => {
  it("passes a current-version document through, normalized", () => {
    const doc = migrateDocument(v1(), META);
    expect(doc).not.toBeNull();
    expect(doc!.schemaVersion).toBe(1);
    expect(doc!.settings.name).toBe("Hero");
    expect(doc!.solo).toEqual({ highScore: 10, highestRound: 2 });
  });

  it("rejects anything that is not an object", () => {
    expect(migrateDocument(null, META)).toBeNull();
    expect(migrateDocument(42, META)).toBeNull();
    expect(migrateDocument("v1", META)).toBeNull();
    expect(migrateDocument([1, 2], META)).toBeNull();
  });

  it("rejects a document with no usable schemaVersion", () => {
    expect(migrateDocument({ settings: {} }, META)).toBeNull();
    expect(migrateDocument({ schemaVersion: 0 }, META)).toBeNull();
    expect(migrateDocument({ schemaVersion: -1 }, META)).toBeNull();
    expect(migrateDocument({ schemaVersion: 1.5 }, META)).toBeNull();
    expect(migrateDocument({ schemaVersion: "1" }, META)).toBeNull();
  });

  it("rejects a document written by a newer build", () => {
    expect(migrateDocument({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 }, META)).toBeNull();
  });

  it("preserves an optional episode payload", () => {
    const doc = migrateDocument(
      v1({
        soloEpisode: { round: 5, score: 900, lives: 2, phase: "playing", timestamp: 77 },
      }),
      META,
    );
    expect(doc!.soloEpisode).toEqual({ round: 5, score: 900, lives: 2, phase: "playing", timestamp: 77 });
  });

  it("drops an episode payload that does not match the schema", () => {
    expect(normalizeEpisode({ round: 1, score: 1, lives: 1, phase: "loading" as never })).toBeUndefined();
    expect(normalizeEpisode("nope")).toBeUndefined();
    expect(
      migrateDocument({ ...v1(), soloEpisode: { phase: "loading" } }, META)!.soloEpisode,
    ).toBeUndefined();
  });
});

describe("normalizeDocument", () => {
  it("keeps valid fields and repairs invalid ones field by field", () => {
    const doc = normalizeDocument(
      {
        schemaVersion: 99,
        updatedAt: -5,
        deviceId: 7,
        settings: { name: "", audio: { music: 0.5, sfx: "loud", mute: true } },
        solo: { highScore: 5, highestRound: -1 },
      },
      META,
    );
    expect(doc.schemaVersion).toBe(1);
    expect(doc.updatedAt).toBe(META.now);
    expect(doc.deviceId).toBe("device-fixed");
    // "" is a legitimate name (the settings screen allows clearing it).
    expect(doc.settings.name).toBe("");
    expect(doc.settings.audio).toEqual({ music: 0.5, sfx: 0.8, mute: true });
    expect(doc.solo).toEqual({ highScore: 5, highestRound: 0 });
  });

  it("survives a totally empty object", () => {
    expect(normalizeDocument({}, META)).toEqual(defaultDocument(META));
  });
});

describe("normalizeSettings", () => {
  it("clamps volumes into 0..1 and defaults non-numbers", () => {
    expect(normalizeSettings({ audio: { music: 5, sfx: -2, mute: 1 } }).audio).toEqual({
      music: 1,
      sfx: 0,
      mute: false,
    });
    expect(normalizeSettings({ audio: { music: Number.NaN, sfx: Infinity } }).audio).toEqual({
      music: 0.8,
      sfx: 0.8,
      mute: false,
    });
  });

  it("only accepts the four known dpr modes", () => {
    for (const mode of ["auto", "2", "1.5", "1"] as const) {
      expect(normalizeSettings({ display: { dprMode: mode } }).display.dprMode).toBe(mode);
    }
    expect(normalizeSettings({ display: { dprMode: "3" } }).display.dprMode).toBe("auto");
    expect(normalizeSettings({ display: {} }).display.reducedEffects).toBe(false);
  });

  it("keeps the empty-string language sentinel ('auto')", () => {
    expect(normalizeSettings({ language: "" }).language).toBe("");
    expect(normalizeSettings({ language: "es-419" }).language).toBe("es-419");
    expect(normalizeSettings({ language: 12 }).language).toBeNull();
  });
});

describe("normalizeSolo", () => {
  it("defaults missing or negative records to zero", () => {
    expect(normalizeSolo(undefined)).toEqual({ highScore: 0, highestRound: 0 });
    expect(normalizeSolo({ highScore: -1, highestRound: Number.NaN })).toEqual({
      highScore: 0,
      highestRound: 0,
    });
    expect(normalizeSolo({ highScore: 7, highestRound: 3 })).toEqual({ highScore: 7, highestRound: 3 });
  });
});

describe("legacy → document migration", () => {
  it("carries every flat field across", () => {
    const doc = documentFromLegacy(
      {
        name: "Legacy",
        skin: "s",
        theme: "t",
        bindingsKeyboard: "kb",
        bindingsGamepad: "gp",
        audio: { music: 0.1, sfx: 0.2, mute: true },
        display: { dprMode: "1", reducedEffects: true },
        language: "es-419",
        soloHighScore: 99,
        soloHighestRound: 4,
      },
      META,
    );
    expect(doc.settings).toEqual({
      name: "Legacy",
      skin: "s",
      theme: "t",
      bindingsKeyboard: "kb",
      bindingsGamepad: "gp",
      audio: { music: 0.1, sfx: 0.2, mute: true },
      display: { dprMode: "1", reducedEffects: true },
      language: "es-419",
    });
    expect(doc.solo).toEqual({ highScore: 99, highestRound: 4 });
    expect(doc.updatedAt).toBe(META.now);
    expect(doc.deviceId).toBe("device-fixed");
  });

  it("round-trips back to the flat view", () => {
    const flat = {
      name: "Round",
      skin: null,
      theme: null,
      bindingsKeyboard: "kb",
      bindingsGamepad: null,
      audio: { music: 0.3, sfx: 0.4, mute: false },
      display: { dprMode: "2" as const, reducedEffects: false },
      language: "",
      soloHighScore: 5,
      soloHighestRound: 6,
    };
    expect(stateFromDocument(documentFromLegacy(flat, META))).toEqual(flat);
  });

  it("stateFromDocument copies nested objects (no aliasing)", () => {
    const doc = defaultDocument(META);
    const view = stateFromDocument(doc);
    view.audio.music = 0;
    expect(doc.settings.audio.music).toBe(0.8);
  });
});

describe("newDeviceId", () => {
  it("produces a stable, non-empty id", () => {
    const a = newDeviceId();
    const b = newDeviceId();
    expect(a).toMatch(/^[0-9a-f-]{16,}$/i);
    expect(a).not.toBe("");
    expect(typeof b).toBe("string");
  });
});
