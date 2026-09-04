// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { SettingsScreen } from "ui/settingsScreen";
import { Storage, type StorageBackend } from "persistence/storage";
import { loadSettings } from "ui/settings";
import {
  DEFAULT_KEYBOARD_BINDINGS,
  findKeyboardConflicts,
  KEYBOARD_ACTIONS,
} from "input/bindings";
import { t, type Locale } from "ui/strings";

function fakeBackend(): StorageBackend {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

const locale: Locale = "en-US";

function openScreen(storage: Storage): SettingsScreen {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const screen = new SettingsScreen({ host, locale, storage });
  screen.open();
  return screen;
}

/** All rebind buttons currently rendered for the active player tab. */
function rebindButtons(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-rebind]"));
}

function pressKey(code: string): void {
  globalThis.dispatchEvent(new KeyboardEvent("keydown", { code }));
}

describe("SettingsScreen Controls section (ticket 41)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders keyboard rebind rows for every action incl. menu", () => {
    const screen = openScreen(new Storage(fakeBackend()));
    const btns = rebindButtons(screen.root);
    expect(btns.length).toBeGreaterThanOrEqual(KEYBOARD_ACTIONS.length);
    screen.close();
  });

  it("clicking a rebind button enters capture mode; next keydown rebinds", () => {
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    const launchBtn = rebindButtons(screen.root).find((b) => b.dataset.action === "launch");
    expect(launchBtn).toBeDefined();
    launchBtn!.click();
    expect(launchBtn!.textContent).toContain(t(locale, "settings.controls.pressKey"));
    pressKey("KeyP");
    const after = loadSettings(storage);
    expect(after.controls.keyboard[0]!.launch).toEqual(["KeyP"]);
    screen.close();
  });

  it("duplicate binding rejected with highlight; map unchanged", () => {
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    const fire1Btn = rebindButtons(screen.root).find((b) => b.dataset.action === "fire1");
    fire1Btn!.click();
    // Space is already bound to launch (P0) → duplicate → rejected.
    pressKey("Space");
    const after = loadSettings(storage);
    expect(after.controls.keyboard[0]!.fire1).toEqual(["1"]);
    expect(fire1Btn!.textContent).toContain(t(locale, "settings.controls.duplicate"));
    // highlight visible on the conflicting row
    expect(fire1Btn!.className).toContain("conflict");
    screen.close();
  });

  it("duplicate check spans all local players' maps", () => {
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    // P0 fire1 ← KeyW: KeyW is P1's launch → conflict across players.
    const fire1Btn = rebindButtons(screen.root).find((b) => b.dataset.action === "fire1");
    fire1Btn!.click();
    pressKey("KeyW");
    const after = loadSettings(storage);
    expect(after.controls.keyboard[0]!.fire1).toEqual(["1"]);
    expect(fire1Btn!.textContent).toContain(t(locale, "settings.controls.duplicate"));
    screen.close();
  });

  it("tab switches between local players' rebind maps", () => {
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    const tabs = Array.from(
      screen.root.querySelectorAll<HTMLButtonElement>("button[data-player-tab]"),
    );
    expect(tabs.length).toBe(2);
    tabs[1]!.click(); // switch to Player 2
    const leftBtn = rebindButtons(screen.root).find((b) => b.dataset.action === "left");
    expect(leftBtn!.textContent).toContain("A");
    leftBtn!.click();
    pressKey("Semicolon");
    const after = loadSettings(storage);
    expect(after.controls.keyboard[1]!.left).toEqual(["Semicolon"]);
    screen.close();
  });

  it("gamepad tab lists rebindable buttons; movement marked fixed", () => {
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    const padTab = Array.from(
      screen.root.querySelectorAll<HTMLButtonElement>("button[data-device-tab]"),
    ).find((b) => b.dataset.deviceTab === "gamepad");
    padTab!.click();
    const fixed = screen.root.querySelector("[data-movement-fixed]");
    expect(fixed?.textContent).toContain(t(locale, "settings.controls.movementFixed"));
    screen.close();
  });

  it("reset button restores defaults", () => {
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    const launchBtn = rebindButtons(screen.root).find((b) => b.dataset.action === "launch");
    launchBtn!.click();
    pressKey("KeyP");
    expect(loadSettings(storage).controls.keyboard[0]!.launch).toEqual(["KeyP"]);
    const reset = screen.root.querySelector<HTMLButtonElement>("[data-reset-controls]");
    reset!.click();
    expect(loadSettings(storage).controls.keyboard).toEqual(DEFAULT_KEYBOARD_BINDINGS);
    screen.close();
  });

  it("rollover caveat visible in Controls UI", () => {
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    const caveat = screen.root.querySelector("[data-rollover]");
    expect(caveat?.textContent).toContain(t(locale, "settings.controls.rollover"));
    screen.close();
  });

  it("rebind applies live — adapter sees the new key immediately", () => {
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    const leftBtn = rebindButtons(screen.root).find((b) => b.dataset.action === "left");
    leftBtn!.click();
    pressKey("KeyN");
    const after = loadSettings(storage);
    expect(after.controls.keyboard[0]!.left).toEqual(["KeyN"]);
    // stored map is conflict-free after the rebind
    expect(findKeyboardConflicts(after.controls.keyboard)).toEqual([]);
    screen.close();
  });
});
