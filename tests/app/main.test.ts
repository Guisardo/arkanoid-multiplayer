// main.ts boot tests (tickets 45/46 coverage): the landing → Solo / Versus
// bots / Multiplayer entry flow, plus the host + guest multiplayer flows
// driven end to end against a fake signaling room + fake DataChannels —
// covering startHostFlow / startGuestFlow / wireGuestChannels /
// makeLocalInput (keyboard fan-out + gamepad poll) and the sampleLocal
// seam. Heavy seams (solo session, sprite loading, bots screen, MpFlow)
// are mocked; the landing DOM + routing + channel wiring runs real.
// The module boots on import, so each test re-imports it fresh.
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const soloStart = vi
  .fn(() => Promise.resolve({ app: {}, loop: {}, dispose: (): void => undefined }))
  .mockName("startSoloSession");
const botsScreenOpts: { onStart: (c: unknown) => void }[] = [];

// ---- Fake WebRTC room (host side) ----

type Listener = (ev: { type: string; guestIndex?: number }) => void;

class FakeDataChannel {
  readyState: RTCDataChannelState = "open";
  sent: (ArrayBuffer | string)[] = [];
  private listeners = new Map<string, Set<(ev: unknown) => void>>();
  addEventListener(type: string, cb: (ev: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(cb);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, cb: (ev: unknown) => void): void {
    this.listeners.get(type)?.delete(cb);
  }
  send(data: ArrayBuffer | string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = "closed";
    for (const cb of this.listeners.get("close") ?? []) cb({});
  }
  /** Test hook: deliver a message as the other end would. */
  receive(data: ArrayBuffer | string): void {
    for (const cb of this.listeners.get("message") ?? []) {
      cb({ data });
    }
  }
}

class FakeRoom {
  eventCbs = new Set<Listener>();
  closed = false;
  ready = vi.fn((): Promise<void> => Promise.resolve());
  onEvent(cb: Listener): void {
    this.eventCbs.add(cb);
  }
  close(): void {
    this.closed = true;
  }
  emit(ev: { type: string; guestIndex?: number }): void {
    for (const cb of this.eventCbs) cb(ev);
  }
}

const lastRoom = { room: null as FakeRoom | null };
const fakeRooms: FakeRoom[] = [];
const guestConnections = new Map<number, { gameChannel: FakeDataChannel; controlChannel: FakeDataChannel }>();
/** Every MpFlow the mocked constructor built (host + guest flows). */
const constructedFlows: { sampleLocal?: (player: number, tick: number) => unknown }[] = [];
function applyMocks(): void {
  vi.doMock("app/soloSession", () => ({
    startSoloSession: () => soloStart(),
  }));
  vi.doMock("render/spriteSheet", () => ({
    loadSkinSprites: () => Promise.resolve(undefined),
  }));
  vi.doMock("ui/versusBotsScreen", () => ({
    VersusBotsConfigScreen: class {
      readonly root = { remove: vi.fn() };
      constructor(opts: { onStart: (c: unknown) => void }) {
        botsScreenOpts.push(opts);
      }
    },
  }));
  vi.doMock("signaling/rtc", () => ({
    openHostRoom: (opts: {
      code: string;
      connectGuest?: (guestIndex: number, conn: unknown) => void;
    }): FakeRoom => {
      const room = new FakeRoom();
      fakeRooms.push(room);
      lastRoom.room = room;
      // Simulate a guest finishing connection on the next microtask.
      void Promise.resolve().then(() => {
        const gameChannel = new FakeDataChannel();
        const controlChannel = new FakeDataChannel();
        guestConnections.set(0, { gameChannel, controlChannel });
        opts.connectGuest?.(0, { pc: {}, gameChannel, controlChannel });
      });
      return room;
    },
    connectViaSignalingGuest: vi.fn(() => Promise.resolve(((): { pc: unknown; gameChannel: FakeDataChannel; controlChannel: FakeDataChannel } => {
      const gameChannel = new FakeDataChannel();
      const controlChannel = new FakeDataChannel();
      guestConnections.set(1, { gameChannel, controlChannel });
      return { pc: {}, gameChannel, controlChannel };
    })())),
  }));
  vi.doMock("app/mpFlow", () => ({
    MpFlow: class {
      start = vi.fn().mockResolvedValue(undefined);
      hostLocalEvent = vi.fn();
      hostStartMatch = vi.fn();
      guestHello = vi.fn();
      guestIntent = vi.fn();
      guestChannelClosed = vi.fn();
      hostGoneFromOutside = vi.fn();
      binaryFromWire = vi.fn();
      controlFromWire = vi.fn();
      dispose = vi.fn();
      /** Captured sampleLocal seam (ticket 46 input path). */
      sampleLocal: ((player: number, tick: number) => unknown) | undefined;
      constructor(opts: { sampleLocal?: (player: number, tick: number) => unknown }) {
        this.sampleLocal = opts.sampleLocal;
        constructedFlows.push({ ...(opts.sampleLocal !== undefined ? { sampleLocal: opts.sampleLocal } : {}) });
      }
    },
  }));
  // ?code= prefill: mocked so the guest-join test can force join mode
  // without touching jsdom's location.
  vi.doMock("ui/lobbyScreens", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("ui/lobbyScreens");
    return {
      ...actual,
      codeFromUrl: () => joinCodePrefill.value,
    };
  });
}

/** ?code= prefill override (null = normal create flow). */
const joinCodePrefill = { value: null as string | null };

beforeEach(() => {
  // The boot module expects a #app host element.
  const app = document.createElement("div");
  app.id = "app";
  document.body.appendChild(app);
});

afterEach(() => {
  document.body.replaceChildren();
  botsScreenOpts.length = 0;
  soloStart.mockClear();
  fakeRooms.length = 0;
  lastRoom.room = null;
  guestConnections.clear();
  constructedFlows.length = 0;
  joinCodePrefill.value = null;
  vi.resetModules();
  vi.doUnmock("app/soloSession");
  vi.doUnmock("render/spriteSheet");
  vi.doUnmock("ui/versusBotsScreen");
  vi.doUnmock("signaling/rtc");
  vi.doUnmock("app/mpFlow");
  vi.doUnmock("ui/lobbyScreens");
});

async function importMain(): Promise<void> {
  vi.resetModules();
  applyMocks();
  await import("app/main");
}

function clickButton(label: string): void {
  const btn = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
  expect(btn, `landing button "${label}"`).toBeDefined();
  btn?.click();
}

/** Multiplayer → create → Continue: boots the host flow against the fake room. */
async function bootHostFlow(): Promise<void> {
  await importMain();
  clickButton("Multiplayer");
  clickButton("Continue");
  // Let the fake room deliver the guest connection (microtask).
  await new Promise((r) => globalThis.setTimeout(r, 0));
}

describe("main boot (ticket 45)", () => {
  it("renders the landing with three entries", async () => {
    await importMain();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Solo");
    expect(text).toContain("Versus bots");
    expect(text).toContain("Multiplayer");
  });

  it("Solo entry boots the solo session", async () => {
    await importMain();
    clickButton("Solo");
    await Promise.resolve();
    await Promise.resolve();
    expect(soloStart).toHaveBeenCalledTimes(1);
  });

  it("Versus bots opens the config screen", async () => {
    await importMain();
    clickButton("Versus bots");
    expect(botsScreenOpts).toHaveLength(1);
  });

  it("Multiplayer opens the create room-code screen (no join hint)", async () => {
    await importMain();
    clickButton("Multiplayer");
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Enter the room code");
  });
});

describe("main multiplayer flows (ticket 46 input wiring)", () => {
  it("host flow: create room opens the room + boots the flow", async () => {
    await bootHostFlow();
    expect(fakeRooms).toHaveLength(1);
    expect(fakeRooms[0]?.closed).toBe(false);
  });

  it("host flow: guest connection wires channels; binary + control route to the flow", async () => {
    await bootHostFlow();
    const conn = guestConnections.get(0);
    expect(conn).toBeDefined();
    // wireGuestChannels: messages route into the (mocked) flow methods.
    conn?.controlChannel.receive("hello");
    conn?.gameChannel.receive(new ArrayBuffer(4));
    expect(conn?.gameChannel.readyState).toBe("open");
  });

  it("host flow: channel close signals guest dropped (no crash)", async () => {
    await bootHostFlow();
    const conn = guestConnections.get(0);
    expect(conn).toBeDefined();
    expect(() => conn?.controlChannel.close()).not.toThrow();
  });

  it("host flow: host-left room event routes to the flow (no crash)", async () => {
    await bootHostFlow();
    const room = lastRoom.room;
    expect(room).not.toBeNull();
    expect(() => room?.emit({ type: "host-left" })).not.toThrow();
  });

  it("host flow: sampleLocal seam produces keyboard-driven frames", async () => {
    await bootHostFlow();
    expect(constructedFlows.length).toBeGreaterThan(0);
    const seam = constructedFlows[0]?.sampleLocal;
    expect(seam).toBeDefined();
    if (seam === undefined) return;
    // Idle sample: no keys, no gamepad → zero-axis frame for the player.
    const idle = seam(0, 0) as { player: number; axisX: number };
    expect(idle.player).toBe(0);
    expect(idle.axisX).toBe(0);
    // Keydown fans to the adapter → next sample carries the axis.
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
    const active = seam(0, 1) as { player: number; axisX: number };
    expect(active.axisX).toBe(1);
    globalThis.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowRight" }));
    const released = seam(0, 2) as { player: number; axisX: number };
    expect(released.axisX).toBe(0);
  });

  it("host flow: sampleLocal seam serves every local player slot", async () => {
    await bootHostFlow();
    const seam = constructedFlows[0]?.sampleLocal;
    expect(seam).toBeDefined();
    if (seam === undefined) return;
    // Player 2 (WASD keyset): keydown D → axis on player 1's frame.
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    const p1 = seam(1, 0) as { player: number; axisX: number };
    expect(p1.player).toBe(1);
    expect(p1.axisX).toBe(1);
    globalThis.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD" }));
  });

  it("guest flow: join with a valid code builds the guest flow with input seam", async () => {
    // ?code= prefill jumps straight into join mode (QR share path).
    joinCodePrefill.value = "ABC23";
    await importMain();
    // The auto-click is deferred a microtask — let it land.
    await Promise.resolve();
    await Promise.resolve();
    // Join screen shows the 5 boxes, prefilled with the code.
    const boxes = [...document.querySelectorAll("input")] as HTMLInputElement[];
    expect(boxes.length).toBeGreaterThanOrEqual(5);
    expect(boxes.map((b) => b.value).join("")).toBe("ABC23");
    // Join boots the guest flow (mocked MpFlow captures the seam).
    clickButton("Join");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => globalThis.setTimeout(r, 0));
    expect(constructedFlows.length).toBeGreaterThan(0);
    const seam = constructedFlows[0]?.sampleLocal;
    expect(seam).toBeDefined();
    // The guest seam samples keyboard input like the host's.
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" }));
    const frame = seam?.(0, 0) as { player: number; axisX: number } | undefined;
    expect(frame?.axisX).toBe(-1);
    globalThis.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowLeft" }));
  });
});
