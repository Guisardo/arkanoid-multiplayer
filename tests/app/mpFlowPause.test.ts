// MpFlow pause/quit wiring (ticket 48): coop pause round-trip (request →
// paused broadcast → overlay → resume), frozen sim proof, competitive
// quit-confirm only (sim provably never pauses), quit = removal without
// rejoin hold. Pixi seams mocked (mpFlowResilience pattern).
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
import { deserializeSnapshot } from "net/serializer";
import { unpackMulti } from "app/hostGame";
import type { Snapshot } from "shared/protocol";

function makePair() {
  const holder: { host?: MpFlow; guest?: MpFlow } = {};
  const hostControlLog: string[] = [];
  const guestControlLog: string[] = [];
  const gameWire: ArrayBuffer[] = [];

  const channels: MpChannels = {
    hostToGuest: (_gi, buffer) => {
      gameWire.push(buffer);
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

  /** Every snapshot that crossed the game wire, deserialized. */
  const wireSnapshots = (): Snapshot[] => {
    const out: Snapshot[] = [];
    for (const buf of gameWire) {
      try {
        const kind = new DataView(buf).getUint8(0);
        if (kind === 2) {
          for (const part of unpackMulti(buf)) out.push(deserializeSnapshot(part));
        } else if (kind !== 3) {
          out.push(deserializeSnapshot(buf));
        }
      } catch {
        // Non-snapshot traffic: skipped.
      }
    }
    return out;
  };

  return {
    hostFlow,
    guestFlow,
    hostControlAll: () => [...hostControlLog],
    guestControlAll: () => [...guestControlLog],
    wireSnapshots,
    hostEl,
    guestEl,
  };
}

/** Drive a pair into an in-game match of `mode` (countdown included). */
async function startMatch(
  hostFlow: MpFlow,
  guestFlow: MpFlow,
  mode: "race" | "sharedField",
): Promise<void> {
  await hostFlow.start();
  await guestFlow.start();
  guestFlow.guestHello("Zed", "classic");
  await Promise.resolve();
  guestFlow.guestIntent({ kind: "ready", ready: true });
  await Promise.resolve();
  hostFlow.hostLocalEvent({ type: "setReady", playerId: 0, ready: true });
  if (mode === "sharedField") {
    hostFlow.hostLocalEvent({
      type: "setConfig",
      config: { mode: "sharedField" },
    });
    await Promise.resolve();
  }
  hostFlow.hostStartMatch();
  await new Promise((r) => globalThis.setTimeout(r, 3400));
  await new Promise((r) => globalThis.setTimeout(r, 100));
}

describe("mpFlow pause/quit wiring (ticket 48)", () => {
  const flows: MpFlow[] = [];

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: (now: number) => void): number => {
      return globalThis.setTimeout(() => {
        cb(performance.now());
      }, 16) as unknown as number;
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

  it("coop: guest pause request pauses the sim for all, with the pauser named", async () => {
    const { hostFlow, guestFlow, hostControlAll } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow, "sharedField");
    expect(hostFlow.currentPhase).toBe("inGame");

    // Guest (sim player 1) requests a pause.
    guestFlow.localPausePressed();
    await new Promise((r) => globalThis.setTimeout(r, 50));

    // Host applied it: paused broadcast to every guest + its own overlay.
    expect(hostFlow.pauseSnapshot).toEqual({ paused: true, pausedBy: 1 });
    const pausedMsg = hostControlAll().find((j) => j.includes('"paused"'));
    expect(pausedMsg).toBeDefined();
    expect(pausedMsg).toContain('"by":1');
    // Guest received the broadcast and rendered the overlay.
    expect(guestFlow.pauseSnapshot).toEqual({ paused: true, pausedBy: 1 });
    const overlayText = document.body.textContent ?? "";
    expect(overlayText).toContain("Paused by Zed");

    // Sim frozen: the host's snapshot tick stops advancing.
    const tickBefore = hostFlow.localSnapshots()[0]?.tick ?? 0;
    await new Promise((r) => globalThis.setTimeout(r, 300));
    const tickAfter = hostFlow.localSnapshots()[0]?.tick ?? 0;
    expect(tickAfter).toBe(tickBefore);
  }, 20000);

  it("coop: any player resumes; the pauser cancel path unpause too", async () => {
    const { hostFlow, guestFlow, hostControlAll } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow, "sharedField");
    guestFlow.localPausePressed();
    await new Promise((r) => globalThis.setTimeout(r, 50));
    expect(hostFlow.pauseSnapshot.paused).toBe(true);

    // The HOST (another player) resumes via its overlay button path —
    // hostLocalResume is what the overlay's Resume click calls.
    hostFlow.localPausePressed(); // paused already → no-op (overlay stays)
    expect(hostFlow.pauseSnapshot.paused).toBe(true);
    // Resume from the host side (any player may resume).
    (hostFlow as unknown as { hostLocalResume(): void }).hostLocalResume();
    await new Promise((r) => globalThis.setTimeout(r, 50));
    expect(hostFlow.pauseSnapshot).toEqual({ paused: false, pausedBy: null });
    expect(guestFlow.pauseSnapshot.paused).toBe(false);
    const resumedMsg = hostControlAll().find((j) => j.includes('"resumed"'));
    expect(resumedMsg).toBeDefined();
    // Overlay gone on both sides.
    expect(document.body.textContent ?? "").not.toContain("Paused by");
  }, 20000);

  it("coop: host-local pause (host device Esc) pauses for all", async () => {
    const { hostFlow, guestFlow } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow, "sharedField");
    hostFlow.localPausePressed();
    await new Promise((r) => globalThis.setTimeout(r, 50));
    expect(hostFlow.pauseSnapshot).toEqual({ paused: true, pausedBy: 0 });
    expect(guestFlow.pauseSnapshot).toEqual({ paused: true, pausedBy: 0 });
    // Host default name is "Player 1" (lobby default, slot 0).
    expect(document.body.textContent ?? "").toContain("Paused by Player 1");
  }, 20000);

  it("competitive remote: pause input opens quit-confirm ONLY — sim never pauses", async () => {
    const { hostFlow, guestFlow } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow, "race");
    // Guest presses Esc in a competitive match.
    guestFlow.localPausePressed();
    await new Promise((r) => globalThis.setTimeout(r, 50));
    // Quit-confirm overlay is up…
    expect(document.body.textContent ?? "").toContain("Quit match?");
    // …the sim provably never paused (host + guest state, snapshot ticks).
    expect(hostFlow.pauseSnapshot.paused).toBe(false);
    expect(guestFlow.pauseSnapshot.paused).toBe(false);
    const tickBefore = hostFlow.localSnapshots()[0]?.tick ?? 0;
    await new Promise((r) => globalThis.setTimeout(r, 300));
    expect((hostFlow.localSnapshots()[0]?.tick ?? 0)).toBeGreaterThan(tickBefore);
    // Cancel keeps playing: overlay closes, still no pause.
    (guestFlow as unknown as { hideQuitConfirm(): void }).hideQuitConfirm();
    expect(document.body.textContent ?? "").not.toContain("Quit match?");
    expect(guestFlow.pauseSnapshot.paused).toBe(false);
  }, 20000);

  it("competitive quit from the overlay = removal, no rejoin hold", async () => {
    const { hostFlow, guestFlow, hostControlAll, wireSnapshots } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow, "race");
    // Guest opens quit-confirm and confirms: quit-match on the wire.
    guestFlow.localPausePressed();
    await new Promise((r) => globalThis.setTimeout(r, 50));
    expect(document.body.textContent ?? "").toContain("Quit match?");
    const channels = (guestFlow as unknown as { channels: MpChannels }).channels;
    channels.guestControl(JSON.stringify({ type: "quit-match", player: 1 }));
    await new Promise((r) => globalThis.setTimeout(r, 150));
    // Removal applied on the wire: the guest's own field snapshot (race =
    // parallel mode — the field's player is renumbered to 0 by the remap)
    // shows the quitter "removed".
    const wire = wireSnapshots();
    const last = wire[wire.length - 1];
    const removed = last?.players.find((p) => p.player === 0);
    expect(removed?.state).toBe("removed");
    // No rejoin hold: a rejoin for the quitter is refused.
    channels.guestControl(JSON.stringify({ type: "rejoin", playerId: 100 }));
    await new Promise((r) => globalThis.setTimeout(r, 50));
    const refused = hostControlAll().find((j) => j.includes("rejoin-refused"));
    expect(refused).toBeDefined();
  }, 20000);

  it("coop quit from the pause overlay = slot gone (removal)", async () => {
    const { hostFlow, guestFlow, wireSnapshots } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow, "sharedField");
    guestFlow.localPausePressed();
    await new Promise((r) => globalThis.setTimeout(r, 50));
    expect(hostFlow.pauseSnapshot.paused).toBe(true);
    // The overlay's Quit click sends quit-match while paused.
    const channels = (guestFlow as unknown as { channels: MpChannels }).channels;
    channels.guestControl(JSON.stringify({ type: "quit-match", player: 1 }));
    await new Promise((r) => globalThis.setTimeout(r, 150));
    const wire = wireSnapshots();
    const last = wire[wire.length - 1];
    const removed = last?.players.find((p) => p.player === 1);
    expect(removed?.state).toBe("removed");
  }, 20000);

  it("paused coop keeps feeding guests (no blind-state banner during pause)", async () => {
    const { hostFlow, guestFlow } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow, "sharedField");
    guestFlow.localPausePressed();
    await new Promise((r) => globalThis.setTimeout(r, 50));
    expect(hostFlow.pauseSnapshot.paused).toBe(true);
    // 2 s paused: silence banner threshold is ~1 s — must NOT appear.
    await new Promise((r) => globalThis.setTimeout(r, 2100));
    const texts = [...document.querySelectorAll(".ld-title")].map((b) => b.textContent ?? "");
    expect(texts.some((t) => t.includes("Connection lost"))).toBe(false);
    // Still paused, still in game.
    expect(hostFlow.currentPhase).toBe("inGame");
    expect(guestFlow.currentPhase).toBe("inGame");
  }, 25000);

  it("overlay clicks: guest Resume sends resume; guest Quit sends quit-match", async () => {
    const { hostFlow, guestFlow, guestControlAll, wireSnapshots, guestEl } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow, "sharedField");
    guestFlow.localPausePressed();
    await new Promise((r) => globalThis.setTimeout(r, 50));
    expect(hostFlow.pauseSnapshot.paused).toBe(true);
    // Click the GUEST's overlay Resume button (its own element tree).
    const resumeBtn = [...guestEl.querySelectorAll("button")]
      .find((b) => b.textContent === "Resume");
    expect(resumeBtn).toBeDefined();
    resumeBtn?.click();
    await new Promise((r) => globalThis.setTimeout(r, 50));
    // The resume reached the host: unpaused for all.
    expect(hostFlow.pauseSnapshot.paused).toBe(false);
    expect(guestControlAll().some((j) => j.includes('"resume"'))).toBe(true);
    // Pause again, then click Quit: quit-match goes out, removal applies.
    guestFlow.localPausePressed();
    await new Promise((r) => globalThis.setTimeout(r, 50));
    expect(hostFlow.pauseSnapshot.paused).toBe(true);
    const quitBtn = [...guestEl.querySelectorAll("button")]
      .find((b) => b.textContent === "Quit");
    expect(quitBtn).toBeDefined();
    quitBtn?.click();
    await new Promise((r) => globalThis.setTimeout(r, 150));
    expect(guestControlAll().some((j) => j.includes('"quit-match"'))).toBe(true);
    const wire = wireSnapshots();
    const last = wire[wire.length - 1];
    expect(last?.players.some((p) => p.state === "removed")).toBe(true);
  }, 20000);

  it("competitive: overlay Quit confirms removal; Cancel keeps playing", async () => {
    const { hostFlow, guestFlow, guestControlAll, wireSnapshots, guestEl } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow, "race");
    guestFlow.localPausePressed();
    await new Promise((r) => globalThis.setTimeout(r, 50));
    // Cancel first: overlay closes, no quit on the wire, sim kept running.
    const cancelBtn = [...guestEl.querySelectorAll("button")]
      .find((b) => b.textContent === "Back");
    expect(cancelBtn).toBeDefined();
    cancelBtn?.click();
    await new Promise((r) => globalThis.setTimeout(r, 50));
    expect(guestControlAll().some((j) => j.includes('"quit-match"'))).toBe(false);
    expect(guestFlow.pauseSnapshot.paused).toBe(false);
    // Reopen + confirm Quit: quit-match goes out.
    guestFlow.localPausePressed();
    await new Promise((r) => globalThis.setTimeout(r, 50));
    const quitBtn = [...guestEl.querySelectorAll("button")]
      .find((b) => b.textContent === "Quit");
    expect(quitBtn).toBeDefined();
    quitBtn?.click();
    await new Promise((r) => globalThis.setTimeout(r, 150));
    expect(guestControlAll().some((j) => j.includes('"quit-match"'))).toBe(true);
    const wire = wireSnapshots();
    const last = wire[wire.length - 1];
    expect(last?.players.some((p) => p.state === "removed")).toBe(true);
  }, 20000);

  it("host-local quit from the pause overlay removes the host's players", async () => {
    const { hostFlow, guestFlow, wireSnapshots, hostEl } = makePair();
    flows.push(hostFlow, guestFlow);
    await startMatch(hostFlow, guestFlow, "sharedField");
    hostFlow.localPausePressed();
    await new Promise((r) => globalThis.setTimeout(r, 50));
    expect(hostFlow.pauseSnapshot.paused).toBe(true);
    // The host's overlay Quit click removes the host's own players.
    const quitBtn = [...hostEl.querySelectorAll("button")]
      .find((b) => b.textContent === "Quit");
    expect(quitBtn).toBeDefined();
    quitBtn?.click();
    await new Promise((r) => globalThis.setTimeout(r, 150));
    const wire = wireSnapshots();
    const last = wire[wire.length - 1];
    expect(last?.players.some((p) => p.state === "removed")).toBe(true);
    // Overlay closed by the quit path.
    expect(hostEl.textContent ?? "").not.toContain("Paused by");
  }, 20000);
});
