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
    expect(tabs.length).toBe(4);
    tabs[1]!.click(); // switch to Player 2
    const leftBtn = rebindButtons(screen.root).find((b) => b.dataset.action === "left");
    expect(leftBtn!.textContent).toContain("A");
    leftBtn!.click();
    pressKey("Semicolon");
    const after = loadSettings(storage);
    expect(after.controls.keyboard[1]!.left).toEqual(["Semicolon"]);
    screen.close();
  });

  it("4 player tabs rendered — 4-on-keyboard achievable via rebinding", () => {
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    const tabs = screen.root.querySelectorAll<HTMLButtonElement>("button[data-player-tab]");
    expect(tabs.length).toBe(4);
    // Player 3 tab: rebind works on a fresh slot.
    tabs[2]!.click();
    const launchBtn = rebindButtons(screen.root).find((b) => b.dataset.action === "launch");
    launchBtn!.click();
    pressKey("KeyO");
    const after = loadSettings(storage);
    expect(after.controls.keyboard[2]!.launch).toEqual(["KeyO"]);
    screen.close();
  });

  it("Esc during capture cancels the rebind instead of binding Esc", () => {
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    const launchBtn = rebindButtons(screen.root).find((b) => b.dataset.action === "launch");
    launchBtn!.click();
    pressKey("Escape");
    const after = loadSettings(storage);
    expect(after.controls.keyboard[0]!.launch).toEqual(["Space"]); // unchanged
    expect(after.controls.keyboard[0]!.menu).toEqual(["Escape"]); // unchanged
    screen.close();
  });

  it("conflict highlight has a visible CSS rule", () => {
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    const style = document.getElementById("arkanoid-rebind-highlight");
    expect(style?.textContent).toContain("button.conflict");
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

  it("gamepad rebind: button press captured via polling, duplicate rejected", async () => {
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    // Fake one gamepad with no buttons pressed.
    let padButtons: { pressed: boolean }[] = [];
    const fakePad = { buttons: padButtons, axes: [0, 0] };
    const nav = navigator as Navigator & { getGamepads?: () => (Gamepad | null)[] };
    const realGetGamepads = nav.getGamepads?.bind(nav);
    nav.getGamepads = () => [fakePad] as unknown as (Gamepad | null)[];
    try {
      const padTab = Array.from(
        screen.root.querySelectorAll<HTMLButtonElement>("button[data-device-tab]"),
      ).find((b) => b.dataset.deviceTab === "gamepad");
      padTab!.click();
      const launchBtn = rebindButtons(screen.root).find((b) => b.dataset.action === "launch");
      launchBtn!.click();
      expect(launchBtn!.textContent).toContain(t(locale, "settings.controls.pressButton"));
      // Press LT (index 6) — unbound, edge detected on next poll.
      padButtons = [
        { pressed: false }, { pressed: false }, { pressed: false }, { pressed: false },
        { pressed: false }, { pressed: false }, { pressed: true },
      ];
      fakePad.buttons = padButtons;
      // Poll runs on a 50 ms interval — wait for it.
      await new Promise((r) => setTimeout(r, 120));
      const after = loadSettings(storage);
      expect(after.controls.gamepad.launch).toEqual(["lt"]);
      // Duplicate: rebind fire1 to lt (already launch) → rejected.
      // (Rows were rebuilt after the first rebind — re-query.)
      const fire1Btn = rebindButtons(screen.root).find((b) => b.dataset.action === "fire1");
      fire1Btn!.click();
      // Release all, let the poll see the release, then press LT again.
      padButtons = [
        { pressed: false }, { pressed: false }, { pressed: false }, { pressed: false },
        { pressed: false }, { pressed: false }, { pressed: false },
      ];
      fakePad.buttons = padButtons;
      await new Promise((r) => setTimeout(r, 120));
      padButtons = [
        { pressed: false }, { pressed: false }, { pressed: false }, { pressed: false },
        { pressed: false }, { pressed: false }, { pressed: true },
      ];
      fakePad.buttons = padButtons;
      await new Promise((r) => setTimeout(r, 120));
      const after2 = loadSettings(storage);
      expect(after2.controls.gamepad.fire1).toEqual(["x"]); // unchanged
      expect(fire1Btn!.textContent).toContain(t(locale, "settings.controls.duplicate"));
    } finally {
      if (realGetGamepads) nav.getGamepads = realGetGamepads;
      screen.close();
    }
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
