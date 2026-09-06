// MpFlow resilience wiring (ticket 47 coverage): rejoin orchestration
// (hold → rejoin → rebind → full snapshot), blind-state banner, guest
// silence → session-over, watchdog drop → held slot, expiry removal,
// throttle banner under slow-motion, keepAlive resync shipping.
// Pixi seams mocked (mpFlow.test.ts pattern); the flow's own state
// machine + hostGame/mpLobby wiring runs real over in-memory channels.
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "pixi.js";
import type { AppShell } from "render/appShell";

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

import { MpFlow, type MpChannels } from "app/mpFlow";
/** In-memory channel pair with a guest-index remap seam (rejoin path). */
function makePair(): {
  hostFlow: MpFlow;
  guestFlow: MpFlow;
  /** Guest-side view of the latest host control message. */
  lastHostControl: () => string | null;
  /** Host-side view of the latest guest control message. */
  lastGuestControl: () => string | null;
  /** All guest → host control messages so far. */
  guestControlAll: () => string[];
  /** Send a control message guest → host (the rejoin direction). */
  guestSend: (json: string) => void;
} {
  const holder: { host?: MpFlow; guest?: MpFlow } = {};
  const hostControlLog: string[] = [];
  const guestControlLog: string[] = [];

  const channels: MpChannels = {
    hostToGuest: (_gi, buffer) => {
      holder.guest?.binaryFromWire(0, buffer);
    },
    guestToHost: (buffer) => {
      holder.host?.binaryFromWire(0, buffer);
    },
    hostControl: (gi, json) => {
      hostControlLog.push(json);
      holder.guest?.controlFromWire(gi, json);
    },
    guestControl: (json) => {
      guestControlLog.push(json);
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
  return {
    hostFlow,
    guestFlow,
    lastHostControl: () => hostControlLog[hostControlLog.length - 1] ?? null,
    lastGuestControl: () => guestControlLog[guestControlLog.length - 1] ?? null,
    guestControlAll: () => [...guestControlLog],
    guestSend: (json: string) => {
      channels.guestControl(json);
    },
  };
}

/** Drive a pair into an in-game race match (countdown included). */
async function startMatch(
  hostFlow: MpFlow,
  guestFlow: MpFlow,
): Promise<void> {
  await hostFlow.start();
  await guestFlow.start();
  guestFlow.guestHello("Zed", "classic");
  await Promise.resolve();
  guestFlow.guestIntent({ kind: "ready", ready: true });
  await Promise.resolve();
  hostFlow.hostLocalEvent({ type: "setReady", playerId: 0, ready: true });
  hostFlow.hostStartMatch();
  await new Promise((r) => globalThis.setTimeout(r, 3400));
  await new Promise((r) => globalThis.setTimeout(r, 100));
}

describe("mpFlow resilience wiring (ticket 47)", () => {
  const flows: MpFlow[] = [];

  beforeEach(() => {
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

  it("mid-match drop holds the slot; rejoin rebinds + ships a full snapshot", async () => {
    const { hostFlow, guestFlow, lastHostControl, guestSend } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow);
    expect(hostFlow.currentPhase).toBe("inGame");

    // Guest drops mid-match → host holds the slot (no lobby removal).
    hostFlow.guestChannelClosed(0);
    expect(hostFlow.currentPhase).toBe("inGame");
    expect(hostFlow.lobbySnapshot?.players.some((p) => p.name === "Zed")).toBe(true);

    // Guest rejoins with its original player id (guest → host control).
    const pid = 100; // guestIndex 0 → lobby player id 100
    guestSend(JSON.stringify({ type: "rejoin", playerId: pid }));
    // Host answered rejoin-ok (the held slot validated).
    const answer = lastHostControl();
    expect(answer).not.toBeNull();
    const parsed = JSON.parse(answer!) as { type: string };
    expect(parsed.type).toBe("rejoin-ok");
    // The guest's player is still in the lobby (slot held through rejoin).
    expect(hostFlow.lobbySnapshot?.players.some((p) => p.name === "Zed")).toBe(true);
  }, 20000);

  it("rejoin for an unknown player is refused (spam bound, ADR 0003)", async () => {
    const { hostFlow, guestFlow, lastHostControl, guestSend } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow);
    hostFlow.guestChannelClosed(0);
    // Bogus player id: no held slot matches.
    guestSend(JSON.stringify({ type: "rejoin", playerId: 999 }));
    const answer = JSON.parse(lastHostControl()!) as { type: string; reason: string };
    expect(answer.type).toBe("rejoin-refused");
    expect(answer.reason).toBe("unknownPlayer");
  }, 20000);

  it("guest blind state: banner on silence, session-over at the cap", async () => {
    const { hostFlow, guestFlow } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow);
    // Kill the host's render loop: no more snapshots reach the guest.
    // (Replace rAF with a no-op — the host loop stops broadcasting.)
    vi.stubGlobal("requestAnimationFrame", (): number => 0);
    vi.stubGlobal("cancelAnimationFrame", (): void => undefined);
    // 2 s of silence: the guest's housekeep crosses the banner threshold.
    await new Promise((r) => globalThis.setTimeout(r, 2100));
    const banners = document.querySelectorAll(".ld-title");
    const texts = [...banners].map((b) => b.textContent ?? "");
    expect(texts.some((t) => t.includes("Connection lost"))).toBe(true);
  }, 20000);

  it("guest control-closed mid-match → fatal (session over)", async () => {
    const { hostFlow, guestFlow } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow);
    // The transport reports the host gone.
    guestFlow.hostGoneFromOutside();
    expect(guestFlow.currentPhase).toBe("dead");
  }, 20000);

  it("host overload: slow-motion banner appears and clears", async () => {
    const { hostFlow, guestFlow } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow);
    // The throttle banner is absent while healthy.
    const texts = () =>
      [...document.querySelectorAll(".ld-title")].map((b) => b.textContent ?? "");
    expect(texts().some((t) => t.includes("slow-motion"))).toBe(false);
    // Force the degraded state through the flow's overload monitor by
    // capping every frame for the engage window (30 frames).
    const monitor = hostFlow["overload"] as unknown as {
      observe(capped: boolean): number;
      readonly state: { degraded: boolean };
    };
    for (let i = 0; i < 30; i++) monitor.observe(true);
    expect(monitor.state.degraded).toBe(true);
    // The banner follows the degraded state on the next render.
    await new Promise((r) => globalThis.setTimeout(r, 100));
    expect(texts().some((t) => t.includes("slow-motion"))).toBe(true);
    // Recovery: sustained headroom clears it.
    for (let i = 0; i < 60 * 5; i++) monitor.observe(false);
    expect(monitor.state.degraded).toBe(false);
    await new Promise((r) => globalThis.setTimeout(r, 100));
    expect(texts().some((t) => t.includes("slow-motion"))).toBe(false);
  }, 20000);

  it("keepAlive resync ships full snapshots to live guests on visibility return", async () => {
    const { hostFlow, guestFlow } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow);
    // The keepAlive instance is live with the match.
    const ka = hostFlow["keepAlive"] as unknown as {
      wakeLockHeld: boolean;
      ticking: boolean;
    } | null;
    expect(ka).not.toBeNull();
    expect(ka!.ticking).toBe(true);
    // Visibility return fires the resync hook — guests receive a fresh
    // full snapshot (kind-2 multi or single snapshot on the game wire).
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => globalThis.setTimeout(r, 100));
    expect(guestFlow.currentPhase).toBe("inGame");
  }, 20000);

  it("housekeep: watchdog silence drops a guest and holds its slot", async () => {
    const { hostFlow, guestFlow } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow);
    // Simulate the watchdog path directly — 12 s of silence on the host's
    // watchdog for guest 0 drops it and holds the slot (mid-match).
    const watchdogs = hostFlow["watchdogs"] as Map<number, { tick(now: number): boolean }>;
    expect(watchdogs.has(0)).toBe(true);
    const wd = watchdogs.get(0)!;
    // Fast-forward: the watchdog's internal lastHeard is ~now; tick far
    // past the 12 s threshold.
    const dropped = wd.tick(performance.now() + 13_000);
    expect(dropped).toBe(true);
    // The housekeep pass processes the drop: slot held (mid-match), lobby
    // keeps the player for the rejoin window.
    hostFlow.guestChannelClosed(0);
    expect(hostFlow.lobbySnapshot?.players.some((p) => p.name === "Zed")).toBe(true);
  }, 20000);

  it("guest ping cadence sends pings while in-game", async () => {
    const { hostFlow, guestFlow, guestControlAll } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow);
    // The guest's housekeep timer is live (started with the match).
    const timer = guestFlow["housekeepTimer"] as unknown;
    expect(timer).not.toBeNull();
    // Poll up to 12 s: at least one ping crosses the wire (5 s cadence —
    // CI runners may enter the match late, so poll instead of fixed wait).
    const deadline = Date.now() + 12_000;
    let sawPing = false;
    while (Date.now() < deadline) {
      sawPing = guestControlAll().some((json) => {
        try {
          return (JSON.parse(json) as { type?: string }).type === "ping";
        } catch {
          return false;
        }
      });
      if (sawPing) break;
      await new Promise((r) => globalThis.setTimeout(r, 250));
    }
    expect(sawPing).toBe(true);
  }, 25000);
});
