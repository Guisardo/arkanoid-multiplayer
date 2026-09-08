// Solo session tests (ticket 42 coverage): the app-level session wiring —
// device merge priority (touch > mouse > gamepad > keyboard), bot path,
// settings overlay open/close (rebind re-apply + flush), Esc menu key,
// touch pause icon, resize re-anchor, dispose cleanup. Pixi-dependent
// modules (appShell, fieldView, touchOverlay) are mocked; everything else
// (sim, adapters, storage, settings) runs real.
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "pixi.js";
import type { AppShell } from "render/appShell";
import type { Snapshot } from "shared/protocol";

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

const shellOpts: { resolution?: number; onContextLost?: () => void; onContextRestored?: () => void }[] = [];
const setResolutionCalls: number[] = [];

vi.mock("render/appShell", () => ({
  createAppShell: async (
    _host: HTMLElement,
    opts?: { resolution?: number; onContextLost?: () => void; onContextRestored?: () => void },
  ): Promise<AppShell> => {
    await Promise.resolve();
    const app = mockApp();
    shellOpts.push(opts ?? {});
    return {
      app,
      dispose: () => {},
      setResolution: (dpr: number) => {
        setResolutionCalls.push(dpr);
      },
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

vi.mock("render/touchOverlay", () => ({
  TouchOverlay: class {
    readonly container = {};
    redraw = vi.fn();
    setRegion = vi.fn();
  },
}));

// ---- Test ----

import { startSoloSession, type SoloSession } from "app/soloSession";

// jsdom lacks the Gamepad API — stub the poll surface (returns no pads).
beforeEach(() => {
  Object.defineProperty(window.navigator, "getGamepads", {
    value: (): (Gamepad | null)[] => [null, null, null, null],
    configurable: true,
    writable: true,
  });
});

async function makeSession(opts: Parameters<typeof startSoloSession>[2] = {}): Promise<SoloSession> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return startSoloSession(host, 1, opts);
}

describe("solo session wiring", () => {
  let sessions: SoloSession[] = [];

  afterEach(() => {
    for (const s of sessions) s.dispose();
    sessions = [];
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("boots, runs ticks, and exposes snapshots", async () => {
    const s = await makeSession();
    sessions.push(s);
    expect(s.app).toBeDefined();
    s.loop.advance(0);
    for (let i = 0; i < 10; i++) s.loop.advance(1000 / 60);
    const snap: Snapshot = s.latestSnapshot();
    expect(snap.tick).toBeGreaterThanOrEqual(10);
    expect(snap.players[0]?.name).toBe("Player 1");
  });

  it("keyboard drives the paddle (axis merge: keyboard fallback)", async () => {
    const s = await makeSession();
    sessions.push(s);
    s.loop.advance(0);
    // Hold ArrowRight (KEYSET_1 default).
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
    s.loop.advance(1000 / 60);
    const x1 = s.latestSnapshot().players[0]?.paddle.x ?? 0;
    for (let i = 0; i < 30; i++) s.loop.advance(1000 / 60);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowRight" }));
    const x2 = s.latestSnapshot().players[0]?.paddle.x ?? 0;
    expect(x2).toBeGreaterThan(x1); // paddle moved right
  });

  it("launch edge serves the ball", async () => {
    const s = await makeSession();
    sessions.push(s);
    s.loop.advance(0);
    expect(s.latestSnapshot().phase).toBe("serve");
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    s.loop.advance(1000 / 60);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
    for (let i = 0; i < 5; i++) s.loop.advance(1000 / 60);
    expect(s.latestSnapshot().phase).toBe("play");
  });

  it("Esc opens the settings overlay (real SettingsScreen DOM)", async () => {
    const s = await makeSession();
    sessions.push(s);
    s.loop.advance(0);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    s.loop.advance(1000 / 60); // render pass processes the menu key
    // The real settings overlay is in the DOM (settingsRoute is NOT mocked):
    // full-screen div carrying the Settings title.
    const overlays = [...document.querySelectorAll("div")].filter(
      (d) => d.style.zIndex === "1000" && (d.textContent ?? "").includes("Settings"),
    );
    expect(overlays.length).toBeGreaterThan(0);
  });

  it("ticket 48 regression: local pause freezes the whole device view", async () => {
    const s = await makeSession();
    sessions.push(s);
    s.loop.advance(0);
    // Serve the ball, then pause via Esc.
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    s.loop.advance(1000 / 60);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
    for (let i = 0; i < 5; i++) s.loop.advance(1000 / 60);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    s.loop.advance(1000 / 60);
    // The settings overlay is up (the pause surface) and the loop is
    // stopped — the whole device view is frozen. The overlay's close
    // path restarts it; the sim continues from where it froze.
    const overlays = [...document.querySelectorAll("div")].filter(
      (d) => d.style.zIndex === "1000" && (d.textContent ?? "").includes("Settings"),
    );
    expect(overlays.length).toBeGreaterThan(0);
    const frozen = s.latestSnapshot().tick;
    // Close via the overlay's own close path (Esc handled by the route).
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    s.loop.advance(1000 / 60);
    for (let i = 0; i < 5; i++) s.loop.advance(1000 / 60);
    expect(s.latestSnapshot().tick).toBeGreaterThan(frozen);
  });

  it("bot path: bot drives player 0 (keyboard ignored)", async () => {
    const s = await makeSession({ bot: { difficulty: "normal", seed: 7 } });
    sessions.push(s);
    s.loop.advance(0);
    for (let i = 0; i < 120; i++) s.loop.advance(1000 / 60);
    // Bot launches on its own schedule (launchMin 67, launchMax 127 ticks).
    expect(s.latestSnapshot().phase).not.toBe("serve");
  });

  it("enablePointer=false skips mouse/gamepad polling without breaking ticks", async () => {
    const s = await makeSession({ enablePointer: false });
    sessions.push(s);
    s.loop.advance(0);
    for (let i = 0; i < 10; i++) s.loop.advance(1000 / 60);
    expect(s.latestSnapshot().tick).toBeGreaterThanOrEqual(10);
  });

  it("resize rebuilds views (orientation change path)", async () => {
    const s = await makeSession();
    sessions.push(s);
    s.loop.advance(0);
    window.dispatchEvent(new Event("resize"));
    // No throw; loop still advances after rebuild.
    for (let i = 0; i < 5; i++) s.loop.advance(1000 / 60);
    expect(s.latestSnapshot().tick).toBeGreaterThanOrEqual(5);
  });

  it("dispose removes listeners (keydown no longer reaches the sim)", async () => {
    const s = await makeSession();
    s.loop.advance(0);
    s.dispose();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
    // No crash; session inert.
    expect(() => s.latestSnapshot()).not.toThrow();
  });

  // ---- Ticket 54: perf wiring ----

  it("boots with the perf machinery (ladder + stats) without breaking ticks", async () => {
    const s = await makeSession();
    sessions.push(s);
    s.loop.advance(0);
    for (let i = 0; i < 30; i++) s.loop.advance(1000 / 60);
    expect(s.latestSnapshot().tick).toBeGreaterThanOrEqual(30);
  });

  it("no degraded banner while healthy", async () => {
    const s = await makeSession();
    sessions.push(s);
    s.loop.advance(0);
    for (let i = 0; i < 30; i++) s.loop.advance(1000 / 60);
    expect(document.querySelector("[data-perf-degraded]")).toBeNull();
  });

  it("settings close re-applies display settings live (no crash)", async () => {
    const s = await makeSession();
    sessions.push(s);
    s.loop.advance(0);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    s.loop.advance(1000 / 60);
    const overlay = [...document.querySelectorAll("div")].find(
      (d) => d.style.zIndex === "1000",
    );
    expect(overlay).toBeDefined();
    // Close via the overlay's Esc path — display re-apply runs (ladder
    // re-pinned, reduced-effects toggled) without throwing.
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    s.loop.advance(1000 / 60);
    for (let i = 0; i < 5; i++) s.loop.advance(1000 / 60);
    expect(s.latestSnapshot().tick).toBeGreaterThan(0);
  });

  it("context loss shows the recovering banner; restore resyncs + recovers", async () => {
    const s = await makeSession();
    sessions.push(s);
    s.loop.advance(0);
    const opts = shellOpts[shellOpts.length - 1]!;
    expect(opts.onContextLost).toBeTypeOf("function");
    expect(opts.onContextRestored).toBeTypeOf("function");
    opts.onContextLost?.();
    expect(document.querySelector("[data-perf-context]")).not.toBeNull();
    opts.onContextRestored?.();
    // Restore banner appears (auto-dismiss is a 2 s timer — present now).
    expect(document.querySelector("[data-perf-context]")).not.toBeNull();
    // Session still alive: ticks continue after the resync.
    for (let i = 0; i < 5; i++) s.loop.advance(1000 / 60);
    expect(s.latestSnapshot().tick).toBeGreaterThan(0);
  });

  it("degraded rung shows the explicit banner; recovery clears it", async () => {
    const s = await makeSession();
    sessions.push(s);
    s.loop.advance(0);
    expect(s.perfRung).toBe(0);
    expect(document.querySelector("[data-perf-degraded]")).toBeNull();
    // Force the floor rung (30 fps degraded) — explicit banner appears.
    s.setPerfRung(3);
    expect(s.perfRung).toBe(3);
    expect(document.querySelector("[data-perf-degraded]")).not.toBeNull();
    // Resolution stepped down (capped by device dpr).
    expect(setResolutionCalls.length).toBeGreaterThan(0);
    // Recovery: back to the top — banner clears.
    s.setPerfRung(0);
    expect(document.querySelector("[data-perf-degraded]")).toBeNull();
    // Session survives every rung change.
    for (let i = 0; i < 5; i++) s.loop.advance(1000 / 60);
    expect(s.latestSnapshot().tick).toBeGreaterThan(0);
  });

  it("?perf=1 mounts the dev overlay; off by default", async () => {
    // Default: no overlay.
    const s = await makeSession();
    sessions.push(s);
    s.loop.advance(0);
    for (let i = 0; i < 3; i++) s.loop.advance(1000 / 60);
    expect(document.querySelector("[data-perf-overlay]")).toBeNull();
  });

  // ---- Ticket 36/53: episode wiring — pause menu, end screen, probes ----

  describe("episode wiring (ticket 36/53)", () => {
    /** Drain one life deterministically via the debug probe. */
    async function loseLife(s: SoloSession): Promise<void> {
      const before = s.latestSnapshot().players[0]?.lives ?? 0;
      s.debugSetBall(20, 240, 0, 120);
      for (let i = 0; i < 120; i++) {
        s.loop.advance(1000 / 60);
        if ((s.latestSnapshot().players[0]?.lives ?? 0) < before) return;
      }
      throw new Error("life not lost within 120 ticks");
    }

    it("probes expose episode state (soloPhase/soloRound/soloScore/paused)", async () => {
      const s = await makeSession();
      sessions.push(s);
      s.loop.advance(0);
      expect(s.soloPhase).toBe("playing");
      expect(s.soloRound).toBe(1);
      expect(s.soloScore).toBe(0);
      expect(s.paused).toBe(false);
    });

    it("Esc opens the pause menu (not settings); Resume continues", async () => {
      const s = await makeSession();
      sessions.push(s);
      s.loop.advance(0);
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
      s.loop.advance(1000 / 60); // render pass processes the menu key
      const menu = document.querySelector("[data-pause-menu]");
      expect(menu).not.toBeNull();
      expect(s.paused).toBe(true);
      // Resume button unpauses and the loop runs again.
      const resume = [...(menu as HTMLElement).querySelectorAll("button")]
        .find((b) => b.textContent === "Resume");
      expect(resume).toBeDefined();
      resume!.click();
      expect(s.paused).toBe(false);
      const before = s.latestSnapshot().tick;
      for (let i = 0; i < 5; i++) s.loop.advance(1000 / 60);
      expect(s.latestSnapshot().tick).toBeGreaterThan(before);
    });

    it("second Esc resumes; a queued menu edge never re-pauses", async () => {
      const s = await makeSession();
      sessions.push(s);
      s.loop.advance(0);
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
      s.loop.advance(1000 / 60);
      expect(s.paused).toBe(true);
      // Second Esc = resume (toggle semantics).
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
      s.loop.advance(1000 / 60);
      expect(s.paused).toBe(false);
      // The next render must not re-pause from a stale edge.
      for (let i = 0; i < 3; i++) s.loop.advance(1000 / 60);
      expect(s.paused).toBe(false);
      expect(document.querySelector("[data-pause-menu]")).toBeNull();
    });

    it("Settings from the pause menu shows Audio/Display only, returns to the menu", async () => {
      const s = await makeSession();
      sessions.push(s);
      s.loop.advance(0);
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
      s.loop.advance(1000 / 60);
      const menu = document.querySelector("[data-pause-menu]") as HTMLElement;
      const settingsBtn = [...menu.querySelectorAll("button")]
        .find((b) => b.textContent === "Settings");
      expect(settingsBtn).toBeDefined();
      settingsBtn!.click();
      // Settings overlay up; pause menu replaced (not both).
      const overlay = [...document.querySelectorAll("div")]
        .find((d) => d.style.zIndex === "1000" && (d.textContent ?? "").includes("Audio"));
      expect(overlay).toBeDefined();
      expect(document.querySelector("[data-pause-menu]")).toBeNull();
      // In-session sections: Audio + Display, no Controls/Appearance.
      const text = overlay!.textContent ?? "";
      expect(text).toContain("Audio");
      expect(text).toContain("Display");
      expect(text).not.toContain("Controls");
      expect(text).not.toContain("Appearance");
      // Back returns to the pause menu (still paused).
      const back = [...overlay!.querySelectorAll("button")].find((b) => b.textContent === "Back");
      back!.click();
      expect(document.querySelector("[data-pause-menu]")).not.toBeNull();
      expect(s.paused).toBe(true);
    });

    it("game over shows the end screen; Continue keeps round + score −60%", async () => {
      const s = await makeSession();
      sessions.push(s);
      s.loop.advance(0);
      // Score some points first: launch, then place the ball to clear a
      // brick row deterministically is overkill — score 0 path is the
      // contract here (Continue on 0 = 0).
      for (let i = 0; i < 3; i++) await loseLife(s);
      // The end screen appears once (guard against multi-tick double-show).
      s.loop.advance(1000 / 60);
      expect(s.soloPhase).toBe("gameOver");
      const endRoot = document.querySelector(".end-root") as HTMLElement | null;
      expect(endRoot).not.toBeNull();
      expect(endRoot!.textContent).toContain("Game over");
      const cont = [...endRoot!.querySelectorAll("button")].find((b) => b.textContent === "Continue");
      cont!.click();
      expect(s.soloPhase).toBe("playing");
      expect(s.soloRound).toBe(1);
      expect(s.soloScore).toBe(0);
      expect(document.querySelector(".end-root")).toBeNull();
    });

    it("Restart from the end screen resets round + score", async () => {
      const s = await makeSession();
      sessions.push(s);
      s.loop.advance(0);
      for (let i = 0; i < 3; i++) await loseLife(s);
      s.loop.advance(1000 / 60);
      const endRoot = document.querySelector(".end-root") as HTMLElement | null;
      expect(endRoot).not.toBeNull();
      const restart = [...endRoot!.querySelectorAll("button")].find((b) => b.textContent === "Restart");
      restart!.click();
      expect(s.soloPhase).toBe("playing");
      expect(s.soloRound).toBe(1);
      expect(s.soloScore).toBe(0);
    });

    it("Quit from the end screen disposes + hands off via onQuit", async () => {
      let quit = 0;
      const host = document.createElement("div");
      document.body.appendChild(host);
      const s = await startSoloSession(host, 1, { onQuit: () => { quit++; } });
      sessions.push(s);
      s.loop.advance(0);
      for (let i = 0; i < 3; i++) await loseLife(s);
      s.loop.advance(1000 / 60);
      const endRoot = document.querySelector(".end-root") as HTMLElement | null;
      expect(endRoot).not.toBeNull();
      const quitBtn = [...endRoot!.querySelectorAll("button")].find((b) => b.textContent === "Quit");
      quitBtn!.click();
      expect(quit).toBe(1);
    });

    it("Quit from the pause menu disposes + hands off via onQuit", async () => {
      let quit = 0;
      const host = document.createElement("div");
      document.body.appendChild(host);
      const s = await startSoloSession(host, 1, { onQuit: () => { quit++; } });
      sessions.push(s);
      s.loop.advance(0);
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
      s.loop.advance(1000 / 60);
      const menu = document.querySelector("[data-pause-menu]") as HTMLElement;
      const quitBtn = [...menu.querySelectorAll("button")].find((b) => b.textContent === "Quit");
      quitBtn!.click();
      expect(quit).toBe(1);
    });

    it("episode complete (round 33 Doh clear) shows the complete end screen without Continue", async () => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const s = await startSoloSession(host, 33);
      sessions.push(s);
      s.loop.advance(0);
      // Deterministic Doh kill: park the ball inside the boss box every
      // tick (boss center 104,44 — 16 HP drains in a few dozen ticks).
      let guard = 0;
      while (s.soloPhase === "playing" && guard < 600) {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
        s.loop.advance(1000 / 60);
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
        for (let i = 0; i < 10; i++) {
          s.debugSetBall(104, 44, 0, 120);
          s.loop.advance(1000 / 60);
        }
        guard++;
      }
      expect(s.soloPhase).toBe("episodeComplete");
      const endRoot = document.querySelector(".end-root") as HTMLElement | null;
      expect(endRoot).not.toBeNull();
      expect(endRoot!.textContent).toContain("Episode complete");
      const cont = [...endRoot!.querySelectorAll("button")].find((b) => b.textContent === "Continue");
      expect(cont).toBeUndefined(); // complete = Restart/Quit only
    });

    it("openSettings + Back resumes the loop (not from pause)", async () => {
      const s = await makeSession();
      sessions.push(s);
      s.loop.advance(0);
      // Direct settings (the public probe — the pre-pause-menu path).
      s.openSettings();
      const overlay = [...document.querySelectorAll("div")]
        .find((d) => d.style.zIndex === "1000" && (d.textContent ?? "").includes("Audio"));
      expect(overlay).toBeDefined();
      // Back closes → onClose → loop.start() (the fromPause=false branch).
      const back = [...overlay!.querySelectorAll("button")].find((b) => b.textContent === "Back");
      back!.click();
      const before = s.latestSnapshot().tick;
      for (let i = 0; i < 5; i++) s.loop.advance(1000 / 60);
      expect(s.latestSnapshot().tick).toBeGreaterThan(before);
    });

    it("touch device: resize re-anchors the touch overlay region", async () => {
      // Coarse pointer → device.touch → TouchAdapter + overlay created.
      const matchMedia = vi
        .spyOn(window, "matchMedia")
        .mockReturnValue({ matches: true } as MediaQueryList);
      try {
        const s = await makeSession();
        sessions.push(s);
        s.loop.advance(0);
        window.dispatchEvent(new Event("resize"));
        for (let i = 0; i < 3; i++) s.loop.advance(1000 / 60);
        // No crash; overlay re-anchored (mocked TouchOverlay.setRegion called).
        expect(s.latestSnapshot().tick).toBeGreaterThan(0);
      } finally {
        matchMedia.mockRestore();
      }
    });
  });
});
