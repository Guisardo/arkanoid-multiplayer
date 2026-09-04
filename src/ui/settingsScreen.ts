// Settings screen (spec §14): DOM overlay with four sections — Controls,
// Audio, Display, Appearance. Controls = full rebind UI (ticket 41): per-player
// keyboard tabs, gamepad buttons, duplicate rejection with highlight,
// rollover caveat. All strings from locale tables.
import { t, type Locale, type StringKey } from "ui/strings";
import type { Storage } from "persistence/storage";
import {
  loadSettings,
  saveSettings,
  resetControls,
  type AppearanceSettings,
  type AudioSettings,
  type DisplaySettings,
} from "ui/settings";
import { SKINS } from "content/skins";
import { THEMES } from "content/themes";
import {
  KEYBOARD_ACTIONS,
  GAMEPAD_ACTIONS,
  findKeyboardConflicts,
  findGamepadConflicts,
  type GamepadAction,
  type GamepadBindingsMap,
} from "input/bindings";
import type { KeyboardBindings, KeyboardBindingsKey } from "input/keyboard";
import { KEYSET_1 } from "input/keyboard";
import type { GamepadButton } from "input/gamepad";

/** `settings.action.*` string keys (rebind row labels). */
type StringActionKey = Extract<StringKey, `settings.action.${string}`>;

/** Injected once per document: conflict/capture highlight styles. */
const HIGHLIGHT_STYLE_ID = "arkanoid-rebind-highlight";
function ensureHighlightStyles(): void {
  if (document.getElementById(HIGHLIGHT_STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent =
    "button.conflict{border:2px solid #e33 !important;color:#e33 !important;}" +
    "button.capturing{border:2px solid #fd4 !important;color:#fd4 !important;}";
  document.head.appendChild(style);
}

export interface SettingsScreenOptions {
  host: HTMLElement;
  locale: Locale;
  storage: Storage;
  onChange?:
    | ((audio: AudioSettings, display: DisplaySettings, appearance: AppearanceSettings) => void)
    | undefined;
  onClose?: (() => void) | undefined;
}

export class SettingsScreen {
  /** Root element (exposed for tests/e2e probing). */
  readonly root: HTMLDivElement;
  private readonly opts: SettingsScreenOptions;
  private readonly keydownHandler: (e: KeyboardEvent) => void;
  private controlsPanel: HTMLElement | null = null;
  private activePlayer = 0;
  private activeDevice: "keyboard" | "gamepad" = "keyboard";
  private capture: { action: string; button: HTMLButtonElement } | null = null;
  private keyboardMaps: KeyboardBindings[];
  private gamepadMap: GamepadBindingsMap;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private prevPadButtons: Partial<Record<GamepadButton, boolean>> = {};

  constructor(opts: SettingsScreenOptions) {
    this.opts = opts;
    this.root = document.createElement("div");
    this.root.style.cssText =
      "position:absolute;inset:0;background:rgba(8,8,16,0.92);display:flex;" +
      "align-items:center;justify-content:center;z-index:1000;font-family:monospace;";
    const cur = loadSettings(this.opts.storage);
    this.keyboardMaps = cur.controls.keyboard.map((m) => ({ ...m }));
    this.gamepadMap = cur.controls.gamepad;
    this.keydownHandler = (e) => {
      this.onCaptureKey(e);
    };
    this.root.appendChild(this.build());
  }

  open(): void {
    if (!this.root.isConnected) {
      ensureHighlightStyles();
      this.opts.host.appendChild(this.root);
      globalThis.addEventListener("keydown", this.keydownHandler);
      // Gamepad rebind capture: poll button edges while the overlay is open.
      this.pollHandle = setInterval(() => {
        this.pollGamepadCapture();
      }, 50);
      // First local input takes focus (spec §11: any local input navigates menus).
      const first = this.root.querySelector<HTMLElement>("button");
      first?.focus();
    }
  }

  close(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    globalThis.removeEventListener("keydown", this.keydownHandler);
    this.root.remove();
    this.opts.onClose?.();
  }

  private build(): HTMLElement {
    const panel = document.createElement("div");
    panel.style.cssText =
      "background:#181828;color:#eee;padding:24px 32px;border:2px solid #444;" +
      "min-width:320px;display:flex;flex-direction:column;gap:12px;";

    const title = document.createElement("h2");
    title.textContent = t(this.opts.locale, "menu.settings");
    title.style.margin = "0 0 8px";
    panel.appendChild(title);

    const cur = loadSettings(this.opts.storage);
    for (const section of ["settings.controls", "settings.audio", "settings.display", "settings.appearance"] as const) {
      const h = document.createElement("h3");
      h.textContent = t(this.opts.locale, section);
      h.style.margin = "8px 0 4px";
      panel.appendChild(h);
      if (section === "settings.controls") {
        this.controlsPanel = this.buildControls();
        panel.appendChild(this.controlsPanel);
      } else if (section === "settings.audio") panel.appendChild(this.buildAudio(cur.audio));
      else if (section === "settings.display") panel.appendChild(this.buildDisplay(cur.display));
      else panel.appendChild(this.buildAppearance(cur.appearance));
    }

    const back = document.createElement("button");
    back.textContent = t(this.opts.locale, "menu.back");
    back.style.cssText = "margin-top:12px;padding:8px 16px;font-family:monospace;";
    back.addEventListener("click", () => {
      this.close();
    });
    panel.appendChild(back);
    return panel;
  }

  private buildAudio(cur: AudioSettings): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-direction:column;gap:6px;";
    const mkSlider = (key: "music" | "sfx", value: number): HTMLInputElement => {
      const row = document.createElement("label");
      row.textContent = t(this.opts.locale, key === "music" ? "settings.music" : "settings.sfx");
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.value = String(Math.round(value * 100));
      slider.addEventListener("input", () => {
        saveSettings(this.opts.storage, { audio: { [key]: Number(slider.value) / 100 } });
        this.emitChange();
      });
      row.appendChild(slider);
      wrap.appendChild(row);
      return slider;
    };
    mkSlider("music", cur.music);
    mkSlider("sfx", cur.sfx);
    const muteRow = document.createElement("label");
    muteRow.textContent = t(this.opts.locale, "settings.mute");
    const mute = document.createElement("input");
    mute.type = "checkbox";
    mute.checked = cur.mute;
    mute.addEventListener("change", () => {
      saveSettings(this.opts.storage, { audio: { mute: mute.checked } });
      this.emitChange();
    });
    muteRow.appendChild(mute);
    wrap.appendChild(muteRow);
    return wrap;
  }

  private buildDisplay(cur: DisplaySettings): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-direction:column;gap:6px;";
    const dprRow = document.createElement("label");
    dprRow.textContent = t(this.opts.locale, "settings.dpr");
    const select = document.createElement("select");
    for (const mode of ["auto", "2", "1.5", "1"] as const) {
      const opt = document.createElement("option");
      opt.value = mode;
      opt.textContent = mode === "auto" ? t(this.opts.locale, "settings.dpr.auto") : mode;
      select.appendChild(opt);
    }
    select.value = cur.dprMode;
    select.addEventListener("change", () => {
      saveSettings(this.opts.storage, { display: { dprMode: select.value as DisplaySettings["dprMode"] } });
      this.emitChange();
    });
    dprRow.appendChild(select);
    wrap.appendChild(dprRow);

    const fxRow = document.createElement("label");
    fxRow.textContent = t(this.opts.locale, "settings.reducedEffects");
    const fx = document.createElement("input");
    fx.type = "checkbox";
    fx.checked = cur.reducedEffects;
    fx.addEventListener("change", () => {
      saveSettings(this.opts.storage, { display: { reducedEffects: fx.checked } });
      this.emitChange();
    });
    fxRow.appendChild(fx);
    wrap.appendChild(fxRow);
    return wrap;
  }

  private buildAppearance(cur: AppearanceSettings): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-direction:column;gap:6px;";

    const skinRow = document.createElement("label");
    skinRow.textContent = t(this.opts.locale, "settings.skin");
    const skinSelect = document.createElement("select");
    for (const skin of SKINS) {
      const opt = document.createElement("option");
      opt.value = skin.id;
      opt.textContent = skin.name;
      skinSelect.appendChild(opt);
    }
    skinSelect.value = cur.skinId;
    skinSelect.addEventListener("change", () => {
      saveSettings(this.opts.storage, { appearance: { skinId: skinSelect.value } });
      this.emitChange();
    });
    skinRow.appendChild(skinSelect);
    wrap.appendChild(skinRow);

    const themeRow = document.createElement("label");
    themeRow.textContent = t(this.opts.locale, "settings.theme");
    const themeSelect = document.createElement("select");
    for (const theme of THEMES) {
      const opt = document.createElement("option");
      opt.value = theme.id;
      opt.textContent = theme.name;
      themeSelect.appendChild(opt);
    }
    themeSelect.value = cur.themeId;
    themeSelect.addEventListener("change", () => {
      saveSettings(this.opts.storage, { appearance: { themeId: themeSelect.value } });
      this.emitChange();
    });
    themeRow.appendChild(themeSelect);
    wrap.appendChild(themeRow);
    return wrap;
  }

  // ---- Controls (ticket 41) ----

  /** Max local players per device (desktop 4, spec §11). */
  private static readonly MAX_LOCAL_PLAYERS = 4;

  private buildControls(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-direction:column;gap:6px;";

    // Device tabs: keyboard / gamepad.
    const deviceTabs = document.createElement("div");
    for (const device of ["keyboard", "gamepad"] as const) {
      const tab = document.createElement("button");
      tab.dataset.deviceTab = device;
      tab.textContent = t(this.opts.locale, `settings.controls.${device}`);
      tab.style.cssText = "margin-right:8px;padding:4px 10px;font-family:monospace;";
      tab.addEventListener("click", () => {
        this.activeDevice = device;
        this.renderControls();
      });
      deviceTabs.appendChild(tab);
    }
    wrap.appendChild(deviceTabs);

    // Player tabs (keyboard only — gamepad map is shared). Always 4 slots:
    // 4-on-keyboard is achievable via rebinding (spec §11).
    const playerTabs = document.createElement("div");
    for (let p = 0; p < SettingsScreen.MAX_LOCAL_PLAYERS; p++) {
      const tab = document.createElement("button");
      tab.dataset.playerTab = String(p);
      tab.textContent = t(this.opts.locale, "settings.controls.player").replace("{n}", String(p + 1));
      tab.style.cssText = "margin-right:8px;padding:4px 10px;font-family:monospace;";
      tab.addEventListener("click", () => {
        this.activePlayer = p;
        this.renderControls();
      });
      playerTabs.appendChild(tab);
    }
    wrap.appendChild(playerTabs);

    // Rebind rows (re-rendered per tab).
    const rows = document.createElement("div");
    rows.dataset.rebindRows = "";
    rows.style.cssText = "display:flex;flex-direction:column;gap:4px;";
    wrap.appendChild(rows);

    // Rollover caveat (spec §11: ~6-key rollover on cheap keyboards).
    const caveat = document.createElement("div");
    caveat.dataset.rollover = "";
    caveat.textContent = t(this.opts.locale, "settings.controls.rollover");
    caveat.style.cssText = "font-size:11px;color:#999;";
    wrap.appendChild(caveat);

    // Reset to defaults.
    const reset = document.createElement("button");
    reset.dataset.resetControls = "";
    reset.textContent = t(this.opts.locale, "settings.controls.reset");
    reset.style.cssText = "margin-top:4px;padding:4px 10px;font-family:monospace;";
    reset.addEventListener("click", () => {
      const def = resetControls(this.opts.storage);
      this.keyboardMaps = def.keyboard.map((m) => ({ ...m }));
      this.gamepadMap = def.gamepad;
      this.renderControls();
    });
    wrap.appendChild(reset);

    // First render — synchronous so the DOM is complete on open.
    this.controlsPanel = wrap;
    this.renderControls();
    return wrap;
  }

  /** Re-render the rebind rows for the active device/player tab. */
  private renderControls(): void {
    const rows = this.controlsPanel?.querySelector<HTMLElement>("[data-rebind-rows]");
    if (!rows) return;
    rows.textContent = "";
    this.capture = null;
    if (this.activeDevice === "keyboard") {
      const map = this.keyboardMaps[this.activePlayer] ?? { ...KEYSET_1 };
      for (const action of KEYBOARD_ACTIONS) {
        rows.appendChild(this.buildRebindRow(action, map[action].join(", "), "key"));
      }
    } else {
      const fixed = document.createElement("div");
      fixed.dataset.movementFixed = "";
      fixed.textContent = t(this.opts.locale, "settings.controls.movementFixed");
      fixed.style.cssText = "font-size:11px;color:#999;";
      rows.appendChild(fixed);
      for (const action of GAMEPAD_ACTIONS) {
        rows.appendChild(this.buildRebindRow(action, this.gamepadMap[action].join(", "), "button"));
      }
    }
  }

  private buildRebindRow(action: string, binding: string, kind: "key" | "button"): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:8px;";
    const label = document.createElement("span");
    label.textContent = t(this.opts.locale, `settings.action.${action}` as StringActionKey);
    label.style.cssText = "min-width:120px;";
    const btn = document.createElement("button");
    btn.dataset.rebind = "";
    btn.dataset.action = action;
    btn.textContent = binding;
    btn.style.cssText = "padding:4px 10px;font-family:monospace;min-width:90px;";
    btn.addEventListener("click", () => {
      this.capture = { action, button: btn };
      btn.textContent = t(
        this.opts.locale,
        kind === "key" ? "settings.controls.pressKey" : "settings.controls.pressButton",
      );
      btn.classList.add("capturing");
    });
    row.appendChild(label);
    row.appendChild(btn);
    return row;
  }

  /** Global keydown while capturing: apply, or Esc to cancel. */
  private onCaptureKey(e: KeyboardEvent): void {
    if (!this.capture) return;
    e.preventDefault();
    e.stopPropagation();
    const { action, button } = this.capture;
    this.capture = null;
    button.classList.remove("capturing");
    if (this.activeDevice !== "keyboard") return;
    if (e.code === "Escape") {
      // Cancel — restore the current binding display.
      this.renderControls();
      return;
    }
    this.applyKeyboardRebind(action as KeyboardBindingsKey, e.code, button);
  }

  /** Poll gamepad button edges while the overlay is open (rebind capture). */
  private pollGamepadCapture(): void {
    // jsdom/test envs lack getGamepads — no pad, no capture.
    if (typeof navigator.getGamepads !== "function") return;
    const pads = navigator.getGamepads();
    const pad = pads.find((p) => p !== null);
    if (!pad) {
      this.prevPadButtons = {};
      return;
    }
    const b = (i: number): boolean => pad.buttons[i]?.pressed === true;
    const now: Partial<Record<GamepadButton, boolean>> = {
      a: b(0), b: b(1), x: b(2), y: b(3),
      lb: b(4), rb: b(5), rt: b(7), lt: b(6),
      start: b(9),
    };
    for (const name of Object.keys(now) as GamepadButton[]) {
      const pressed = now[name] === true;
      const was = this.prevPadButtons[name] === true;
      if (pressed && !was && this.capture && this.activeDevice === "gamepad") {
        const { action, button } = this.capture;
        this.capture = null;
        button.classList.remove("capturing");
        this.applyGamepadRebind(action as GamepadAction, name, button);
        break;
      }
    }
    this.prevPadButtons = now;
  }

  private applyGamepadRebind(action: GamepadAction, buttonName: GamepadButton, button: HTMLButtonElement): void {
    const map: Record<GamepadAction, readonly GamepadButton[]> = { ...this.gamepadMap };
    map[action] = [buttonName];
    const conflicts = findGamepadConflicts(map);
    if (conflicts.some((c) => c.action === action && c.button === buttonName)) {
      // Duplicate — reject, highlight, keep the old binding.
      button.textContent = t(this.opts.locale, "settings.controls.duplicate");
      button.classList.add("conflict");
      return;
    }
    this.gamepadMap = map;
    saveSettings(this.opts.storage, { controls: { gamepad: map } });
    this.renderControls();
  }

  private applyKeyboardRebind(action: KeyboardBindingsKey, code: string, button: HTMLButtonElement): void {
    const maps: KeyboardBindings[] = this.keyboardMaps.map((m) => ({ ...m }));
    const target: KeyboardBindings = maps[this.activePlayer] ?? { ...KEYSET_1 };
    target[action] = [code];
    const conflicts = findKeyboardConflicts(maps);
    const mine = conflicts.find((c) => c.player === this.activePlayer && c.action === action && c.key === code);
    if (mine) {
      // Duplicate — reject, highlight, keep the old binding.
      button.textContent = t(this.opts.locale, "settings.controls.duplicate");
      button.classList.add("conflict");
      return;
    }
    if (this.activePlayer < maps.length) {
      maps[this.activePlayer] = target;
    } else {
      maps.push(target);
    }
    this.keyboardMaps = maps;
    saveSettings(this.opts.storage, { controls: { keyboard: maps } });
    this.renderControls();
  }

  private emitChange(): void {
    const cur = loadSettings(this.opts.storage);
    this.opts.onChange?.(cur.audio, cur.display, cur.appearance);
  }
}
