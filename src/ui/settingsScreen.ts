// Settings screen (spec §14): DOM overlay with four sections — Controls,
// Audio, Display, Appearance. Audio + Display + Appearance live; Controls is
// a stub until ticket 41. All strings from locale tables.
import { t, type Locale } from "ui/strings";
import type { Storage } from "persistence/storage";
import {
  loadSettings,
  saveSettings,
  type AppearanceSettings,
  type AudioSettings,
  type DisplaySettings,
} from "ui/settings";
import { SKINS } from "content/skins";
import { THEMES } from "content/themes";

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
  private readonly root: HTMLDivElement;
  private readonly opts: SettingsScreenOptions;

  constructor(opts: SettingsScreenOptions) {
    this.opts = opts;
    this.root = document.createElement("div");
    this.root.style.cssText =
      "position:absolute;inset:0;background:rgba(8,8,16,0.92);display:flex;" +
      "align-items:center;justify-content:center;z-index:1000;font-family:monospace;";
    this.root.appendChild(this.build());
  }

  open(): void {
    if (!this.root.isConnected) this.opts.host.appendChild(this.root);
  }

  close(): void {
    this.root.remove();
    this.opts.onClose?.();
  }

  private build(): HTMLElement {
    const cur = loadSettings(this.opts.storage);
    const panel = document.createElement("div");
    panel.style.cssText =
      "background:#181828;color:#eee;padding:24px 32px;border:2px solid #444;" +
      "min-width:320px;display:flex;flex-direction:column;gap:12px;";

    const title = document.createElement("h2");
    title.textContent = t(this.opts.locale, "menu.settings");
    title.style.margin = "0 0 8px";
    panel.appendChild(title);

    for (const section of ["settings.controls", "settings.audio", "settings.display", "settings.appearance"] as const) {
      const h = document.createElement("h3");
      h.textContent = t(this.opts.locale, section);
      h.style.margin = "8px 0 4px";
      panel.appendChild(h);
      if (section === "settings.audio") panel.appendChild(this.buildAudio(cur.audio));
      else if (section === "settings.display") panel.appendChild(this.buildDisplay(cur.display));
      else if (section === "settings.appearance") panel.appendChild(this.buildAppearance(cur.appearance));
      else {
        const stub = document.createElement("div");
        stub.textContent = "—";
        panel.appendChild(stub);
      }
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

  private emitChange(): void {
    const cur = loadSettings(this.opts.storage);
    this.opts.onChange?.(cur.audio, cur.display, cur.appearance);
  }
}
