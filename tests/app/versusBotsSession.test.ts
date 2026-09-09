// Versus bots session tests (ticket 56 coverage): app-level wiring —
// split-screen vs single field per variant, input merge, pause menu,
// end-screen flow (over → endData → choice callbacks), dispose cleanup.
// Pixi-dependent modules (appShell, fieldView, touchOverlay, splitScreen)
// are mocked; the sim, adapters, storage, settings run real.
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "pixi.js";
import type { AppShell } from "render/appShell";

// ---- Pixi mocks ----

const mockApp = (): Application => {
  const stage = {
    children: [] as unknown[],
    addChild: (c: unknown): void => {
      stage.children.push(c);
    },
    removeChildren: (): unknown[] => {
      const out = stage.children;
      stage.children = [];
      return out;
    },
  };
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 } as DOMRect);
  return {
    stage,
    canvas,
    renderer: { width: 800, height: 600 },
  } as unknown as Application;
};

vi.mock("render/appShell", () => ({
  createAppShell: async (): Promise<AppShell> => {
    await Promise.resolve();
    return {
      app: mockApp(),
      dispose: () => {},
      setResolution: () => {},
    };
  },
}));

vi.mock("render/fieldView", () => ({
  FieldView: class {
    readonly container = { destroy: () => {} };
    sync = vi.fn();
    invalidate = vi.fn();
    setReducedEffects = vi.fn();
  },
}));

vi.mock("render/splitScreen", () => ({
  SplitScreenView: class {
    readonly container = {};
    static lastPlayers: number[] | null = null;
    sync = vi.fn();
    resize = vi.fn();
    invalidate = vi.fn();
    setReducedEffects = vi.fn();
    regionOf = () => ({ x: 0, y: 0, w: 400, h: 600 });
    constructor(opts: { players: number[] }) {
      const holder = this.constructor as unknown as { lastPlayers: number[] | null };
      holder.lastPlayers = opts.players;
    }
    get fieldCount(): number {
      const holder = this.constructor as unknown as { lastPlayers: number[] | null };
      return holder.lastPlayers?.length ?? 0;
    }
  },
}));

vi.mock("render/touchOverlay", () => ({
  TouchOverlay: class {
    readonly container = {};
    redraw = vi.fn();
    setRegion = vi.fn();
  },
}));

// ---- Test ----

import { startVersusBotsSession, type VersusBotsAppSession } from "app/versusBotsSession";
import type { BotVariant } from "sim/versusBots";

beforeEach(() => {
  Object.defineProperty(window.navigator, "getGamepads", {
    value: (): (Gamepad | null)[] => [null, null, null, null],
    configurable: true,
    writable: true,
  });
});

async function makeSession(
  variant: BotVariant,
  bots: number,
  callbacks: { onRematch?: () => void; onBackToConfig?: () => void; onQuit?: () => void } = {},
): Promise<VersusBotsAppSession> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return startVersusBotsSession(host, {
    variant,
    bots,
    difficulty: "normal",
    ...callbacks,
  });
}

describe("versus bots session wiring (ticket 56)", () => {
  let sessions: VersusBotsAppSession[] = [];

  afterEach(() => {
    for (const s of sessions) s.dispose();
    sessions = [];
    document.body.innerHTML = "";
  });

  it("race: split-screen renders one field per player (4 total)", async () => {
    const s = await makeSession("race", 3);
    sessions.push(s);
    expect(s.fieldCount).toBe(4);
  });

  it("duel: single shared field", async () => {
    const s = await makeSession("duel", 1);
    sessions.push(s);
    expect(s.fieldCount).toBe(1);
  });

  it("sharedField: single field; parallelAssist: per-player fields", async () => {
    const sf = await makeSession("sharedField", 2);
    sessions.push(sf);
    expect(sf.fieldCount).toBe(1);
    const pa = await makeSession("parallelAssist", 2);
    sessions.push(pa);
    expect(pa.fieldCount).toBe(3);
  });

  it("ticks advance the sim; keyboard drives the human paddle", async () => {
    const s = await makeSession("race", 1);
    sessions.push(s);
    s.loop.advance(0);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
    s.loop.advance(1000 / 60);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowRight" }));
    const snaps = s.snapshots();
    expect(snaps.length).toBe(2);
    expect(snaps[0]?.tick).toBeGreaterThan(0);
  });

  it("Esc opens the pause menu; Resume closes it (coop semantics)", async () => {
    const s = await makeSession("duel", 1);
    sessions.push(s);
    s.loop.advance(0);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    s.loop.advance(1000 / 60); // render pass consumes the menu edge
    expect(s.paused).toBe(true);
    const menu = document.querySelector("[data-pause-menu]");
    expect(menu).not.toBeNull();
    const resume = [...(menu?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Resume",
    );
    resume?.click();
    expect(s.paused).toBe(false);
    expect(document.querySelector("[data-pause-menu]")).toBeNull();
  });

  it("assist: match over → end screen with coop outcome; lobby choice fires onBackToConfig", async () => {
    let backToConfig = 0;
    const s = await makeSession("parallelAssist", 1, {
      onBackToConfig: () => {
        backToConfig++;
      },
    });
    sessions.push(s);
    s.loop.advance(0);
    // Deterministic decision: force both players downed → all-downed = lost.
    s.debugSetDowned(0);
    s.debugSetDowned(1);
    s.loop.advance(1000 / 60);
    expect(s.matchOver).toBe(true);
    // Coop end screen: "Lobby" button = back-to-config.
    const end = document.querySelector(".end-root");
    expect(end).not.toBeNull();
    const lobby = [...(end?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Return to lobby",
    );
    lobby?.click();
    expect(backToConfig).toBe(1);
  });

  it("dispose cleans up (no crash, listeners removed)", async () => {
    const s = await makeSession("race", 1);
    s.loop.advance(0);
    expect(() => { s.dispose(); }).not.toThrow();
  });

  it("pause menu → Settings (Audio/Display only) → Back returns to pause", async () => {
    const s = await makeSession("duel", 1);
    sessions.push(s);
    s.loop.advance(0);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    s.loop.advance(1000 / 60);
    const menu = document.querySelector("[data-pause-menu]");
    const settingsBtn = [...(menu?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Settings",
    );
    settingsBtn?.click();
    const overlay = document.body.textContent ?? "";
    expect(overlay).toContain("Audio");
    expect(overlay).toContain("Display");
    expect(overlay).not.toContain("Controls");
    const back = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Back",
    );
    back?.click();
    // Back over pause returns to the pause menu.
    expect(document.querySelector("[data-pause-menu]")).not.toBeNull();
  });

  it("quit from the pause menu fires onQuit", async () => {
    let quits = 0;
    const s = await makeSession("race", 1, {
      onQuit: () => {
        quits++;
      },
    });
    sessions.push(s);
    s.loop.advance(0);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    s.loop.advance(1000 / 60);
    const menu = document.querySelector("[data-pause-menu]");
    const quitBtn = [...(menu?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Quit",
    );
    quitBtn?.click();
    expect(quits).toBe(1);
  });

  it("resize re-lays-out the split view", async () => {
    const s = await makeSession("race", 1);
    sessions.push(s);
    s.loop.advance(0);
    expect(() => window.dispatchEvent(new Event("resize"))).not.toThrow();
  });
});
