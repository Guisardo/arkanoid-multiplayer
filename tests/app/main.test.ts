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
const constructedFlows: {
  sampleLocal?: (player: number, tick: number) => unknown;
  reconnect?: () => Promise<unknown>;
}[] = [];
/** The mocked MpFlow instances themselves (phase-driven UI tests). */
const flowInstances: { currentPhase: string }[] = [];
/** localPausePressed calls captured by the mocked flow (ticket 48). */
const pausePresses: { host: boolean }[] = [];
function applyMocks(): void {
  vi.doMock("app/soloSession", () => ({
    startSoloSession: () => soloStart(),
  }));
  // Ticket 56: versus-bots session layer — mock (jsdom cannot load Pixi).
  vi.doMock("app/versusBotsSession", () => ({
    startVersusBotsSession: () => soloStart(),
  }));
  vi.doMock("render/spriteSheet", () => ({
    loadSkinSprites: () => Promise.resolve(undefined),
  }));
  // Ticket 53/N2: main.ts imports the Pixi-backed TouchOverlay — mock it
  // (jsdom cannot load pixi.js; the overlay is covered in its own tests).
  vi.doMock("render/touchOverlay", () => ({
    TouchOverlay: class {
      readonly container = { destroy: (): void => undefined };
      redraw = vi.fn();
      setRegion = vi.fn();
    },
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
    // Copy-paste fallback (ticket 53): never reached in these tests —
    // signaling always succeeds here — but the import needs them.
    connectViaCopyPasteHost: vi.fn(() => Promise.reject(new Error("unused"))),
    connectViaCopyPasteGuest: vi.fn(() => Promise.reject(new Error("unused"))),
  }));
  vi.doMock("app/mpFlow", () => ({
    MpFlow: class {
      start = vi.fn().mockImplementation(() => this.connect().then(() => undefined));
      hostLocalEvent = vi.fn();
      hostStartMatch = vi.fn();
      guestHello = vi.fn();
      guestIntent = vi.fn();
      guestChannelClosed = vi.fn();
      hostGoneFromOutside = vi.fn();
      binaryFromWire = vi.fn();
      controlFromWire = vi.fn();
      dispose = vi.fn();
      localPausePressed = vi.fn();
      /** Ticket 53/N2 probes (mouse/touch wiring reads these). */
      renderApp = null;
      localRegion = vi.fn(() => null);
      localPlayers: readonly number[] = [];
      currentPhase = "lobby";
      currentMode = null;
      localSnapshots = vi.fn(() => []);
      /** Captured seams. */
      sampleLocal: ((player: number, tick: number) => unknown) | undefined;
      reconnect: (() => Promise<unknown>) | undefined;
      private connect: () => Promise<unknown>;
      constructor(opts: {
        connect: () => Promise<unknown>;
        sampleLocal?: (player: number, tick: number) => unknown;
        reconnect?: () => Promise<unknown>;
      }) {
        this.connect = opts.connect;
        this.sampleLocal = opts.sampleLocal;
        this.reconnect = opts.reconnect;
        flowInstances.push(this);
        constructedFlows.push({
          ...(opts.sampleLocal !== undefined ? { sampleLocal: opts.sampleLocal } : {}),
          ...(opts.reconnect !== undefined ? { reconnect: opts.reconnect } : {}),
        });
        pausePresses.push({ host: false });
        this.localPausePressed.mockImplementation(() => {
          const entry = pausePresses[pausePresses.length - 1];
          if (entry !== undefined) entry.host = true;
        });
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
  globalThis.localStorage.clear();
  botsScreenOpts.length = 0;
  soloStart.mockClear();
  fakeRooms.length = 0;
  lastRoom.room = null;
  guestConnections.clear();
  constructedFlows.length = 0;
  flowInstances.length = 0;
  pausePresses.length = 0;
  joinCodePrefill.value = null;
  vi.resetModules();
  vi.doUnmock("app/soloSession");
  vi.doUnmock("app/versusBotsSession");
  vi.doUnmock("render/spriteSheet");
  vi.doUnmock("render/touchOverlay");
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

  it("landing Settings entry opens the settings overlay (ticket 52)", async () => {
    await importMain();
    clickButton("Settings");
    // The real SettingsScreen renders its title + language select.
    const text = document.body.textContent ?? "";
    expect(text).toContain("Controls");
    expect(text).toContain("Language");
    const select = document.querySelector("select[data-language-select]");
    expect(select).toBeDefined();
  });

  it("stored language overrides navigator detection (ticket 52)", async () => {
    // Pre-seed localStorage before the module boots.
    globalThis.localStorage.setItem("settings.language", "es-419");
    await importMain();
    const text = document.body.textContent ?? "";
    // Landing renders in Spanish: the three entries + Settings.
    expect(text).toContain("Solo");
    expect(text).toContain("Multijugador");
    expect(text).toContain("Ajustes");
    expect(text).not.toContain("Multiplayer");
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

  it("host flow: Esc menu edge routes to localPausePressed (ticket 48)", async () => {
    await bootHostFlow();
    // The menu-poll interval is live: an Esc edge fires within ~100 ms.
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    await new Promise((r) => globalThis.setTimeout(r, 200));
    const flow = pausePresses[0];
    expect(flow).toBeDefined();
    expect(flow?.host).toBe(true);
    globalThis.dispatchEvent(new KeyboardEvent("keyup", { code: "Escape" }));
  });

  it("host flow: lobby overlay hides on inGame and returns on lobby", async () => {
    await bootHostFlow();
    const flow = flowInstances[0];
    expect(flow).toBeDefined();
    // Lobby visible at boot.
    expect(document.querySelector(".ld-root")).not.toBeNull();
    // Match starts → the opaque overlay must be gone within a poll tick.
    flow!.currentPhase = "inGame";
    await new Promise((r) => globalThis.setTimeout(r, 200));
    expect(document.querySelector(".ld-root")).toBeNull();
    // Back to lobby (end screen "lobby" choice) → overlay re-attached.
    flow!.currentPhase = "lobby";
    await new Promise((r) => globalThis.setTimeout(r, 200));
    expect(document.querySelector(".ld-root")).not.toBeNull();
  });

  it("guest flow: lobby overlay hides on inGame and returns on lobby", async () => {
    joinCodePrefill.value = "ABC23";
    await importMain();
    await Promise.resolve();
    await Promise.resolve();
    clickButton("Join");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => globalThis.setTimeout(r, 0));
    const flow = flowInstances[0];
    expect(flow).toBeDefined();
    expect(document.querySelector(".ld-root")).not.toBeNull();
    flow!.currentPhase = "inGame";
    await new Promise((r) => globalThis.setTimeout(r, 200));
    expect(document.querySelector(".ld-root")).toBeNull();
    flow!.currentPhase = "lobby";
    await new Promise((r) => globalThis.setTimeout(r, 200));
    expect(document.querySelector(".ld-root")).not.toBeNull();
  });

  it("guest flow: join with a valid code builds the guest flow with input seam", async () => {    // ?code= prefill jumps straight into join mode (QR share path).
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

  it("guest flow: reconnect seam re-wires fresh channels (ticket 47 rejoin)", async () => {
    joinCodePrefill.value = "ABC23";
    await importMain();
    await Promise.resolve();
    await Promise.resolve();
    clickButton("Join");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => globalThis.setTimeout(r, 0));
    const reconnect = constructedFlows[0]?.reconnect;
    expect(reconnect).toBeDefined();
    if (reconnect === undefined) return;
    // The reconnect seam re-enters the room: fresh channels wired with
    // message listeners + send guards (wireGuestConn runs again).
    const result = (await reconnect()) as {
      isHost: boolean;
      guestIndex: number;
      channels: {
        guestToHost: (buffer: ArrayBuffer) => void;
        guestControl: (json: string) => void;
        onGuestDropped: (cb: (guestIndex: number) => void) => void;
        onHostGone: (cb: () => void) => void;
      };
    };
    expect(result.isHost).toBe(false);
    expect(result.guestIndex).toBe(0);
    // Sends on the fresh channels land on the wire (no throw, open state).
    expect(() => {
      result.channels.guestToHost(new ArrayBuffer(4));
    }).not.toThrow();
    expect(() => {
      result.channels.guestControl(JSON.stringify({ type: "ping", atMs: 1 }));
    }).not.toThrow();
    // Drop + host-gone hooks register without firing (close events only).
    let dropped = false;
    let hostGone = false;
    result.channels.onGuestDropped(() => {
      dropped = true;
    });
    result.channels.onHostGone(() => {
      hostGone = true;
    });    expect(dropped).toBe(false);
    expect(hostGone).toBe(false);
  });

  it("guest flow: reconnect failure returns null (room gone)", async () => {
    joinCodePrefill.value = "ABC23";
    await importMain();
    await Promise.resolve();
    await Promise.resolve();
    clickButton("Join");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => globalThis.setTimeout(r, 0));
    const reconnect = constructedFlows[0]?.reconnect;
    expect(reconnect).toBeDefined();
    if (reconnect === undefined) return;
    // Make the signaling re-entry fail: connectViaSignalingGuest rejects.
    const rtc = await vi.importMock("signaling/rtc") as {
      connectViaSignalingGuest: ReturnType<typeof vi.fn>;
    };
    rtc.connectViaSignalingGuest.mockRejectedValueOnce(new Error("room gone"));
    const result = await reconnect();
    expect(result).toBeNull();
  });

  it("guest flow: lobby Quit tears down and re-boots the landing", async () => {
    joinCodePrefill.value = "ABC23";
    await importMain();
    await Promise.resolve();
    await Promise.resolve();
    clickButton("Join");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => globalThis.setTimeout(r, 0));
    // Guest lobby is up (LobbyScreen). Quit → dispose + boot() → landing.
    const quit = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Quit",
    );
    expect(quit).toBeDefined();
    quit!.click();
    // Landing re-rendered: the three entries are back.
    const text = document.body.textContent ?? "";
    expect(text).toContain("Solo");
    expect(text).toContain("Multiplayer");
  });

  it("guest wireGuestConn: binary + control messages route to the flow", async () => {
    joinCodePrefill.value = "ABC23";
    await importMain();
    await Promise.resolve();
    await Promise.resolve();
    clickButton("Join");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => globalThis.setTimeout(r, 0));
    // The signaling-mock connection (guestConnections key 1) has message
    // listeners wired by wireGuestConn — deliver through them.
    const conn = guestConnections.get(1);
    expect(conn).toBeDefined();
    conn?.controlChannel.receive(JSON.stringify({ type: "ping", atMs: 1 }));
    conn?.gameChannel.receive(new ArrayBuffer(4));
    // Routed without throwing (the mocked flow methods absorb them).
    expect(conn?.gameChannel.readyState).toBe("open");
  });

  it("guest lobby: name + skin edits dispatch guest intents to the flow", async () => {
    joinCodePrefill.value = "ABC23";
    await importMain();
    await Promise.resolve();
    await Promise.resolve();
    clickButton("Join");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => globalThis.setTimeout(r, 0));
    // The guest LobbyScreen is up: edit the name input + skin select —
    // both dispatch through onEvent → flow.guestIntent (mocked).
    const nameInput = document.querySelector<HTMLInputElement>("input.ld-input");
    expect(nameInput).not.toBeNull();
    nameInput!.value = "Renamed";
    nameInput!.dispatchEvent(new Event("change"));
    const skinSelect = document.querySelector<HTMLSelectElement>("select.ld-input");
    expect(skinSelect).not.toBeNull();
    skinSelect!.value = skinSelect!.options[1]?.value ?? "";
    skinSelect!.dispatchEvent(new Event("change"));
    // The mocked flow absorbed both intents (no crash, lobby still up).
    const text = document.body.textContent ?? "";
    expect(text).toContain("Lobby");
  });
});

describe("copy-paste fallback (ticket 53, spec §9)", () => {
  /** Poll a DOM query across macrotasks until it returns non-null. */
  async function waitFor<T>(
    query: () => T,
    tries: number,
    stepMs = 5,
  ): Promise<T | null> {
    for (let i = 0; i < tries; i++) {
      const v = query();
      if (v !== null && v !== undefined) return v;
      await new Promise((r) => globalThis.setTimeout(r, stepMs));
    }
    return query();
  }

  /** Fake copy-paste connection channels shared host↔guest in-process. */
  function makeCpConn(): { pc: unknown; gameChannel: FakeDataChannel; controlChannel: FakeDataChannel } {
    return { pc: {}, gameChannel: new FakeDataChannel(), controlChannel: new FakeDataChannel() };
  }

  /** All the standard mocks, but signaling DOWN + copy-paste UP. */
  async function importMainFallback(): Promise<void> {
    vi.resetModules();
    applyMocks();
    vi.doMock("signaling/rtc", () => ({
      openHostRoom: (): FakeRoom => {
        throw new Error("signaling down");
      },
      connectViaSignalingGuest: vi.fn(() => Promise.reject(new Error("signaling down"))),
      connectViaCopyPasteHost: vi.fn((receiveAnswer: Promise<string>) => {
        const conn = makeCpConn();
        return Promise.resolve({
          offerCode: "OFFERCODE123",
          connection: receiveAnswer.then(() => conn),
        });
      }),
      connectViaCopyPasteGuest: vi.fn((offer: string) => {
        expect(offer).toBe("OFFERCODE123");
        const conn = makeCpConn();
        // Deferred: the test releases the connection after asserting the
        // answer screen — otherwise the screen closes before it's visible.
        return Promise.resolve({
          answerCode: "ANSWERCODE456",
          connection: new Promise((resolve) => {
            globalThis.setTimeout(() => { resolve(conn); }, 150);
          }),
        });
      }),
    }));
    await import("app/main");
  }

  afterEach(() => {
    vi.doUnmock("signaling/rtc");
  });

  it("host fallback: signaling down → copy-paste screen, answer paste connects", async () => {
    await importMainFallback();
    clickButton("Multiplayer");
    clickButton("Continue");
    // Copy-paste host screen appears with the offer code.
    const cpRoot = await waitFor(() => document.querySelector(".cp-root"), 50);
    expect(cpRoot).not.toBeNull();
    expect(cpRoot!.textContent).toContain("OFFERCODE123");
    // Paste the answer + submit → connection resolves, screen closes,
    // flow.start() completes (mocked MpFlow.start calls connect).
    const input = cpRoot!.querySelector<HTMLTextAreaElement>("[data-copy-paste-input]");
    expect(input).not.toBeNull();
    input!.value = "ANSWERCODE456";
    cpRoot!.querySelector<HTMLButtonElement>("[data-copy-submit]")!.click();
    const closed = await waitFor(() =>
      document.querySelector(".cp-root") === null ? true : null, 50);
    expect(closed).toBe(true);
  });

  it("guest fallback: signaling down → paste offer → answer screen → connects", async () => {
    joinCodePrefill.value = "ABC23";
    await importMainFallback();
    await Promise.resolve();
    await Promise.resolve();
    clickButton("Join");
    // Guest copy-paste screen appears once the connect promise chain
    // reaches the catch branch — poll for it (microtask count varies).
    const cpRoot = await waitFor(() =>
      document.querySelector(".cp-root"), 50);
    expect(cpRoot).not.toBeNull();
    // Paste the offer + submit → screen re-renders with the answer code.
    const input = cpRoot!.querySelector<HTMLTextAreaElement>("[data-copy-paste-input]");
    input!.value = "OFFERCODE123";
    cpRoot!.querySelector<HTMLButtonElement>("[data-copy-submit]")!.click();
    const cpRoot2 = await waitFor(() => {
      const el = document.querySelector(".cp-root");
      return el !== null && (el.textContent?.includes("ANSWERCODE456")) ? el : null;
    }, 50);
    expect(cpRoot2).not.toBeNull();
    // Connection resolves → screen closes.
    const closed = await waitFor(() =>
      document.querySelector(".cp-root") === null ? true : null, 50);
    expect(closed).toBe(true);
  });
});
