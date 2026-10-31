// Lobby screens tests (ticket 43): landing entries, room-code create
// (code large + QR payload) and join (5 auto-advancing boxes, ?code=
// prefill), lobby render (players, ready toggles, mode greying, kick).
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  LandingScreen,
  MultiplayerChoiceScreen,
  RoomCodeScreen,
  LobbyScreen,
  qrPayloadFor,
  qrMatrix,
  renderQrCanvas,
  codeFromUrl,
  generateRoomCode,
  errorKey,
} from "ui/lobbyScreens";
import { reduceLobby, createLobbyState, MOBILE_DEVICE, type LobbyEvent, type LobbyError } from "app/lobbyState";
import { SKINS } from "content/skins";
import { THEMES } from "content/themes";
import { t } from "ui/strings";
import { CameraError, type QrScanner } from "ui/qrScan";

describe("QR + code helpers", () => {
  it("qrPayload encodes https://<host>/?code=XXXXX", () => {
    expect(qrPayloadFor("ABC23", "example.com")).toBe("https://example.com/?code=ABC23");
  });

  it("qrPayload keeps the project-site subpath (ticket 55)", () => {
    expect(qrPayloadFor("ABC23", "guisardo.github.io", "/arkanoid-multiplayer/"))
      .toBe("https://guisardo.github.io/arkanoid-multiplayer/?code=ABC23");
    // Path without leading slash is normalized; default stays root.
    expect(qrPayloadFor("ABC23", "example.com", "sub/")).toBe("https://example.com/sub/?code=ABC23");
    expect(qrPayloadFor("ABC23", "example.com")).toBe("https://example.com/?code=ABC23");
  });

  it("codeFromUrl reads ?code= and rejects invalid", () => {
    expect(codeFromUrl("https://example.com/?code=ABC23")).toBe("ABC23");
    expect(codeFromUrl("https://example.com/?code=AB0IL")).toBeNull(); // lookalikes
    expect(codeFromUrl("https://example.com/")).toBeNull();
  });

  it("generateRoomCode: 5 chars from the lookalike-free charset", () => {
    let seed = 42;
    const rng = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 20; i++) {
      expect(generateRoomCode(rng)).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
    }
  });
});

describe("LandingScreen", () => {
  it("three entries: Solo, Versus bots, Multiplayer", () => {
    const host = document.body;
    host.innerHTML = "";
    const choices: string[] = [];
    const screen = new LandingScreen({
      host,
      locale: "en-US",
      onChoice: (c) => {
        choices.push(c);
      },
    });
    const btns = [...screen.root.querySelectorAll("button")].map((b) => b.textContent);
    expect(btns).toEqual(["Solo", "Versus bots", "Multiplayer"]);
    screen.root.querySelectorAll("button")[0]?.click();
    screen.root.querySelectorAll("button")[2]?.click();
    expect(choices).toEqual(["solo", "multiplayer"]);
    screen.close();
  });

  it("Settings entry renders + fires onSettings (spec §14: landing always)", () => {
    const host = document.body;
    host.innerHTML = "";
    let opened = false;
    const screen = new LandingScreen({
      host,
      locale: "en-US",
      onSettings: () => {
        opened = true;
      },
      onChoice: () => undefined,
    });
    const btns = [...screen.root.querySelectorAll("button")].map((b) => b.textContent);
    expect(btns).toEqual(["Solo", "Versus bots", "Multiplayer", "Settings"]);
    [...screen.root.querySelectorAll("button")]
      .find((b) => b.textContent === "Settings")!
      .click();
    expect(opened).toBe(true);
    screen.close();
  });

  it("prefill code auto-opens multiplayer flow (deferred a microtask)", async () => {
    const host = document.body;
    host.innerHTML = "";
    const choices: string[] = [];
    const screen = new LandingScreen({
      host,
      locale: "en-US",
      prefillCode: "ABC23",
      onChoice: (c, code) => {
        choices.push(`${c}:${code ?? ""}`);
      },
    });
    // The auto-click is deferred so the caller's `const landing = ...`
    // binding is initialized first (TDZ guard).
    expect(choices).toEqual([]);
    await Promise.resolve();
    expect(choices).toEqual(["multiplayer:ABC23"]);
    screen.close();
  });
});

describe("RoomCodeScreen", () => {
  it("create: code shown large + continue emits the code", () => {
    const host = document.body;
    host.innerHTML = "";
    let created = "";
    const screen = new RoomCodeScreen({
      host,
      locale: "en-US",
      mode: "create",
      code: "ABC23",
      pageHost: "example.com",
      onCreate: (c) => {
        created = c;
      },
      onJoin: () => {},
      onBack: () => {},
    });
    expect(screen.root.textContent).toContain("ABC23");
    [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Continue")?.click();
    expect(created).toBe("ABC23");
    screen.close();
  });

  it("join: 5 boxes auto-advance, join emits the assembled code", () => {
    const host = document.body;
    host.innerHTML = "";
    let joined = "";
    const screen = new RoomCodeScreen({
      host,
      locale: "en-US",
      mode: "join",
      pageHost: "example.com",
      onCreate: () => {},
      onJoin: (c) => {
        joined = c;
      },
      onBack: () => {},
    });
    const boxes = [...screen.root.querySelectorAll("input")];
    expect(boxes).toHaveLength(5);
    // Type A B C 2 3 — focus auto-advances.
    const set = (el: HTMLInputElement, v: string): void => {
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set(boxes[0]!, "A");
    expect(document.activeElement).toBe(boxes[1]);
    set(boxes[1]!, "B");
    set(boxes[2]!, "C");
    set(boxes[3]!, "2");
    set(boxes[4]!, "3");
    [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Join")?.click();
    expect(joined).toBe("ABC23");
    screen.close();
  });

  it("join boxes are one character wide, so all five fit a phone screen (#159)", () => {
    document.body.innerHTML = "";
    const screen = new RoomCodeScreen({
      host: document.body,
      locale: "en-US",
      mode: "join",
      pageHost: "example.com",
      onCreate: () => {},
      onJoin: () => {},
      onBack: () => {},
    });
    for (const box of screen.root.querySelectorAll<HTMLInputElement>("input")) {
      expect(box.style.width).toBe("2ch");
      expect(box.style.letterSpacing).toBe("0");
    }
    screen.close();
  });

  it("join prefill: ?code= fills the boxes", () => {
    const host = document.body;
    host.innerHTML = "";
    const screen = new RoomCodeScreen({
      host,
      locale: "en-US",
      mode: "join",
      code: "XYZ45",
      pageHost: "example.com",
      onCreate: () => {},
      onJoin: () => {},
      onBack: () => {},
    });
    const boxes = [...screen.root.querySelectorAll("input")] as HTMLInputElement[];
    expect(boxes.map((b) => b.value).join("")).toBe("XYZ45");
    screen.close();
  });
});

describe("LobbyScreen", () => {
  it("renders players with ready toggles; host sees kick on remotes", () => {
    const host = document.body;
    host.innerHTML = "";
    const events: LobbyEvent[] = [];
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: (e) => {
        events.push(e);
      },
      onStart: () => {},
      onQuit: () => {},
    });
    // Add a remote via sync (remote-driven state).
    let s = createLobbyState(true);
    s = reduceLobby(s, { type: "remoteJoined", guestIndex: 0, name: "Guest 0" }).state;
    screen.sync(s);
    const text = screen.root.textContent ?? "";
    expect(text).toContain("Guest 0");
    expect(text).toContain("Not ready");
    expect(text).toContain("Kick"); // host sees kick on remote
    // Ready toggle dispatches setReady.
    const readyBtn = [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Not ready");
    readyBtn?.click();
    expect(events.some((e) => e.type === "setReady")).toBe(true);
    screen.close();
  });

  it("mode picker greys Duel unless exactly 2 players", () => {
    const host = document.body;
    host.innerHTML = "";
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: () => {},
      onStart: () => {},
      onQuit: () => {},
    });
    let s = createLobbyState(true);
    s = reduceLobby(s, { type: "remoteJoined", guestIndex: 0, name: "G" }).state;
    s = reduceLobby(s, { type: "remoteJoined", guestIndex: 1, name: "G2" }).state;
    screen.sync(s); // 3 players → Duel disabled
    const duel = [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Duel");
    expect(duel?.disabled).toBe(true);
    screen.close();
  });

  it("guest view: config buttons disabled (read-only panel)", () => {
    const host = document.body;
    host.innerHTML = "";
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: () => {},
      onStart: () => {},
      onQuit: () => {},
    });
    let s = createLobbyState(false);
    s = reduceLobby(s, { type: "remoteJoined", guestIndex: 0, name: "G" }).state;
    screen.sync(s);
    const race = [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Race");
    expect(race?.disabled).toBe(true);
    expect(screen.root.textContent).toContain("host edits");
    screen.close();
  });

  it("countdown phase shows the remaining number; code shows otherwise", () => {
    const host = document.body;
    host.innerHTML = "";
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: () => {},
      onStart: () => {},
      onQuit: () => {},
    });
    let s = createLobbyState(true);
    s = reduceLobby(s, { type: "createRoom", code: "ABC23" }).state;
    screen.sync(s);
    expect(screen.root.textContent).toContain("ABC23");
    s = reduceLobby(s, { type: "startCountdown" }).state; // not all ready → error, stays lobby
    expect(s.phase).toBe("lobby");
    s = reduceLobby(s, { type: "setReady", playerId: 0, ready: true }).state;
    s = reduceLobby(s, { type: "remoteJoined", guestIndex: 0, name: "G" }).state;
    s = reduceLobby(s, { type: "setReady", playerId: 100, ready: true }).state;
    s = reduceLobby(s, { type: "startCountdown" }).state;
    expect(s.phase).toBe("countdown");
    screen.sync(s);
    expect(screen.root.textContent).toContain("3");
    s = reduceLobby(s, { type: "countdownTick" }).state;
    screen.sync(s);
    expect(screen.root.textContent).toContain("2");
    screen.close();
  });

  it("host kick button dispatches removePlayer", () => {
    const host = document.body;
    host.innerHTML = "";
    const events: LobbyEvent[] = [];
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: (e) => {
        events.push(e);
      },
      onStart: () => {},
      onQuit: () => {},
    });
    let s = createLobbyState(true);
    s = reduceLobby(s, { type: "remoteJoined", guestIndex: 0, name: "Guest 0" }).state;
    screen.sync(s);
    const kick = [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Kick");
    kick?.click();
    expect(events.some((e) => e.type === "removePlayer")).toBe(true);
    screen.close();
  });

  it("host mode click dispatches setConfig (selected mode updates)", () => {
    const host = document.body;
    host.innerHTML = "";
    const events: LobbyEvent[] = [];
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: (e) => {
        events.push(e);
      },
      onStart: () => {},
      onQuit: () => {},
    });
    let s = createLobbyState(true);
    s = reduceLobby(s, { type: "remoteJoined", guestIndex: 0, name: "G" }).state;
    screen.sync(s);
    const attack = [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Attack");
    attack?.click();
    expect(events.some((e) => e.type === "setConfig")).toBe(true);
    // Config change resets ready checks — the reducer ran through dispatch.
    expect(screen.root.textContent).toContain("Not ready");
    screen.close();
  });

  it("add-local button dispatches addLocalPlayer; device cap enforced via MOBILE_DEVICE", () => {
    const host = document.body;
    host.innerHTML = "";
    const events: LobbyEvent[] = [];
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      device: MOBILE_DEVICE,
      onEvent: (e) => {
        events.push(e);
      },
      onStart: () => {},
      onQuit: () => {},
    });
    const add = [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Add local player");
    add?.click(); // → 2 locals (mobile cap)
    add?.click(); // → deviceFull, no change
    const adds = events.filter((e) => e.type === "addLocalPlayer");
    expect(adds.length).toBe(2); // dispatch fires even when the reducer errors
    screen.close();
  });

  it("start + quit buttons wire through", () => {
    const host = document.body;
    host.innerHTML = "";
    let started = 0;
    let quit = 0;
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: () => {},
      onStart: () => {
        started++;
      },
      onQuit: () => {
        quit++;
      },
    });
    // All players ready so Start is enabled.
    let s = createLobbyState(true);
    s = reduceLobby(s, { type: "setReady", playerId: 0, ready: true }).state;
    screen.sync(s);
    [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Start")?.click();
    [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Quit")?.click();
    expect(started).toBe(1);
    expect(quit).toBe(1);
    screen.close();
  });

  it("reopen re-attaches after close; idempotent (match → lobby cycle)", () => {
    const host = document.body;
    host.innerHTML = "";
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: () => {},
      onStart: () => undefined,
      onQuit: () => undefined,
    });
    screen.close();
    expect(screen.root.isConnected).toBe(false);
    screen.reopen();
    expect(screen.root.isConnected).toBe(true);
    expect(host.contains(screen.root)).toBe(true);
    // Double reopen: no duplicate nodes.
    screen.reopen();
    expect(host.querySelectorAll(".ld-root").length).toBe(1);
    screen.close();
  });

  // `.ld-root` is a shared *look*: MpFlow's reconnect/throttle/fatal overlays
  // reuse it, so a bare `.ld-root` locator also matches a banner that happens to
  // be on top. That ambiguity made the lobby e2e spec report a guest "still in
  // the lobby" when the guest was in fact playing and merely showing
  // "Connection lost…" (issue #129). `data-screen` is the identity contract.
  it("each screen tags its root with a unique data-screen", () => {
    const host = document.body;
    host.innerHTML = "";
    const lobby = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: () => {},
      onStart: () => undefined,
      onQuit: () => undefined,
    });
    expect(lobby.root.dataset.screen).toBe("lobby");
    lobby.close();

    const room = new RoomCodeScreen({
      host,
      locale: "en-US",
      mode: "create",
      code: "ABC23",
      pageHost: "example.com",
      onCreate: () => {},
      onJoin: () => {},
      onBack: () => undefined,
    });
    expect(room.root.dataset.screen).toBe("roomcode");
    room.close();

    const landing = new LandingScreen({
      host,
      locale: "en-US",
      onSettings: () => undefined,
      onChoice: () => {},
    });
    expect(landing.root.dataset.screen).toBe("landing");
    landing.close();

    // Distinct identities — so `[data-screen="lobby"]` selects exactly one node.
    const identities = new Set(["lobby", "roomcode", "landing", "banner", "throttle", "fatal"]);
    expect(identities.size).toBe(6);
  });

  it("Start disabled until every player is ready (host, lobby phase)", () => {
    const host = document.body;
    host.innerHTML = "";
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: () => {},
      onStart: () => undefined,
      onQuit: () => undefined,
    });
    const startBtn = () =>
      [...screen.root.querySelectorAll("button")].find((b) => b.textContent === "Start");
    // Fresh host lobby: own player unready → disabled.
    let s = createLobbyState(true);
    screen.sync(s);
    expect(startBtn()?.disabled).toBe(true);
    // Host ready, guest not → still disabled.
    s = reduceLobby(s, { type: "setReady", playerId: 0, ready: true }).state;
    s = reduceLobby(s, { type: "remoteJoined", guestIndex: 0, name: "G" }).state;
    screen.sync(s);
    expect(startBtn()?.disabled).toBe(true);
    // Everyone ready → enabled.
    s = reduceLobby(s, { type: "setReady", playerId: 100, ready: true }).state;
    screen.sync(s);
    expect(startBtn()?.disabled).toBe(false);
    // Countdown phase → disabled again.
    s = reduceLobby(s, { type: "startCountdown" }).state;
    screen.sync(s);
    expect(startBtn()?.disabled).toBe(true);
    screen.close();
  });

  it("Settings button renders + fires onSettings (spec §14: lobby always)", () => {
    const host = document.body;
    host.innerHTML = "";
    let opened = 0;
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: () => {},
      onStart: () => undefined,
      onQuit: () => undefined,
      onSettings: () => {
        opened++;
      },
    });
    const settingsBtn = [...screen.root.querySelectorAll("button")].find(
      (b) => b.textContent === "Settings",
    );
    expect(settingsBtn).toBeDefined();
    settingsBtn?.click();
    expect(opened).toBe(1);
    screen.close();
  });
});

describe("errorKey mapping (all lobby errors)", () => {
  it("maps every LobbyError to its string key in both locales", () => {
    const cases: Array<[LobbyError, string]> = [
      ["modeNeedsTwo", "Needs at least 2 players"],
      ["duelNeedsExactlyTwo", "Duel needs exactly 2 players"],
      ["notAllReady", "All players must be ready"],
      ["notHost", "Only the host can do that"],
      ["sessionFull", "Session is full (4 players)"],
      ["deviceFull", "Device local-player limit reached"],
      ["noLateJoin", "Game in progress — join between matches"],
      ["invalidCode", "Invalid room code"],
      ["playerNotFound", "Player not found"],
    ];
    for (const [err, enText] of cases) {
      expect(t("en-US", errorKey(err))).toBe(enText);
    }
    // es-419 spot checks per branch.
    expect(t("es-419", errorKey("modeNeedsTwo"))).toBe("Necesita al menos 2 jugadores");
    expect(t("es-419", errorKey("notHost"))).toBe("Solo el host puede hacer eso");
    expect(t("es-419", errorKey("invalidCode"))).toBe("Código de sala inválido");
  });
});

describe("QR matrix rendering", () => {
  /** Minimal fake qrcode-generator: checkerboard of the given size. */
  const fakeFactory = (n: number) => (): { addData: () => void; make: () => void; getModuleCount: () => number; isDark: (y: number, x: number) => boolean } => ({
    addData: () => {},
    make: () => {},
    getModuleCount: () => n,
    isDark: (y: number, x: number): boolean => (y + x) % 2 === 0,
  });

  it("qrMatrix returns a boolean matrix from the injected factory", () => {
    const m = qrMatrix("https://example.com/?code=ABC23", fakeFactory(3));
    expect(m).not.toBeNull();
    expect(m?.length).toBe(3);
    expect(m?.[0]?.[0]).toBe(true);
    expect(m?.[0]?.[1]).toBe(false);
  });

  it("qrMatrix returns null when the lib throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = qrMatrix("anything", () => {
      throw new Error("lib broken");
    });
    expect(m).toBeNull();
    warn.mockRestore();
  });

  it("RoomCodeScreen create shows the room code (QR canvas path runs against the bundled lib)", () => {
    const host = document.body;
    host.innerHTML = "";
    const screen = new RoomCodeScreen({
      host,
      locale: "en-US",
      mode: "create",
      code: "ABC23",
      pageHost: "example.com",
      onCreate: () => {},
      onJoin: () => {},
      onBack: () => {},
    });
    // jsdom canvas 2d context is null without the canvas package — the
    // matrix branch runs, ctx-null guard skips drawing, no crash.
    expect(screen.root.textContent).toContain("ABC23");
    screen.close();
  });
});


// ---- Ticket 101: real QR library + QR in the lobby ----

/** QR spec finder pattern (7x7): the same literal sits in three corners of every symbol. */
const FINDER = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

function corner(m: boolean[][], row0: number, col0: number): number[][] {
  return FINDER.map((_, r) => FINDER[0]!.map((__, c) => (m[row0 + r]?.[col0 + c] === true ? 1 : 0)));
}

describe("QR with the bundled library (ticket 101)", () => {
  it("qrMatrix encodes a room link with the real library — finder patterns in three corners", () => {
    const m = qrMatrix(qrPayloadFor("ABC23", "guisardo.github.io", "/arkanoid-multiplayer/"));
    expect(m).not.toBeNull();
    const n = m!.length;
    expect(n).toBeGreaterThanOrEqual(21);
    expect(m!.every((row) => row.length === n)).toBe(true);
    expect(corner(m!, 0, 0)).toEqual(FINDER);
    expect(corner(m!, 0, n - 7)).toEqual(FINDER);
    expect(corner(m!, n - 7, 0)).toEqual(FINDER);
  });

  it("qrMatrix returns null (and warns) when the payload cannot be encoded", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(qrMatrix("x".repeat(5000))).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("LobbyScreen QR share (ticket 101)", () => {
  /** jsdom has no 2D context: record fillRect so the drawn modules are observable. */
  function stubCanvas(): { rects: { x: number; y: number }[]; restore: () => void } {
    const rects: { x: number; y: number }[] = [];
    let dark = false;
    const ctx = {
      set fillStyle(v: string) { dark = v === "#000000"; },
      fillRect: (x: number, y: number): void => { if (dark) rects.push({ x, y }); },
    };
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as unknown as HTMLCanvasElement["getContext"]);
    return { rects, restore: () => { spy.mockRestore(); } };
  }

  function mount(extra: Partial<ConstructorParameters<typeof LobbyScreen>[0]> = {}): LobbyScreen {
    document.body.innerHTML = "";
    return new LobbyScreen({
      host: document.body,
      locale: "en-US",
      onEvent: () => {},
      onStart: () => {},
      onQuit: () => {},
      ...extra,
    });
  }

  function hostState(code: string | null, phase: "lobby" | "countdown" = "lobby"): ReturnType<typeof createLobbyState> {
    return { ...createLobbyState(true), code, phase };
  }

  it("shows a QR canvas for the room code next to the code", () => {
    const canvasStub = stubCanvas();
    const screen = mount({ pageHost: "example.com", pagePath: "/arkanoid-multiplayer/" });
    screen.sync(hostState("ABC23"));
    expect(screen.root.querySelectorAll("canvas")).toHaveLength(1);
    expect(screen.root.textContent).toContain("ABC23");
    // Top-left finder pattern: module (0,0) is drawn dark, inside the 4-module quiet zone (8 px modules).
    expect(canvasStub.rects).toContainEqual({ x: 32, y: 32 });
    screen.close();
    canvasStub.restore();
  });

  it("does not redraw while the code is unchanged, and redraws for a new code", () => {
    const canvasStub = stubCanvas();
    const screen = mount({ pageHost: "example.com" });
    screen.sync(hostState("ABC23"));
    const first = screen.root.querySelector("canvas");
    screen.sync(hostState("ABC23"));
    expect(screen.root.querySelector("canvas")).toBe(first);
    screen.sync(hostState("XYZ45"));
    expect(screen.root.querySelector("canvas")).not.toBe(first);
    expect(screen.root.querySelectorAll("canvas")).toHaveLength(1);
    screen.close();
    canvasStub.restore();
  });

  it("hides the QR during the countdown and when there is no code", () => {
    const canvasStub = stubCanvas();
    const screen = mount({ pageHost: "example.com" });
    screen.sync(hostState("ABC23"));
    screen.sync(hostState("ABC23", "countdown"));
    expect(screen.root.querySelectorAll("canvas")).toHaveLength(0);
    screen.sync(hostState(null));
    expect(screen.root.querySelectorAll("canvas")).toHaveLength(0);
    screen.close();
    canvasStub.restore();
  });

  it("renders no QR when the screen has no page host to link to", () => {
    const canvasStub = stubCanvas();
    const screen = mount();
    screen.sync(hostState("ABC23"));
    expect(screen.root.querySelectorAll("canvas")).toHaveLength(0);
    screen.close();
    canvasStub.restore();
  });
});

describe("LobbyScreen skins + theme + names (ticket 44)", () => {
  function makeLobby(events: LobbyEvent[] = []): { screen: LobbyScreen; events: LobbyEvent[] } {
    const host = document.body;
    host.innerHTML = "";
    const seen: LobbyEvent[] = [];
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: (e) => {
        seen.push(e);
      },
      onStart: () => {},
      onQuit: () => {},
    });
    let state = createLobbyState(true);
    for (const e of events) state = reduceLobby(state, e).state;
    screen.sync(state);
    return { screen, events: seen };
  }

  it("local players get a skin select listing every registry skin", () => {
    const { screen } = makeLobby();
    const select = screen.root.querySelector("select");
    expect(select).not.toBeNull();
    const opts = [...(select?.querySelectorAll("option") ?? [])].map((o) => o.textContent);
    expect(opts.length).toBe(SKINS.length);
    screen.close();
  });

  it("skin select change dispatches setPlayerSkin", () => {
    const { screen, events } = makeLobby();
    const select = screen.root.querySelector("select");
    expect(select).not.toBeNull();
    if (select !== null) {
      select.value = SKINS[1]?.id ?? "";
      select.dispatchEvent(new Event("change"));
    }
    expect(events.some((e) => e.type === "setPlayerSkin")).toBe(true);
    screen.close();
  });

  it("local players get a name input (12-char max) dispatching setPlayerName", () => {
    const { screen, events } = makeLobby();
    const input = screen.root.querySelector("input");
    expect(input).not.toBeNull();
    expect(input?.maxLength).toBe(12);
    if (input !== null) {
      input.value = "Ace";
      input.dispatchEvent(new Event("change"));
    }
    expect(events.some((e) => e.type === "setPlayerName")).toBe(true);
    screen.close();
  });

  it("host sees a theme select; change dispatches setConfig with themeId", () => {
    const { screen, events } = makeLobby();
    const selects = screen.root.querySelectorAll("select");
    const themeSelect = [...selects].find((s) =>
      [...s.querySelectorAll("option")].some((o) => o.value === THEMES[1]?.id),
    );
    expect(themeSelect).not.toBeUndefined();
    if (themeSelect !== undefined) {
      themeSelect.value = THEMES[1]?.id ?? "";
      themeSelect.dispatchEvent(new Event("change"));
    }
    const cfg = events.find((e): e is Extract<LobbyEvent, { type: "setConfig" }> => e.type === "setConfig");
    expect(cfg?.config.themeId).toBe(THEMES[1]?.id);
    screen.close();
  });

  it("guest view shows the theme name read-only (no theme select)", () => {
    const host = document.body;
    host.innerHTML = "";
    const screen = new LobbyScreen({
      host,
      locale: "en-US",
      onEvent: () => {},
      onStart: () => {},
      onQuit: () => {},
    });
    // Drive to guest state: hostLeft resets to fresh host lobby, so build
    // guest state directly via sync.
    const guestState = createLobbyState(false);
    screen.sync(guestState);
    const selects = screen.root.querySelectorAll("select");
    // Guest: no theme select (only local-player skin selects remain).
    const themeSelect = [...selects].find((s) =>
      [...s.querySelectorAll("option")].some((o) => o.value === THEMES[1]?.id),
    );
    expect(themeSelect).toBeUndefined();
    // Theme name still visible in the config panel.
    expect(screen.root.textContent).toContain(THEMES[0]?.name ?? "");
    screen.close();
  });

  it("remote players show name + no skin select (host edits nothing for them)", () => {
    const { screen } = makeLobby([
      { type: "remoteJoined", guestIndex: 0, name: "Guest", skinId: SKINS[2]?.id ?? "" },
    ]);
    // Two selects max: one local skin + host theme. Remote adds none.
    const selects = screen.root.querySelectorAll("select");
    expect(selects.length).toBe(2);
    expect(screen.root.textContent).toContain("Guest");
    screen.close();
  });
});

// ---- #159: join by scanning a QR ----

interface FakeScanner extends QrScanner {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  /** Deliver a decoded payload, as the camera would. */
  emit(text: string): void;
  video: HTMLVideoElement | null;
}

function fakeScanner(startResult: () => Promise<void> = () => Promise.resolve()): FakeScanner {
  let onText: ((text: string) => void) | null = null;
  const scanner: FakeScanner = {
    video: null,
    start: vi.fn((video: HTMLVideoElement, cb: (text: string) => void) => {
      scanner.video = video;
      onText = cb;
      return startResult();
    }),
    stop: vi.fn(),
    emit: (text) => { onText?.(text); },
  };
  return scanner;
}

/** Rendered unless the element or an ancestor is display:none. */
function isShown(el: Element | null | undefined): boolean {
  for (let node = el ?? null; node !== null; node = node.parentElement) {
    if (node instanceof HTMLElement && node.style.display === "none") return false;
  }
  return el !== null && el !== undefined;
}

function buttonNamed(root: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll("button")].find((b) => b.textContent === label);
}

/** Visible button with the label (the join and scan views each have a Back). */
function shownButton(root: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll("button")].find((b) => b.textContent === label && isShown(b));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function joinScreen(opts: {
  scanner?: FakeScanner;
  hasCamera?: boolean;
  onJoin?: (code: string) => void;
  onBack?: () => void;
} = {}): RoomCodeScreen {
  document.body.innerHTML = "";
  const scanner = opts.scanner;
  return new RoomCodeScreen({
    host: document.body,
    locale: "en-US",
    mode: "join",
    pageHost: "example.com",
    onCreate: () => {},
    onJoin: opts.onJoin ?? (() => {}),
    onBack: opts.onBack ?? (() => {}),
    ...(scanner !== undefined
      ? { qrScan: { scanner, hasCamera: () => Promise.resolve(opts.hasCamera ?? true) } }
      : {}),
  });
}

/** Join screen with a camera, already in the scan view. */
async function scanning(opts: Parameters<typeof joinScreen>[0] = {}): Promise<RoomCodeScreen> {
  const screen = joinScreen(opts);
  await flush();
  shownButton(screen.root, "Scan QR")?.click();
  await flush();
  return screen;
}

describe("RoomCodeScreen join by QR (#159)", () => {
  it("no scanner wired: no Scan QR button", () => {
    const screen = joinScreen();
    expect(buttonNamed(screen.root, "Scan QR")).toBeUndefined();
    screen.close();
  });

  it("Scan QR shows only once a camera is detected", async () => {
    const without = joinScreen({ scanner: fakeScanner(), hasCamera: false });
    await flush();
    expect(isShown(buttonNamed(without.root, "Scan QR"))).toBe(false);
    without.close();

    const withCam = joinScreen({ scanner: fakeScanner(), hasCamera: true });
    await flush();
    expect(isShown(buttonNamed(withCam.root, "Scan QR"))).toBe(true);
    withCam.close();
  });

  it("a failed camera probe is logged and leaves Scan QR hidden", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("enumerateDevices exploded");
    document.body.innerHTML = "";
    const screen = new RoomCodeScreen({
      host: document.body,
      locale: "en-US",
      mode: "join",
      pageHost: "example.com",
      onCreate: () => {},
      onJoin: () => {},
      onBack: () => {},
      qrScan: { scanner: fakeScanner(), hasCamera: () => Promise.reject(boom) },
    });
    await flush();
    expect(isShown(buttonNamed(screen.root, "Scan QR"))).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("RoomCodeScreen"), boom);
    error.mockRestore();
    screen.close();
  });

  it("create mode never offers Scan QR", async () => {
    document.body.innerHTML = "";
    const screen = new RoomCodeScreen({
      host: document.body,
      locale: "en-US",
      mode: "create",
      code: "ABC23",
      pageHost: "example.com",
      onCreate: () => {},
      onJoin: () => {},
      onBack: () => {},
      qrScan: { scanner: fakeScanner(), hasCamera: () => Promise.resolve(true) },
    });
    await flush();
    expect(isShown(buttonNamed(screen.root, "Scan QR"))).toBe(false);
    screen.close();
  });

  it("Scan QR swaps the code boxes for the camera view and starts the scanner on its video", async () => {
    const scanner = fakeScanner();
    const screen = await scanning({ scanner });
    expect(scanner.start).toHaveBeenCalledTimes(1);
    const video = screen.root.querySelector("video");
    expect(scanner.video).toBe(video);
    expect(isShown(video)).toBe(true);
    expect(isShown(screen.root.querySelector("input"))).toBe(false);
    screen.close();
  });

  it("a scanned Room link fills the boxes, stops the camera and joins", async () => {
    const scanner = fakeScanner();
    const joined: string[] = [];
    const screen = await scanning({ scanner, onJoin: (c) => joined.push(c) });

    scanner.emit("https://guisardo.github.io/arkanoid-multiplayer/?code=XYZ45");

    expect(joined).toEqual(["XYZ45"]);
    expect(scanner.stop).toHaveBeenCalled();
    const boxes = [...screen.root.querySelectorAll("input")];
    expect(boxes.map((b) => b.value).join("")).toBe("XYZ45");
    screen.close();
  });

  it("a scanned bare code joins too", async () => {
    const scanner = fakeScanner();
    const joined: string[] = [];
    const screen = await scanning({ scanner, onJoin: (c) => joined.push(c) });
    scanner.emit("HJK78");
    expect(joined).toEqual(["HJK78"]);
    screen.close();
  });

  it("junk shows the invalid-code error and keeps scanning", async () => {
    const scanner = fakeScanner();
    const joined: string[] = [];
    const screen = await scanning({ scanner, onJoin: (c) => joined.push(c) });

    scanner.emit("https://example.com/menu");

    expect(joined).toEqual([]);
    expect(scanner.stop).not.toHaveBeenCalled();
    expect(isShown(screen.root.querySelector("video"))).toBe(true);
    expect(screen.root.textContent).toContain(t("en-US", "lobby.errInvalidCode"));

    scanner.emit("ABC23");
    expect(joined).toEqual(["ABC23"]);
    screen.close();
  });

  it.each([
    ["denied", "lobby.errCameraDenied"],
    ["noCamera", "lobby.errNoCamera"],
    ["busy", "lobby.errCameraBusy"],
  ] as const)("camera %s: stops, returns to the boxes and shows its own error", async (kind, key) => {
    const scanner = fakeScanner(() => Promise.reject(new CameraError(kind, `test ${kind}`)));
    const screen = await scanning({ scanner });

    expect(scanner.stop).toHaveBeenCalled();
    expect(isShown(screen.root.querySelector("video"))).toBe(false);
    const boxes = [...screen.root.querySelectorAll("input")];
    expect(isShown(boxes[0])).toBe(true);
    expect(document.activeElement).toBe(boxes[0]);
    expect(screen.root.textContent).toContain(t("en-US", key));
    screen.close();
  });

  it("an unclassified camera failure is logged and shown as camera unavailable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("driver exploded");
    const scanner = fakeScanner(() => Promise.reject(boom));
    const screen = await scanning({ scanner });

    expect(error).toHaveBeenCalledWith(expect.stringContaining("RoomCodeScreen"), boom);
    expect(scanner.stop).toHaveBeenCalled();
    expect(screen.root.textContent).toContain(t("en-US", "lobby.errCameraBusy"));
    error.mockRestore();
    screen.close();
  });

  it("Back while scanning stops the camera and returns to the boxes, not out of the screen", async () => {
    const scanner = fakeScanner();
    let backs = 0;
    const screen = await scanning({ scanner, onBack: () => { backs++; } });

    shownButton(screen.root, "Back")?.click();

    expect(scanner.stop).toHaveBeenCalled();
    expect(backs).toBe(0);
    expect(isShown(screen.root.querySelector("video"))).toBe(false);
    expect(isShown(screen.root.querySelector("input"))).toBe(true);
    // A late decode after leaving the scan view does nothing.
    scanner.emit("ABC23");
    expect(isShown(screen.root.querySelector("video"))).toBe(false);

    shownButton(screen.root, "Back")?.click();
    expect(backs).toBe(1);
    screen.close();
  });

  it("closing the screen mid-scan stops the camera", async () => {
    const scanner = fakeScanner();
    const screen = await scanning({ scanner });
    screen.close();
    expect(scanner.stop).toHaveBeenCalled();
  });
});

describe("MultiplayerChoiceScreen (#159)", () => {
  it("offers Create room, Join room and Back", () => {
    document.body.innerHTML = "";
    const picks: string[] = [];
    const screen = new MultiplayerChoiceScreen({
      host: document.body,
      locale: "en-US",
      onChoice: (c) => picks.push(c),
      onBack: () => picks.push("back"),
    });
    expect(screen.root.dataset.screen).toBe("mpchoice");
    buttonNamed(screen.root, "Create room")?.click();
    buttonNamed(screen.root, "Join room")?.click();
    buttonNamed(screen.root, "Back")?.click();
    expect(picks).toEqual(["create", "join", "back"]);
    screen.close();
    expect(document.body.contains(screen.root)).toBe(false);
  });

  it("speaks Spanish", () => {
    document.body.innerHTML = "";
    const screen = new MultiplayerChoiceScreen({
      host: document.body,
      locale: "es-419",
      onChoice: () => {},
      onBack: () => {},
    });
    expect(buttonNamed(screen.root, "Crear sala")).toBeDefined();
    expect(buttonNamed(screen.root, "Unirse a sala")).toBeDefined();
    screen.close();
  });
});

describe("renderQrCanvas quiet zone (#159)", () => {
  it("draws a 4-module light margin around the symbol so cameras can find it on a dark page", () => {
    const rects: Array<[number, number, number, number, string]> = [];
    const ctx = {
      fillStyle: "",
      fillRect(x: number, y: number, w: number, h: number) { rects.push([x, y, w, h, this.fillStyle]); },
    };
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation((() => ctx) as unknown as HTMLCanvasElement["getContext"]);
    const payload = qrPayloadFor("ABC23", "example.com");
    const n = qrMatrix(payload)!.length;

    const canvas = renderQrCanvas(payload)!;

    const moduleCount = n + 2 * 4;
    expect(canvas.width).toBe(canvas.height);
    expect(canvas.width % moduleCount).toBe(0);
    const px = canvas.width / moduleCount;
    // Light background covers the whole canvas, margin included.
    expect(rects[0]).toEqual([0, 0, canvas.width, canvas.height, "#ffffff"]);
    // Top-left finder pattern starts 4 modules in, not at the edge.
    const dark = rects.slice(1);
    expect(Math.min(...dark.map((r) => r[0]))).toBe(4 * px);
    expect(Math.min(...dark.map((r) => r[1]))).toBe(4 * px);
    expect(Math.max(...dark.map((r) => r[0] + r[2]))).toBe(canvas.width - 4 * px);
    getContext.mockRestore();
  });
});
