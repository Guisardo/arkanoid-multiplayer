// App entry (tickets 23/34/43/45/51): boot → landing. Solo goes straight
// to the session; versus bots opens the trimmed config screen; multiplayer
// opens the room-code flow (create: host room + lobby; join: signaling
// guest + lobby) and drives MpFlow over real WebRTC channels.
import { startSoloSession } from "app/soloSession";
import { loadSkinSprites } from "render/spriteSheet";
import { LandingScreen, RoomCodeScreen, LobbyScreen, codeFromUrl } from "ui/lobbyScreens";
import { VersusBotsConfigScreen } from "ui/versusBotsScreen";
import { detectLocale, type Locale } from "ui/strings";
import { MpFlow, type MpConnectResult } from "app/mpFlow";
import { openHostRoom, connectViaSignalingGuest, type RtcConnection } from "signaling/rtc";
import { Storage } from "persistence/storage";
import { loadSettings } from "ui/settings";
import { KeyboardAdapter, KEYSET_1, KEYSET_2 } from "input/keyboard";
import { GamepadAdapter, type GamepadState } from "input/gamepad";
import { EMPTY_ACTIONS, type InputFrame } from "shared/protocol";

const appHostElement = document.getElementById("app");
if (appHostElement === null) throw new Error("missing #app host");
const appHost: HTMLElement = appHostElement;

const locale: Locale = detectLocale(globalThis.navigator.languages);
const storage = new Storage();
const settings = loadSettings(storage);
const playerName = storage.loadAll().name;

function boot(): void {
  const prefill = codeFromUrl(globalThis.location.href);
  const landing = new LandingScreen({
    host: appHost,
    locale,
    prefillCode: prefill,
    onChoice: (choice, joinCode) => {
      landing.close();
      if (choice === "solo") {
        void loadSkinSprites()
          .then(() => startSoloSession(appHost))
          .then((session) => {
            globalThis.__arkanoid = session;
          });
      } else if (choice === "versusBots") {
        openVersusBots();
      } else {
        openMultiplayer(joinCode ?? undefined);
      }
    },
  });
}

function openVersusBots(): void {
  void loadSkinSprites();
  const screen = new VersusBotsConfigScreen({
    host: appHost,
    locale,
    onStart: (config) => {
      screen.root.remove();
      void startSoloSession(appHost, 1, {
        bot: { difficulty: config.difficulty, seed: 1 },
      }).then((session) => {
        globalThis.__arkanoid = session;
      });
    },
    onBack: () => {
      screen.root.remove();
      boot();
    },
  });
}

interface GuestEntry {
  conn: RtcConnection;
}

/**
 * Multiplayer local input (ticket 46): keyboard + gamepad adapters per
 * local sim player, wired into the flow's per-tick sample seam. Bindings
 * load from Settings (rebinds, ticket 41); paddle movement only — fire/
 * cycle edges ride the same frames, pause/quit coordination is ticket 48.
 */
function makeLocalInput() {
  const controls = loadSettings(new Storage()).controls;
  // One keyboard adapter per local player (edges must not be consumed by
  // another player's sample); a single listener fans events to all of them.
  const keyboards = [0, 1, 2, 3].map((i) =>
    new KeyboardAdapter({ player: i }, [controls.keyboard[i] ?? (i === 0 ? KEYSET_1 : KEYSET_2)]),
  );
  const gamepads = new Map<number, GamepadAdapter>();
  const kd = (e: KeyboardEvent): void => {
    for (const k of keyboards) k.keyDown(e.code);
  };
  const ku = (e: KeyboardEvent): void => {
    for (const k of keyboards) k.keyUp(e.code);
  };
  globalThis.addEventListener("keydown", kd);
  globalThis.addEventListener("keyup", ku);
  const poll = (player: number): GamepadAdapter => {
    let pad = gamepads.get(player);
    if (pad === undefined) {
      pad = new GamepadAdapter({ player });
      pad.setBindings(controls.gamepad);
      gamepads.set(player, pad);
    }
    const pads: readonly (Gamepad | null)[] =
      typeof navigator !== "undefined" && typeof navigator.getGamepads === "function"
        ? navigator.getGamepads()
        : [];
    const gp = pads.length > 0 ? pads[0] : undefined;
    if (gp === null || gp === undefined) {
      pad.reset();
      return pad;
    }
    const b = (i: number): boolean => gp.buttons[i]?.pressed === true;
    const state: GamepadState = {
      stickX: gp.axes[0] ?? 0,
      stickY: gp.axes[1] ?? 0,
      dpadLeft: b(14),
      dpadRight: b(15),
      buttons: {
        a: b(0), b: b(1), x: b(2), y: b(3),
        lb: b(4), rb: b(5), rt: b(7), lt: b(6),
        start: b(9),
      },
    };
    pad.feedState(state);
    return pad;
  };
  return {
    /** Per-tick sample: keyboard frame, gamepad overrides on activity. */
    sample(player: number, tick: number) {
      const kb = keyboards[player] ?? keyboards[0];
      const kf = kb === undefined ? null : kb.sampleFrame(tick);
      const frame: InputFrame = kf === null || kf.player === player
        ? (kf ?? { player, tick, axisX: 0, axisY: 0, launch: false, actions: EMPTY_ACTIONS })
        : { ...kf, player };
      const pad = poll(player);
      const gf = pad.sampleFrame(tick);
      if (gf.axisX !== 0 || gf.launch || gf.actions.cycleForward || gf.actions.cycleBack) {
        return gf.player === player ? gf : { ...gf, player };
      }
      return frame.axisX !== 0 || frame.launch || frame.actions.cycleForward
        ? frame
        : { ...frame, player };
    },
    /**
     * Ticket 48: menu/pause edge (Esc / rebindable menu key / gamepad
     * Start). Polled in render cadence by the flow owner — coop sends a
     * pause request, competitive remote opens quit-confirm only.
     */
    consumeMenuEdge(): boolean {
      let edge = false;
      for (const k of keyboards) {
        if (k.consumeMenuEvent() === "pause") edge = true;
      }
      for (const pad of gamepads.values()) {
        if (pad.consumeMenuEvent() === "pause") edge = true;
      }
      return edge;
    },
    dispose(): void {
      globalThis.removeEventListener("keydown", kd);
      globalThis.removeEventListener("keyup", ku);
    },
  };
}

function openMultiplayer(joinCode?: string): void {
  void loadSkinSprites();
  const onBack = (): void => {
    screen.root.remove();
    boot();
  };
  const screen = new RoomCodeScreen({
    host: appHost,
    locale,
    mode: joinCode === undefined ? "create" : "join",
    ...(joinCode !== undefined ? { code: joinCode } : {}),
    pageHost: globalThis.location.host,
    onCreate: (code) => {
      screen.root.remove();
      startHostFlow(code);
    },
    onJoin: (code) => {
      screen.root.remove();
      startGuestFlow(code);
    },
    onBack,
  });
}

function startHostFlow(code: string): void {
  const guests = new Map<number, GuestEntry>();
  const room = openHostRoom({
    code,
    connectGuest: (guestIndex, conn) => {
      guests.set(guestIndex, { conn });
      wireGuestChannels(flow, guestIndex, conn);
    },
  });
  room.onEvent((ev) => {
    if (ev.type === "host-left") flow.hostGoneFromOutside();
  });

  const flow = new MpFlow({
    host: appHost,
    locale,
    connect: async () => {
      await room.ready();
      return {
        isHost: true,
        guestIndex: 0,
        channels: {
          hostToGuest: (guestIndex, buffer) => {
            const g = guests.get(guestIndex);
            if (g !== undefined && g.conn.gameChannel.readyState === "open") {
              g.conn.gameChannel.send(buffer);
            }
          },
          guestToHost: () => undefined,
          hostControl: (guestIndex, json) => {
            const g = guests.get(guestIndex);
            if (g !== undefined && g.conn.controlChannel.readyState === "open") {
              g.conn.controlChannel.send(json);
            }
          },
          guestControl: () => undefined,
          onGuestDropped: (cb) => {
            room.onEvent((ev) => {
              if (ev.type === "guest-left") cb(ev.guestIndex);
            });
          },
          onHostGone: () => undefined,
        },
      };
    },
    onLobbyState: (state) => { hostLobbyUI.sync(state); },
    sampleLocal: (player, tick) => hostInput.sample(player, tick),
  });

  const hostInput = makeLocalInput();
  // Ticket 48: menu/pause edges (Esc / gamepad Start) — polled at render
  // cadence; the flow routes coop pause vs competitive quit-confirm.
  const hostMenuPoll = globalThis.setInterval(() => {
    if (hostInput.consumeMenuEdge()) flow.localPausePressed();
  }, 100);

  const hostLobbyUI: LobbyScreen = new LobbyScreen({
    host: appHost,
    locale,
    defaultSkinId: settings.appearance.skinId,
    onEvent: (event) => { flow.hostLocalEvent(event); },
    onStart: () => { flow.hostStartMatch(); },
    onQuit: () => {
      globalThis.clearInterval(hostMenuPoll);
      hostInput.dispose();
      hostLobbyUI.close();
      room.close();
      flow.dispose();
      boot();
    },
  });

  void flow.start().then(() => {
    flow.hostLocalEvent({ type: "createRoom", code });
    // The createRoom event runs through the lobby session; UI syncs via the
    // onLobbyState callback (host is authoritative).
  });
}

function wireGuestChannels(flow: MpFlow, guestIndex: number, conn: RtcConnection): void {
  conn.gameChannel.addEventListener("message", (ev: MessageEvent<ArrayBuffer>) => {
    const data: ArrayBuffer = ev.data;
    if (data instanceof ArrayBuffer) flow.binaryFromWire(guestIndex, data);
  });
  conn.controlChannel.addEventListener("message", (ev: MessageEvent<string>) => {
    if (typeof ev.data === "string") flow.controlFromWire(guestIndex, ev.data);
  });
  const dropped = (): void => {
    // Channel close = guest dropped (heartbeat/leave detection is ticket 47).
    flow.guestChannelClosed(guestIndex);
  };
  conn.controlChannel.addEventListener("close", dropped);
  conn.gameChannel.addEventListener("close", dropped);
}

function startGuestFlow(code: string): void {
  const flow: MpFlow = new MpFlow({
    host: appHost,
    locale,
    connect: async (): Promise<MpConnectResult> => {
      const conn = await connectViaSignalingGuest(code);
      return wireGuestConn(flow, conn);
    },
    // Ticket 47: mid-match drop → one rejoin attempt with the same code.
    reconnect: async (): Promise<MpConnectResult | null> => {
      try {
        const conn = await connectViaSignalingGuest(code);
        return wireGuestConn(flow, conn);
      } catch {
        return null;
      }
    },
    onLobbyState: (state) => { guestLobbyUI.sync(state); },
    sampleLocal: (player, tick) => guestInput.sample(player, tick),
  });

  const guestInput = makeLocalInput();
  // Ticket 48: menu/pause edges — same routing as the host side.
  const guestMenuPoll = globalThis.setInterval(() => {
    if (guestInput.consumeMenuEdge()) flow.localPausePressed();
  }, 100);

  const guestLobbyUI: LobbyScreen = new LobbyScreen({
    host: appHost,
    locale,
    defaultSkinId: settings.appearance.skinId,
    onEvent: (event) => {
      if (event.type === "setReady") flow.guestIntent({ kind: "ready", ready: event.ready });
      else if (event.type === "setPlayerName") flow.guestIntent({ kind: "name", name: event.name });
      else if (event.type === "setPlayerSkin") flow.guestIntent({ kind: "skin", skinId: event.skinId });
    },
    onStart: () => undefined,
    onQuit: () => {
      globalThis.clearInterval(guestMenuPoll);
      guestInput.dispose();
      guestLobbyUI.close();
      flow.dispose();
      boot();
    },
  });

  void flow.start().then(() => {
    flow.guestHello(playerName, settings.appearance.skinId);
  });
}

/**
 * Ticket 47: wire a guest WebRTC connection into the flow (initial connect
 * and rejoin reuse it — a rejoin gets fresh channels, same flow).
 */
function wireGuestConn(flow: MpFlow, conn: RtcConnection): MpConnectResult {
  const channels = {
    hostToGuest: () => undefined,
    guestToHost: (buffer: ArrayBuffer) => {
      if (conn.gameChannel.readyState === "open") conn.gameChannel.send(buffer);
    },
    hostControl: () => undefined,
    guestControl: (json: string) => {
      if (conn.controlChannel.readyState === "open") conn.controlChannel.send(json);
    },
    onGuestDropped: (cb: (guestIndex: number) => void) => {
      conn.gameChannel.addEventListener("close", () => { cb(0); });
      conn.controlChannel.addEventListener("close", () => { cb(0); });
    },
    onHostGone: (cb: () => void) => {
      conn.controlChannel.addEventListener("close", () => { cb(); });
      conn.gameChannel.addEventListener("close", () => { cb(); });
    },
  };
  conn.gameChannel.addEventListener("message", (ev: MessageEvent<ArrayBuffer>) => {
    const data: ArrayBuffer = ev.data;
    if (data instanceof ArrayBuffer) flow.binaryFromWire(0, data);
  });
  conn.controlChannel.addEventListener("message", (ev: MessageEvent<string>) => {
    if (typeof ev.data === "string") flow.controlFromWire(0, ev.data);
  });
  return { isHost: false, guestIndex: 0, channels };
}

boot();
