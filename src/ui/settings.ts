// Settings state + apply logic (spec §14). Pure, headless-testable.
import type { Storage } from "persistence/storage";

export interface AudioSettings {
  music: number;
  sfx: number;
  mute: boolean;
}

export interface DisplaySettings {
  dprMode: "auto" | "2" | "1.5" | "1";
  reducedEffects: boolean;
}

export function loadSettings(storage: Storage): { audio: AudioSettings; display: DisplaySettings } {
  const all = storage.loadAll();
  return {
    audio: { ...all.audio },
    display: { ...all.display },
  };
}

export function saveSettings(
  storage: Storage,
  partial: { audio?: Partial<AudioSettings>; display?: Partial<DisplaySettings> },
): void {
  const cur = loadSettings(storage);
  storage.savePartial({
    audio: { ...cur.audio, ...partial.audio },
    display: { ...cur.display, ...partial.display },
  });
}

/** Effective dpr: auto → min(device, 2); numeric modes capped at 2 (spec §12). */
export function effectiveDpr(dprMode: DisplaySettings["dprMode"], deviceDpr: number): number {
  if (dprMode === "auto") return Math.min(deviceDpr, 2);
  return Math.min(Number(dprMode), 2);
}
