// Settings state + apply logic (spec §14). Pure, headless-testable.
import type { Storage } from "persistence/storage";
import { DEFAULT_SKIN_ID, getSkin } from "content/skins";
import { DEFAULT_THEME_ID, getTheme } from "content/themes";
import {
  DEFAULT_GAMEPAD_BINDINGS,
  DEFAULT_KEYBOARD_BINDINGS,
  parseGamepadBindings,
  parseKeyboardBindings,
  serializeGamepadBindings,
  serializeKeyboardBindings,
  type GamepadBindingsMap,
  type KeyboardBindingsMap,
} from "input/bindings";

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

export interface ControlsSettings {
  /** Per-local-player keyboard maps (spec §11; corrupt → defaults). */
  keyboard: KeyboardBindingsMap;
  /** Gamepad button map (movement fixed; corrupt → defaults). */
  gamepad: GamepadBindingsMap;
}

export function loadSettings(storage: Storage): {
  audio: AudioSettings;
  display: DisplaySettings;
  appearance: AppearanceSettings;
  controls: ControlsSettings;
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
    controls: {
      keyboard: parseKeyboardBindings(all.bindingsKeyboard),
      gamepad: parseGamepadBindings(all.bindingsGamepad),
    },
  };
}

export function saveSettings(
  storage: Storage,
  partial: {
    audio?: Partial<AudioSettings>;
    display?: Partial<DisplaySettings>;
    appearance?: Partial<AppearanceSettings>;
    controls?: Partial<ControlsSettings>;
  },
): void {
  const cur = loadSettings(storage);
  const patch: Parameters<Storage["savePartial"]>[0] = {
    audio: { ...cur.audio, ...partial.audio },
    display: { ...cur.display, ...partial.display },
    skin: partial.appearance?.skinId ?? cur.appearance.skinId,
    theme: partial.appearance?.themeId ?? cur.appearance.themeId,
  };
  if (partial.controls?.keyboard !== undefined) {
    patch.bindingsKeyboard = serializeKeyboardBindings(partial.controls.keyboard);
  }
  if (partial.controls?.gamepad !== undefined) {
    patch.bindingsGamepad = serializeGamepadBindings(partial.controls.gamepad);
  }
  storage.savePartial(patch);
}

/** Reset controls to spec defaults (rebind screen "Reset"). */
export function resetControls(storage: Storage): ControlsSettings {
  storage.savePartial({
    bindingsKeyboard: serializeKeyboardBindings(DEFAULT_KEYBOARD_BINDINGS),
    bindingsGamepad: serializeGamepadBindings(DEFAULT_GAMEPAD_BINDINGS),
  });
  return {
    keyboard: DEFAULT_KEYBOARD_BINDINGS,
    gamepad: DEFAULT_GAMEPAD_BINDINGS,
  };
}

/** Effective dpr: auto → min(device, 2); numeric modes capped at 2 (spec §12). */
export function effectiveDpr(dprMode: DisplaySettings["dprMode"], deviceDpr: number): number {
  if (dprMode === "auto") return Math.min(deviceDpr, 2);
  return Math.min(Number(dprMode), 2);
}
