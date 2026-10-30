// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from "vitest";
import { SettingsScreen, REBIND_TIMEOUT_MS } from "ui/settingsScreen";
import { FOCUS_CLASS } from "ui/gamepadNav";
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
    removeItem: (k) => {
      map.delete(k);
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

  it("gamepad navigates menus: d-pad moves focus, A activates (spec §11)", async () => {
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    let padButtons: { pressed: boolean }[] = [];
    const fakePad = { buttons: padButtons, axes: [0, 0] };
    const nav = navigator as Navigator & { getGamepads?: () => (Gamepad | null)[] };
    const realGetGamepads = nav.getGamepads?.bind(nav);
    nav.getGamepads = () => [fakePad] as unknown as (Gamepad | null)[];
    try {
      const allButtons = Array.from(
        screen.root.querySelectorAll<HTMLButtonElement>("button"),
      );
      // First input takes focus on open.
      expect(document.activeElement).toBe(allButtons[0]);
      // D-pad down edge → focus moves to next button.
      padButtons = [];
      fakePad.buttons = padButtons;
      await new Promise((r) => setTimeout(r, 120)); // poll sees released state
      padButtons = [
        ...Array.from({ length: 13 }, () => ({ pressed: false })),
        { pressed: true }, // index 13 = dpadDown
      ];
      fakePad.buttons = padButtons;
      await new Promise((r) => setTimeout(r, 120));
      expect(document.activeElement).toBe(allButtons[1]);
      // A edge → focused button clicks (device tab 2 = gamepad).
      padButtons = [{ pressed: true }];
      fakePad.buttons = padButtons;
      await new Promise((r) => setTimeout(r, 120));
      const fixed = screen.root.querySelector("[data-movement-fixed]");
      expect(fixed).not.toBeNull(); // gamepad tab rendered via gamepad A-click
    } finally {
      if (realGetGamepads) nav.getGamepads = realGetGamepads;
      screen.close();
    }
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

  /** Install a fake pad whose pressed button indices the test sets per poll. */
  function installFakePad(): { press: (...indices: number[]) => void; restore: () => void } {
    const fakePad = { buttons: [] as { pressed: boolean }[], axes: [0, 0] };
    const nav = navigator as Navigator & { getGamepads?: () => (Gamepad | null)[] };
    const real = nav.getGamepads?.bind(nav);
    nav.getGamepads = () => [fakePad] as unknown as (Gamepad | null)[];
    return {
      press: (...indices) => {
        fakePad.buttons = Array.from({ length: 16 }, (_, i) => ({ pressed: indices.includes(i) }));
      },
      restore: () => {
        if (real) nav.getGamepads = real;
      },
    };
  }

  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 120));
  const LT = 6;
  const DPAD_UP = 12; // free by default, so a valid rebind target

  function openGamepadTab(screen: SettingsScreen): void {
    const padTab = Array.from(
      screen.root.querySelectorAll<HTMLButtonElement>("button[data-device-tab]"),
    ).find((b) => b.dataset.deviceTab === "gamepad");
    padTab!.click();
  }

  it("gamepad rebind: new button is proposed, pressing it again confirms", async () => {
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    const pad = installFakePad();
    try {
      pad.press();
      await tick();
      openGamepadTab(screen);
      const launchBtn = rebindButtons(screen.root).find((b) => b.dataset.action === "launch");
      launchBtn!.click();
      expect(launchBtn!.textContent).toContain(t(locale, "settings.controls.pressButton"));
      pad.press(LT);
      await tick();
      // Proposed only — nothing saved yet, the row asks for confirmation.
      expect(loadSettings(storage).controls.gamepad.launch).toEqual(["a"]);
      expect(launchBtn!.textContent).toContain("lt");
      expect(launchBtn!.textContent).toContain(
        t(locale, "settings.controls.confirmButton").replace("{button}", "lt"),
      );
      pad.press();
      await tick();
      pad.press(LT);
      await tick();
      expect(loadSettings(storage).controls.gamepad.launch).toEqual(["lt"]);
    } finally {
      pad.restore();
      screen.close();
    }
  });

  it("gamepad rebind: pressing a different button replaces the proposal", async () => {
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    const pad = installFakePad();
    try {
      pad.press();
      await tick();
      openGamepadTab(screen);
      const launchBtn = rebindButtons(screen.root).find((b) => b.dataset.action === "launch");
      launchBtn!.click();
      pad.press(LT);
      await tick();
      pad.press();
      await tick();
      pad.press(DPAD_UP);
      await tick();
      expect(launchBtn!.textContent).toContain("dpadUp");
      pad.press();
      await tick();
      pad.press(DPAD_UP);
      await tick();
      expect(loadSettings(storage).controls.gamepad.launch).toEqual(["dpadUp"]);
    } finally {
      pad.restore();
      screen.close();
    }
  });

  it("gamepad rebind: a confirmed duplicate is rejected and the old binding kept", async () => {
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    const pad = installFakePad();
    try {
      pad.press();
      await tick();
      openGamepadTab(screen);
      rebindButtons(screen.root).find((b) => b.dataset.action === "launch")!.click();
      pad.press(LT);
      await tick();
      pad.press();
      await tick();
      pad.press(LT);
      await tick();
      expect(loadSettings(storage).controls.gamepad.launch).toEqual(["lt"]);
      // Rows were rebuilt after the rebind — re-query.
      const fire1Btn = rebindButtons(screen.root).find((b) => b.dataset.action === "fire1");
      fire1Btn!.click();
      for (const frame of [[], [LT], [], [LT]] as const) {
        pad.press(...frame);
        await tick();
      }
      expect(loadSettings(storage).controls.gamepad.fire1).toEqual(["x"]);
      expect(fire1Btn!.textContent).toContain(t(locale, "settings.controls.duplicate"));
    } finally {
      pad.restore();
      screen.close();
    }
  });

  it("gamepad rebind: an unconfirmed proposal is cancelled after the timeout", () => {
    vi.useFakeTimers();
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    const pad = installFakePad();
    try {
      pad.press();
      vi.advanceTimersByTime(60);
      openGamepadTab(screen);
      const launchBtn = rebindButtons(screen.root).find((b) => b.dataset.action === "launch");
      launchBtn!.click();
      pad.press(LT);
      vi.advanceTimersByTime(60);
      expect(launchBtn!.textContent).toContain("lt");
      vi.advanceTimersByTime(REBIND_TIMEOUT_MS + 100);
      const row = rebindButtons(screen.root).find((b) => b.dataset.action === "launch");
      expect(row!.textContent).toBe("a");
      expect(loadSettings(storage).controls.gamepad.launch).toEqual(["a"]);
    } finally {
      pad.restore();
      screen.close();
      vi.useRealTimers();
    }
  });

  it("switching tab mid-rebind drops the pending capture so the pad navigates again", async () => {
    const screen = openScreen(new Storage(fakeBackend()));
    const pad = installFakePad();
    try {
      pad.press();
      await tick();
      openGamepadTab(screen);
      rebindButtons(screen.root).find((b) => b.dataset.action === "launch")!.click();
      pad.press(LT);
      await tick(); // proposal pending
      const keyboardTab = Array.from(
        screen.root.querySelectorAll<HTMLButtonElement>("button[data-device-tab]"),
      ).find((b) => b.dataset.deviceTab === "keyboard");
      keyboardTab!.click();
      keyboardTab!.focus();
      pad.press();
      await tick();
      pad.press(13);
      await tick();
      expect(document.activeElement).not.toBe(keyboardTab);
    } finally {
      pad.restore();
      screen.close();
    }
  });

  it("clicking another row mid-proposal restores the first row's label", async () => {
    const screen = openScreen(new Storage(fakeBackend()));
    const pad = installFakePad();
    try {
      pad.press();
      await tick();
      openGamepadTab(screen);
      const launch = rebindButtons(screen.root).find((b) => b.dataset.action === "launch")!;
      launch.click();
      pad.press(LT);
      await tick();
      expect(launch.textContent).toContain("lt");
      rebindButtons(screen.root).find((b) => b.dataset.action === "fire1")!.click();
      expect(launch.textContent).toBe("a");
    } finally {
      pad.restore();
      screen.close();
    }
  });

  it("a pad B during a keyboard rebind does not close the screen", async () => {
    const onClose = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const screen = new SettingsScreen({ host, locale, storage: new Storage(fakeBackend()), onClose });
    screen.open();
    const pad = installFakePad();
    try {
      pad.press();
      await tick();
      rebindButtons(screen.root).find((b) => b.dataset.action === "launch")!.click();
      pad.press(1);
      await tick();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.root.isConnected).toBe(true);
    } finally {
      pad.restore();
      screen.close();
    }
  });

  it("gamepad B (outside a rebind) closes the settings screen", async () => {
    const onClose = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const screen = new SettingsScreen({
      host,
      locale,
      storage: new Storage(fakeBackend()),
      onClose,
    });
    screen.open();
    const pad = installFakePad();
    try {
      pad.press();
      await tick();
      pad.press(1);
      await tick();
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.root.isConnected).toBe(false);
    } finally {
      pad.restore();
    }
  });

  it("focused settings control carries the gamepad focus indicator", async () => {
    const screen = openScreen(new Storage(fakeBackend()));
    const pad = installFakePad();
    try {
      pad.press();
      await tick();
      pad.press(13);
      await tick();
      expect(screen.root.querySelectorAll(`.${FOCUS_CLASS}`)).toHaveLength(1);
      expect(document.activeElement?.classList.contains(FOCUS_CLASS)).toBe(true);
    } finally {
      pad.restore();
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

describe("SettingsScreen Language row (ticket 52)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the language select with Auto + endonym options", () => {
    const screen = openScreen(new Storage(fakeBackend()));
    const select = screen.root.querySelector<HTMLSelectElement>("select[data-language-select]");
    expect(select).toBeDefined();
    const opts = [...(select?.options ?? [])].map((o) => o.textContent);
    expect(opts).toContain("Auto");
    expect(opts).toContain("English");
    expect(opts).toContain("Español");
    // Endonyms never localized: same in both locales.
    expect(select?.value).toBe("auto");
    screen.close();
  });

  it("changing the language persists it (auto → es-419)", () => {
    const storage = new Storage(fakeBackend());
    const screen = openScreen(storage);
    const select = screen.root.querySelector<HTMLSelectElement>("select[data-language-select]");
    select!.value = "es-419";
    select!.dispatchEvent(new Event("change"));
    expect(loadSettings(storage).language).toBe("es-419");
    screen.close();
  });

  it("switching back to auto persists empty (detect on next boot)", () => {
    const storage = new Storage(fakeBackend());
    storage.savePartial({ language: "es-419" });
    const screen = openScreen(storage);
    const select = screen.root.querySelector<HTMLSelectElement>("select[data-language-select]");
    expect(select?.value).toBe("es-419");
    select!.value = "auto";
    select!.dispatchEvent(new Event("change"));
    expect(loadSettings(storage).language).toBe("auto");
    screen.close();
  });

  it("garbage stored language renders as auto (corrupt fallback)", () => {
    const backend = fakeBackend();
    backend.setItem("settings.language", "klingon");
    const screen = openScreen(new Storage(backend));
    const select = screen.root.querySelector<HTMLSelectElement>("select[data-language-select]");
    expect(select?.value).toBe("auto");
    screen.close();
  });
});
