// Settings state + apply logic (spec §14). Pure, headless-testable.
import type { Storage } from "persistence/storage";
import { DEFAULT_SKIN_ID, getSkin } from "content/skins";
import { DEFAULT_THEME_ID, getTheme } from "content/themes";

export interface AudioSettings {
  music: number;
  sfx: number;
  mute: boolean;
}

export interface DisplaySettings {
  dprMode: "auto" | "2" | "1.5" | "1";
  reducedEffects: boolean;
}

export interface AppearanceSettings {
  /** Default player skin UUID (Settings Appearance; lobby overrides per-player). */
  skinId: string;
  /** Preferred field theme UUID (host-chosen in lobby; this is the default). */
  themeId: string;
}

export function loadSettings(storage: Storage): {
  audio: AudioSettings;
  display: DisplaySettings;
  appearance: AppearanceSettings;
} {
  const all = storage.loadAll();
  return {
    audio: { ...all.audio },
    display: { ...all.display },
    appearance: {
      // Unknown/garbage stored ids fall back to registry defaults.
      skinId: getSkin(all.skin)?.id ?? DEFAULT_SKIN_ID,
      themeId: getTheme(all.theme)?.id ?? DEFAULT_THEME_ID,
    },
  };
}

export function saveSettings(
  storage: Storage,
  partial: {
    audio?: Partial<AudioSettings>;
    display?: Partial<DisplaySettings>;
    appearance?: Partial<AppearanceSettings>;
  },
): void {
  const cur = loadSettings(storage);
  storage.savePartial({
    audio: { ...cur.audio, ...partial.audio },
    display: { ...cur.display, ...partial.display },
    skin: partial.appearance?.skinId ?? cur.appearance.skinId,
    theme: partial.appearance?.themeId ?? cur.appearance.themeId,
  });
}

/** Effective dpr: auto → min(device, 2); numeric modes capped at 2 (spec §12). */
export function effectiveDpr(dprMode: DisplaySettings["dprMode"], deviceDpr: number): number {
  if (dprMode === "auto") return Math.min(deviceDpr, 2);
  return Math.min(Number(dprMode), 2);
}
