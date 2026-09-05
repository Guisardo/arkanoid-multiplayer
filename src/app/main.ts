// App entry (tickets 23/34/43/45/51): boot → landing. Solo goes straight
// to the session; versus bots opens the trimmed config screen; multiplayer
// opens the room-code flow (create: host room + lobby; join: signaling
// guest + lobby) and drives MpFlow over real WebRTC channels.
import { startSoloSession } from "app/soloSession";
import { loadSkinSprites } from "render/spriteSheet";
import { LandingScreen, RoomCodeScreen, LobbyScreen, codeFromUrl } from "ui/lobbyScreens";
import { VersusBotsConfigScreen } from "ui/versusBotsScreen";
import { detectLocale, type Locale } from "ui/strings";
import { MpFlow } from "app/mpFlow";
import { openHostRoom, connectViaSignalingGuest, type RtcConnection } from "signaling/rtc";
import { Storage } from "persistence/storage";
import { loadSettings } from "ui/settings";

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
  });

  const hostLobbyUI: LobbyScreen = new LobbyScreen({
    host: appHost,
    locale,
    defaultSkinId: settings.appearance.skinId,
    onEvent: (event) => { flow.hostLocalEvent(event); },
    onStart: () => { flow.hostStartMatch(); },
    onQuit: () => {
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
  const flow = new MpFlow({
    host: appHost,
    locale,
    connect: async () => {
      const conn = await connectViaSignalingGuest(code);
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
    },
    onLobbyState: (state) => { guestLobbyUI.sync(state); },
  });

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
      guestLobbyUI.close();
      flow.dispose();
      boot();
    },
  });

  void flow.start().then(() => {
    flow.guestHello(playerName, settings.appearance.skinId);
  });
}

boot();
