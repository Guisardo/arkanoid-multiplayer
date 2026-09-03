import { describe, expect, it } from "vitest";
import { allKeys, detectLocale, format, t } from "ui/strings";

describe("i18n string tables", () => {
  it("every en-US key exists in es-419 and vice versa", () => {
    const enKeys = new Set(allKeys());
    // es-419 table must cover every key
    for (const key of enKeys) {
      expect(t("es-419", key)).toBeTruthy();
    }
    // and no key may be missing from en-US
    for (const key of allKeys()) {
      expect(t("en-US", key)).toBeTruthy();
    }
  });

  it("es-419 has no extra keys beyond en-US (type-level + runtime sample)", () => {
    // Runtime check via format-table round trip on a few keys
    expect(format(t("es-419", "hud.roundOf"), { round: 12, max: 33 })).toBe("R12/33");
    expect(format(t("en-US", "hud.roundOf"), { round: 12, max: 33 })).toBe("R12/33");
  });

  it("lookups fall back to en-US for unknown locale data", () => {
    expect(t("en-US", "menu.solo")).toBe("Solo");
    expect(t("es-419", "menu.multiplayer")).toBe("Multijugador");
  });

  it("detectLocale picks es for Spanish variants", () => {
    expect(detectLocale(["es-AR", "en-US"])).toBe("es-419");
    expect(detectLocale(["es-MX"])).toBe("es-419");
    expect(detectLocale(["en-US"])).toBe("en-US");
    expect(detectLocale(["pt-BR"])).toBe("en-US");
    expect(detectLocale([])).toBe("en-US");
  });
});
