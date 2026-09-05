// rtc.ts tests (ticket 45 coverage): the WebRTC glue against fake
// RTCPeerConnection/DataChannel + a mocked SignalingClient — guest
// signaling flow, host-room per-guest offers/answers, event surfacing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayMessage } from "signaling/relayLogic";

// ---- Fake WebRTC ----

class FakeDataChannel {
  label: string;
  readyState = "connecting";
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};
  constructor(label: string) {
    this.label = label;
  }
  addEventListener(type: string, cb: (ev: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
    if (type === "open") {
      globalThis.setTimeout(() => {
        this.readyState = "open";
        cb({});
      }, 0);
    }
  }
  removeEventListener(): void { /* not needed */ }
}

class FakePC {
  static instances: FakePC[] = [];
  iceGatheringState = "complete";
  localDescription: { type: string; sdp: string } | null = null;
  channels: FakeDataChannel[] = [];
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};
  constructor() {
    FakePC.instances.push(this);
  }
  createDataChannel(label: string): FakeDataChannel {
    const ch = new FakeDataChannel(label);
    this.channels.push(ch);
    return ch;
  }
  addEventListener(type: string, cb: (ev: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener(): void { /* noop */ }
  private fire(type: string, ev: unknown): void {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
  async createOffer(): Promise<{ type: string; sdp: string }> {
    await Promise.resolve();
    return { type: "offer", sdp: "offer-sdp" };
  }
  async createAnswer(): Promise<{ type: string; sdp: string }> {
    await Promise.resolve();
    return { type: "answer", sdp: "answer-sdp" };
  }
  async setLocalDescription(d: { type: string; sdp: string }): Promise<void> {
    await Promise.resolve();
    this.localDescription = d;
  }
  async setRemoteDescription(): Promise<void> {
    await Promise.resolve();
    // Guest side: receiving the offer surfaces the remote channel pair.
    globalThis.setTimeout(() => {
      this.fire("datachannel", { channel: new FakeDataChannel("game") });
      this.fire("datachannel", { channel: new FakeDataChannel("control") });
    }, 0);
  }
}

let savedRTC: typeof globalThis.RTCPeerConnection | undefined;

beforeEach(() => {
  savedRTC = globalThis.RTCPeerConnection;
  FakePC.instances = [];
  globalThis.RTCPeerConnection = FakePC as unknown as typeof globalThis.RTCPeerConnection;
});

afterEach(() => {
  if (savedRTC !== undefined) globalThis.RTCPeerConnection = savedRTC;
  vi.resetModules();
  vi.restoreAllMocks();
});

// The mocked SignalingClient: tests capture `push` to deliver relay events
// and `sent` to inspect what went out.
interface SignalingHarness {
  push(msg: RelayMessage): void;
  sent: RelayMessage[];
}

function mockSignaling(): SignalingHarness {
  const harness: SignalingHarness = {
    sent: [],
    push: () => undefined,
  };
  vi.doMock("signaling/client", () => ({
    SignalingClient: {
      connect: () => Promise.resolve({
        onMessage: (cb: (msg: RelayMessage) => void) => {
          harness.push = cb;
          return () => undefined;
        },
        send: (msg: RelayMessage) => {
          harness.sent.push(msg);
        },
        joinedAck: () => Promise.resolve(3),
        offer: () => Promise.resolve("offer-sdp"),
        sendAnswer: (sdp: string) => {
          harness.sent.push({ type: "guest-answer", sdp });
        },
        sendIce: () => undefined,
        close: () => undefined,
      }),
    },
    SignalingUnavailable: class extends Error {},
  }));
  return harness;
}

async function loadRtc(): Promise<{
  connectViaSignalingGuest: (code: string) => Promise<{
    pc: unknown;
    gameChannel: { label: string };
    controlChannel: { label: string };
  }>;
  openHostRoom: (opts: {
    code: string;
    connectGuest?: (guestIndex: number, conn: unknown) => void;
  }) => {
    ready(): Promise<void>;
    onEvent(cb: (ev: { type: string; guestIndex?: number }) => void): void;
    close(): void;
  };
}> {
  return (await import("signaling/rtc"));
}

describe("rtc (ticket 45)", () => {
  it("guest flow: connect → ack → offer → answer → channels open", async () => {
    mockSignaling();
    const rtc = await loadRtc();
    const conn = await rtc.connectViaSignalingGuest("ABCDE");
    expect(conn.gameChannel.label).toBe("game");
    expect(conn.controlChannel.label).toBe("control");
  });

  it("host room: guest join → per-guest targeted offer → answer → connectGuest fires", async () => {
    const harness = mockSignaling();
    const rtc = await loadRtc();
    const connected: number[] = [];
    const room = rtc.openHostRoom({
      code: "ABCDE",
      connectGuest: (guestIndex) => {
        connected.push(guestIndex);
      },
    });
    await room.ready();

    harness.push({ type: "guest-joined", guestIndex: 0 });
    // connectGuest runs on a microtask (awaits the signaling promise).
    await new Promise((r) => globalThis.setTimeout(r, 10));
    const offer = harness.sent.find(
      (m) => m.type === "host-offer" && m.guestIndex === 0 && m.sdp !== undefined,
    );
    expect(offer).toBeDefined();

    harness.push({ type: "guest-answer", guestIndex: 0, sdp: "answer-sdp" });
    await new Promise((r) => globalThis.setTimeout(r, 10));
    expect(connected).toEqual([0]);
    room.close();
  });

  it("host room surfaces guest-left events", async () => {
    const harness = mockSignaling();
    const rtc = await loadRtc();
    const events: string[] = [];
    const room = rtc.openHostRoom({ code: "ABCDE" });
    await room.ready();
    room.onEvent((ev) => events.push(ev.type));
    harness.push({ type: "guest-left", guestIndex: 2 });
    expect(events).toContain("guest-left");
    room.close();
  });
});
