// Settings overlay route (spec §14): shows the SettingsScreen over the game.
import type { Locale } from "ui/strings";
import { SettingsScreen } from "ui/settingsScreen";
import type { Storage } from "persistence/storage";
import type { AudioSettings, DisplaySettings } from "ui/settings";

export function showSettings(
  host: HTMLElement,
  locale: Locale,
  storage: Storage,
  callbacks: {
    onChange?: (audio: AudioSettings, display: DisplaySettings) => void;
    onClose?: () => void;
  } = {},
): SettingsScreen {
  const screen = new SettingsScreen({
    host,
    locale,
    storage,
    onChange: callbacks.onChange ?? undefined,
    onClose: callbacks.onClose ?? undefined,
  });
  screen.open();
  return screen;
}
