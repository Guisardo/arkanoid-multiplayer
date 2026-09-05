// SignalingClient tests (ticket 45 coverage): the multi-handler event
// stream (host room listens for joins while awaiting one guest's answer),
// joined-ack + targeted-offer guest awaits, room-full rejection, and the
// send path relaying to the far side — all against a loopback WebSocket
// pair, no real server.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignalingClient, SignalingUnavailable } from "signaling/client";
import type { RelayMessage } from "signaling/relayLogic";

/**
 * Fake WebSocket pair. The instance handed to SignalingClient is `client`;
 * `serverSide` is the same object viewed as the relay's end: send() on one
 * reaches message listeners on the other, and pushServer() delivers a
 * server→client message.
 */
function fakeSocketPair(): {
  client: WebSocket;
  pushServer: (msg: RelayMessage) => void;
  serverReceived: string[];
  closeSpy: ReturnType<typeof vi.fn>;
} {
  const clientListeners: Record<string, Array<(ev: unknown) => void>> = {};
  const serverReceived: string[] = [];
  const closeSpy = vi.fn();

  const client = {
    readyState: 0, // CONNECTING until the open event fires
    send: (data: string): void => {
      serverReceived.push(data);
    },
    close: closeSpy,
    addEventListener: (type: string, cb: (ev: unknown) => void): void => {
      (clientListeners[type] ??= []).push(cb);
      // The fake relay accepts the socket immediately.
      if (type === "open") {
        globalThis.setTimeout(() => {
          (client as unknown as { readyState: number }).readyState = 1;
          cb({});
        }, 0);
      }
    },
    removeEventListener: (type: string, cb: (ev: unknown) => void): void => {
      const list = clientListeners[type] ?? [];
      const i = list.indexOf(cb);
      if (i >= 0) list.splice(i, 1);
    },
  } as unknown as WebSocket;

  const pushServer = (msg: RelayMessage): void => {
    for (const cb of clientListeners.message ?? []) {
      cb({ data: JSON.stringify(msg) });
    }
  };

  return { client, pushServer, serverReceived, closeSpy };
}

/** Patch globalThis.WebSocket so SignalingClient.connect builds the fake. */
async function connectFake(
  pair: ReturnType<typeof fakeSocketPair>,
): Promise<SignalingClient> {
  const ctor = function FakeWebSocket(): WebSocket {
    return pair.client;
  } as unknown as typeof WebSocket;
  const statics = ctor as unknown as Record<string, number>;
  statics.CONNECTING = 0;
  statics.OPEN = 1;
  statics.CLOSING = 2;
  statics.CLOSED = 3;
  const saved = globalThis.WebSocket;
  globalThis.WebSocket = ctor;
  try {
    // Explicit url: node has no `location` for the default builder.
    return await SignalingClient.connect("ABCDE", { role: "guest", url: "ws://fake" });
  } finally {
    globalThis.WebSocket = saved;
  }
}

let savedWs: typeof WebSocket | undefined;

beforeEach(() => {
  savedWs = globalThis.WebSocket;
});

afterEach(() => {
  if (savedWs !== undefined) globalThis.WebSocket = savedWs;
  vi.restoreAllMocks();
});

describe("SignalingClient (ticket 45)", () => {
  it("guest connect sends join, then multi-handler fan-out", async () => {
    const pair = fakeSocketPair();
    const sc = await connectFake(pair);
    // connect(role: guest) sends {type:"join"} immediately.
    expect(pair.serverReceived.some((raw) => (JSON.parse(raw) as RelayMessage).type === "join")).toBe(true);

    const seen1: RelayMessage[] = [];
    const seen2: RelayMessage[] = [];
    const off1 = sc.onMessage((m) => seen1.push(m));
    sc.onMessage((m) => seen2.push(m));
    pair.pushServer({ type: "joined-ack", guestIndex: 2 });
    expect(seen1).toHaveLength(1);
    expect(seen2).toHaveLength(1);
    off1();
    pair.pushServer({ type: "host-offer", guestIndex: 2, sdp: "s" });
    // Unregistered handler no longer receives; the other still does.
    expect(seen1).toHaveLength(1);
    expect(seen2).toHaveLength(2);
    sc.close();
  });

  it("joinedAck resolves with the assigned guest index", async () => {
    const pair = fakeSocketPair();
    const sc = await connectFake(pair);
    const ackP = sc.joinedAck();
    pair.pushServer({ type: "joined-ack", guestIndex: 1 });
    await expect(ackP).resolves.toBe(1);
    sc.close();
  });

  it("offer resolves with the targeted host offer sdp", async () => {
    const pair = fakeSocketPair();
    const sc = await connectFake(pair);
    const offerP = sc.offer();
    pair.pushServer({ type: "host-offer", guestIndex: 0, sdp: "the-sdp" });
    await expect(offerP).resolves.toBe("the-sdp");
    sc.close();
  });

  it("room-full rejects the guest wait cleanly", async () => {
    const pair = fakeSocketPair();
    const sc = await connectFake(pair);
    const offerP = sc.offer();
    pair.pushServer({ type: "room-full", reason: "room full" });
    await expect(offerP).rejects.toBeInstanceOf(SignalingUnavailable);
    sc.close();
  });

  it("sendAnswer + sendIce carry the payload to the relay", async () => {
    const pair = fakeSocketPair();
    const sc = await connectFake(pair);
    sc.sendAnswer("answer-sdp");
    sc.sendIce("cand", 2);
    const answer = JSON.parse(pair.serverReceived[1] ?? "{}") as RelayMessage;
    const ice = JSON.parse(pair.serverReceived[2] ?? "{}") as RelayMessage;
    expect(answer.type).toBe("guest-answer");
    expect(answer.sdp).toBe("answer-sdp");
    expect(ice.type).toBe("ice");
    expect(ice.guestIndex).toBe(2);
    sc.close();
    expect(pair.closeSpy).toHaveBeenCalled();
  });

  it("invalid code is refused before any connection", async () => {
    await expect(SignalingClient.connect("ABC")).rejects.toBeInstanceOf(SignalingUnavailable);
  });
});
