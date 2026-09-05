// MpFlow wiring tests (ticket 45 coverage): the app-level multiplayer flow
// — connect/handshake, host lobby authority + guest intents, countdown →
// match launch (per-guest game-start), wire routing (control/binary),
// end-screen path, disconnection fatals. Pixi seams (appShell,
// splitScreen) mocked; the flow's own state machine + mpLobby/hostGame
// wiring runs real, loopback through an in-memory MpChannels pair.
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
  return {
    stage,
    canvas,
    renderer: { width: 800, height: 600 },
  } as unknown as Application;
};

vi.mock("render/appShell", () => ({
  createAppShell: async (): Promise<AppShell> => {
    await Promise.resolve();
    const app = mockApp();
    return { app, dispose: () => {} };
  },
}));

vi.mock("render/splitScreen", () => ({
  SplitScreenView: class {
    readonly container = { y: 0, destroy: () => {} };
    sync = vi.fn();
  },
}));

// jsdom canvas lacks 2D in vitest default build? remoteStrip uses plain DOM.
// EndScreen is DOM-only — runs real.

import { MpFlow, type MpChannels } from "app/mpFlow";
import { PROTOCOL_VERSION, type InputFrame, EMPTY_ACTIONS } from "shared/protocol";

/** In-memory channel pair: host flow + guest flow directly wired. */
function makePair(): {
  hostFlow: MpFlow;
  guestFlow: MpFlow;
} {
  // Late-binding holder: the channels reference the flows before they exist.
  const holder: { host?: MpFlow; guest?: MpFlow } = {};

  const channels: MpChannels = {
    hostToGuest: (_gi, buffer) => {
      holder.guest?.binaryFromWire(0, buffer);
    },
    guestToHost: (buffer) => {
      holder.host?.binaryFromWire(0, buffer);
    },
    hostControl: (gi, json) => {
      holder.guest?.controlFromWire(gi, json);
    },
    guestControl: (json) => {
      holder.host?.controlFromWire(0, json);
    },
    onGuestDropped: () => undefined,
    onHostGone: () => undefined,
  };

  const hostEl = document.createElement("div");
  document.body.appendChild(hostEl);
  const guestEl = document.createElement("div");
  document.body.appendChild(guestEl);

  const hostFlow = new MpFlow({
    host: hostEl,
    locale: "en-US",
    connect: () => Promise.resolve({ isHost: true, guestIndex: 0, channels }),
  });
  const guestFlow = new MpFlow({
    host: guestEl,
    locale: "en-US",
    connect: () => Promise.resolve({ isHost: false, guestIndex: 0, channels }),
  });
  holder.host = hostFlow;
  holder.guest = guestFlow;
  return { hostFlow, guestFlow };
}

describe("mpFlow wiring (ticket 45)", () => {
  const flows: MpFlow[] = [];

  beforeEach(() => {
    // jsdom exposes rAF but never fires it (no visual refresh) — shim with a
    // 16 ms timer so the accumulator loops actually tick under test.
    vi.stubGlobal("requestAnimationFrame", (cb: (now: number) => void): number => {
      return globalThis.setTimeout(() => { cb(performance.now()); }, 16) as unknown as number;
    });
    vi.stubGlobal("cancelAnimationFrame", (h: number): void => {
      globalThis.clearTimeout(h);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const f of flows.splice(0)) f.dispose();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("host + guest start → hello → replicated lobby state", async () => {
    const { hostFlow, guestFlow } = makePair();
    flows.push(hostFlow, guestFlow);

    await hostFlow.start();
    await guestFlow.start();
    guestFlow.guestHello("Alice", "classic");
    await Promise.resolve();

    const guestState = guestFlow.lobbySnapshot;
    expect(guestState?.players.some((p) => p.name === "Alice")).toBe(true);
    expect(guestFlow.isHostSide).toBe(false);
    expect(hostFlow.isHostSide).toBe(true);
  });

  it("host lobby events broadcast; guest ready intent reaches host state", async () => {
    const { hostFlow, guestFlow } = makePair();
    flows.push(hostFlow, guestFlow);
    await hostFlow.start();
    await guestFlow.start();
    guestFlow.guestHello("Bob", "classic");
    await Promise.resolve();

    guestFlow.guestIntent({ kind: "ready", ready: true });
    await Promise.resolve();
    const hostState = hostFlow.lobbySnapshot;
    const guestSlot = hostState?.players.find((p) => p.name === "Bob");
    expect(guestSlot?.ready).toBe(true);
  });

  it("hostStartMatch: countdown → game-start on guest → inGame phase", async () => {
    const { hostFlow, guestFlow } = makePair();
    flows.push(hostFlow, guestFlow);
    await hostFlow.start();
    await guestFlow.start();
    guestFlow.guestHello("Cara", "classic");
    await Promise.resolve();
    guestFlow.guestIntent({ kind: "ready", ready: true });
    await Promise.resolve();
    hostFlow.hostLocalEvent({ type: "setReady", playerId: 0, ready: true });
    await Promise.resolve();

    hostFlow.hostStartMatch();
    expect(hostFlow.currentPhase).toBe("countdown");
    // 3 seconds of countdown → launchMatchAsHost.
    await new Promise((r) => globalThis.setTimeout(r, 3400));
    expect(hostFlow.currentPhase).toBe("inGame");
    // Guest received game-start + entered inGame (render mount is async).
    expect(guestFlow.currentPhase).toBe("inGame");
    // Let the async appShell mount settle.
    await new Promise((r) => globalThis.setTimeout(r, 100));
  }, 15000);

  it("host local frames tick the match; guest frames reach the host", async () => {
    const { hostFlow, guestFlow } = makePair();
    flows.push(hostFlow, guestFlow);
    await hostFlow.start();
    await guestFlow.start();
    guestFlow.guestHello("Dan", "classic");
    await Promise.resolve();
    guestFlow.guestIntent({ kind: "ready", ready: true });
    await Promise.resolve();
    hostFlow.hostLocalEvent({ type: "setReady", playerId: 0, ready: true });
    hostFlow.hostStartMatch();
    await new Promise((r) => globalThis.setTimeout(r, 3400));
    await new Promise((r) => globalThis.setTimeout(r, 100));

    const frame = (player: number, tick: number, axisX: number): InputFrame => ({
      player, tick, axisX, axisY: 0, launch: false, actions: EMPTY_ACTIONS,
    });
    for (let t = 0; t < 60; t++) {
      hostFlow.localFrame(frame(0, t, 0));
      guestFlow.localFrame(frame(0, t, 0.5));
      // Deterministic drive: host ticks + renders, guest sends + renders.
      hostFlow.advanceTest(1000 / 60);
      guestFlow.advanceTest(1000 / 60);
    }
    const hostSnaps = hostFlow.localSnapshots();
    expect(hostSnaps.length).toBeGreaterThan(0);
    const guestSnaps = guestFlow.localSnapshots();
    expect(guestSnaps.length).toBeGreaterThan(0);
    // Guest got progress rows for the host player (kind-3 wire path); the
    // host's local player keeps its default name until renamed.
    const rows = guestFlow.progressRows();
    expect(rows.some((r) => r.player === 0 && r.name === "Player 1")).toBe(true);
  }, 15000);

  it("guest channel closed → host removes its players", async () => {
    const { hostFlow, guestFlow } = makePair();
    flows.push(hostFlow, guestFlow);
    await hostFlow.start();
    await guestFlow.start();
    guestFlow.guestHello("Eve", "classic");
    await Promise.resolve();
    expect(hostFlow.lobbySnapshot?.players.some((p) => p.name === "Eve")).toBe(true);
    hostFlow.guestChannelClosed(0);
    expect(hostFlow.lobbySnapshot?.players.some((p) => p.name === "Eve")).toBe(false);
  });

  it("host gone → guest fatal screen", async () => {
    const { guestFlow } = makePair();
    flows.push(guestFlow);
    await guestFlow.start();
    guestFlow.hostGoneFromOutside();
    expect(guestFlow.currentPhase).toBe("dead");
  });

  it("protocol version constant is the handshake value", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
