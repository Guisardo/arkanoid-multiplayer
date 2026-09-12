// App entry (tickets 23/34/43/45/51): boot → landing. Solo goes straight
// to the session; versus bots opens the trimmed config screen; multiplayer
// opens the room-code flow (create: host room + lobby; join: signaling
// guest + lobby) and drives MpFlow over real WebRTC channels.
import { startSoloSession } from "app/soloSession";
import { loadSkinSprites } from "render/spriteSheet";
import { LandingScreen, RoomCodeScreen, LobbyScreen, codeFromUrl } from "ui/lobbyScreens";
import { VersusBotsConfigScreen, type VersusBotsConfig } from "ui/versusBotsScreen";
import { startVersusBotsSession } from "app/versusBotsSession";
import { resolveLocale, t, type Locale } from "ui/strings";
import { MpFlow, type MpConnectResult } from "app/mpFlow";
import {
  openHostRoom,
  connectViaSignalingGuest,
  connectViaCopyPasteHost,
  connectViaCopyPasteGuest,
  type RtcConnection,
  type IceConfig,
} from "signaling/rtc";
import { fetchIceConfig } from "signaling/iceConfig";
import { deployEnvFromVite, signalingUrlFor, turnConfigured, type DeployEnv } from "app/deployEnv";
import { CopyPasteHostScreen, CopyPasteGuestScreen } from "ui/copyPasteScreens";
import { Storage } from "persistence/storage";
import { loadSettings } from "ui/settings";
import { showSettings } from "app/settingsRoute";
import { KeyboardAdapter, KEYSET_1, KEYSET_2 } from "input/keyboard";
import { GamepadAdapter, type GamepadState } from "input/gamepad";
import { MouseAdapter } from "input/mouse";
import { TouchAdapter } from "input/touch";
import { TouchOverlay } from "render/touchOverlay";
import { detectDeviceClass } from "app/mobileLayout";
import { layoutField } from "render/layout";
import { EMPTY_ACTIONS, type InputFrame } from "shared/protocol";

const appHostElement = document.getElementById("app");
if (appHostElement === null) throw new Error("missing #app host");
const appHost: HTMLElement = appHostElement;

const storage = new Storage();
const settings = loadSettings(storage);
// Deploy environment (ticket 55): production reads VITE_SIGNALING_BASE /
// VITE_TURN_URL at build time; absent (dev/e2e) keeps same-origin
// signaling + STUN-only ICE.
const deployEnv: DeployEnv = deployEnvFromVite(import.meta.env);
// Settings override + auto-detect (spec §14): stored language wins.
const locale: Locale = resolveLocale(
  storage.loadAll().language,
  globalThis.navigator.languages,
);
const playerName = storage.loadAll().name;

// Document chrome follows the active locale (spec §14).
if (typeof document !== "undefined") {
  document.documentElement.lang = locale === "es-419" ? "es" : "en";
  document.title = t(locale, "app.title");
}

/** Settings overlay from landing/lobby (spec §14: always reachable). */
function openSettingsOverlay(flow?: MpFlow): void {
  showSettings(appHost, locale, storage, {
    // Ticket 30: audio sliders + mute apply live when a flow is up.
    onChange: (audio) => {
      flow?.applyAudioSettings({
        music: audio.music,
        sfx: audio.sfx,
        mute: audio.mute,
      });
    },
  });
}

function boot(): void {
  const prefill = codeFromUrl(globalThis.location.href);
  const landing = new LandingScreen({
    host: appHost,
    locale,
    prefillCode: prefill,
    onSettings: openSettingsOverlay,
    onChoice: (choice, joinCode) => {
      landing.close();
      if (choice === "solo") {
        void loadSkinSprites()
          .then(() => startSoloSession(appHost, 1, { onQuit: boot }))
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
      // Ticket 56: real versus match — human plays, bots play.
      void startVersusBotsSession(appHost, {
        variant: config.variant,
        bots: config.bots,
        difficulty: config.difficulty,
        skinId: settings.appearance.skinId,
        onRematch: () => { openVersusBotsWith(config); },
        onBackToConfig: () => { openVersusBots(); },
        onQuit: boot,
      }).then((session) => {
        globalThis.__arkanoidBots = session;
      });
    },
    onBack: () => {
      screen.root.remove();
      boot();
    },
  });
}

/** Rematch: same config, fresh session (ticket 56 end-screen flow). */
function openVersusBotsWith(config: VersusBotsConfig): void {
  void loadSkinSprites();
  void startVersusBotsSession(appHost, {
    variant: config.variant,
    bots: config.bots,
    difficulty: config.difficulty,
    skinId: settings.appearance.skinId,
    onRematch: () => { openVersusBotsWith(config); },
    onBackToConfig: () => { openVersusBots(); },
    onQuit: boot,
  }).then((session) => {
    globalThis.__arkanoidBots = session;
  });
}

interface GuestEntry {
  conn: RtcConnection;
}

/**
 * Multiplayer local input (tickets 46 + 53/N2): keyboard + gamepad + mouse
 * + touch adapters per local sim player, wired into the flow's per-tick
 * sample seam. Bindings load from Settings (rebinds, ticket 41). Mouse
 * chases the pointer inside the player's own field region (binary ±1,
 * parity with keyboard); touch = virtual stick + cluster overlay.
 */
function makeLocalInput(flow: MpFlow) {
  const controls = loadSettings(new Storage()).controls;
  // One keyboard adapter per local player (edges must not be consumed by
  // another player's sample); a single listener fans events to all of them.
  const keyboards = [0, 1, 2, 3].map((i) =>
    new KeyboardAdapter({ player: i }, [controls.keyboard[i] ?? (i === 0 ? KEYSET_1 : KEYSET_2)]),
  );
  const gamepads = new Map<number, GamepadAdapter>();
  // N2: mouse per local player; touch per local player (mobile ≤2).
  const mice = new Map<number, MouseAdapter>();
  const touches = new Map<number, TouchAdapter>();
  const touchOverlays = new Map<number, TouchOverlay>();
  const kd = (e: KeyboardEvent): void => {
    for (const k of keyboards) k.keyDown(e.code);
  };
  const ku = (e: KeyboardEvent): void => {
    for (const k of keyboards) k.keyUp(e.code);
  };
  globalThis.addEventListener("keydown", kd);
  globalThis.addEventListener("keyup", ku);

  const coarse =
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(pointer: coarse)").matches;
  const ua: string =
    typeof globalThis.navigator !== "undefined" ? globalThis.navigator.userAgent : "";
  const device = detectDeviceClass(coarse, ua);

  /** Ensure adapters + overlay exist for a local player (match start). */
  const ensurePlayer = (player: number): void => {
    if (!mice.has(player)) mice.set(player, new MouseAdapter({ player }));
    if (device.touch && !touches.has(player)) {
      const adapter = new TouchAdapter({
        player,
        mode: "solo",
        layout: { stick: { x: 80, y: 0 }, buttons: {}, buttonRadius: 24 },
      });
      touches.set(player, adapter);
      const app = flow.renderApp;
      const region = flow.localRegion(player);
      if (app !== null && region !== null) {
        const overlay = new TouchOverlay(adapter, region, "solo");
        app.stage.addChild(overlay.container);
        touchOverlays.set(player, overlay);
      }
    }
  };

  /** Pointer events on the canvas → mouse/touch adapters (region-routed). */
  const onPointerMove = (e: PointerEvent): void => {
    const app = flow.renderApp;
    if (app === null) return;
    const rect = app.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (e.pointerType === "touch") {
      for (const [player, adapter] of touches) {
        const region = flow.localRegion(player);
        if (region === null) continue;
        adapter.pointerMove(e.pointerId, px - region.x, py - region.y);
      }
      return;
    }
    // Mouse: route to the field the pointer is inside (paddle chase).
    for (const [player, mouse] of mice) {
      const region = flow.localRegion(player);
      if (region === null) continue;
      if (px >= region.x && px < region.x + region.w && py >= region.y && py < region.y + region.h) {
        const layout = layoutField(region);
        const fieldX = (px - layout.field.x) / layout.scale;
        const snap = flow.localSnapshots()[mice.size > 1 ? flow.localPlayers.indexOf(player) : 0];
        const paddleX = snap?.players.find((p) => p.player === player)?.paddle.x ?? 104;
        mouse.feedPointer(fieldX, paddleX);
      }
    }
  };
  const onPointerDown = (e: PointerEvent): void => {
    const app = flow.renderApp;
    if (app === null) return;
    if (e.pointerType === "touch") {
      const rect = app.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      for (const [player, adapter] of touches) {
        const region = flow.localRegion(player);
        if (region === null) continue;
        adapter.pointerDown(e.pointerId, px - region.x, py - region.y);
      }
      return;
    }
    if (e.button === 0) for (const mouse of mice.values()) mouse.feedClick();
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === "touch") {
      for (const adapter of touches.values()) adapter.pointerUp(e.pointerId);
    }
  };

  const bindPointerEvents = (): void => {
    const app = flow.renderApp;
    if (app === null) return;
    app.canvas.addEventListener("pointermove", onPointerMove);
    app.canvas.addEventListener("pointerdown", onPointerDown);
    app.canvas.addEventListener("pointerup", onPointerUp);
    app.canvas.addEventListener("pointercancel", onPointerUp);
  };
  const unbindPointerEvents = (): void => {
    const app = flow.renderApp;
    if (app === null) return;
    app.canvas.removeEventListener("pointermove", onPointerMove);
    app.canvas.removeEventListener("pointerdown", onPointerDown);
    app.canvas.removeEventListener("pointerup", onPointerUp);
    app.canvas.removeEventListener("pointercancel", onPointerUp);
  };

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
    /** Match started: create adapters + overlays + bind pointer events. */
    matchStart(): void {
      for (const player of flow.localPlayers) ensurePlayer(player);
      bindPointerEvents();
    },
    /** Per-render overlay refresh (stick knob + held buttons). */
    renderTick(): void {
      for (const overlay of touchOverlays.values()) overlay.redraw();
    },
    /** Per-tick sample: last active device wins (touch > mouse > gamepad > keyboard). */
    sample(player: number, tick: number) {
      const kb = keyboards[player] ?? keyboards[0];
      const kf = kb === undefined ? null : kb.sampleFrame(tick);
      const frame: InputFrame = kf === null || kf.player === player
        ? (kf ?? { player, tick, axisX: 0, axisY: 0, launch: false, actions: EMPTY_ACTIONS })
        : { ...kf, player };
      const pad = poll(player);
      const gf = pad.sampleFrame(tick);
      const mouse = mice.get(player);
      const mf = mouse !== undefined ? mouse.sampleFrame(tick) : null;
      const touch = touches.get(player);
      const tf = touch !== undefined ? touch.sampleFrame(tick) : null;
      const pick: InputFrame =
        tf !== null && tf.axisX !== 0 ? tf :
        mf !== null && mf.axisX !== 0 ? mf :
        gf.axisX !== 0 ? gf : frame;
      const edges =
        (tf !== null && (tf.launch || tf.actions.cycleForward)) ||
        (mf !== null && (mf.launch || mf.actions.cycleForward)) ||
        gf.launch || gf.actions.cycleForward ||
        kf?.launch === true || frame.launch;
      if (!edges) return pick.player === player ? pick : { ...pick, player };
      return {
        ...pick,
        player,
        launch: (tf !== null && tf.launch) || (mf !== null && mf.launch) || gf.launch || frame.launch,
        actions: {
          cycleForward: (tf !== null && tf.actions.cycleForward) || (mf !== null && mf.actions.cycleForward) || gf.actions.cycleForward || frame.actions.cycleForward,
          cycleBack: (tf !== null && tf.actions.cycleBack) || (mf !== null && mf.actions.cycleBack) || gf.actions.cycleBack || frame.actions.cycleBack,
          fire: [
            (tf !== null && tf.actions.fire[0]) || (mf !== null && mf.actions.fire[0]) || gf.actions.fire[0] || frame.actions.fire[0],
            (tf !== null && tf.actions.fire[1]) || (mf !== null && mf.actions.fire[1]) || gf.actions.fire[1] || frame.actions.fire[1],
            (tf !== null && tf.actions.fire[2]) || (mf !== null && mf.actions.fire[2]) || gf.actions.fire[2] || frame.actions.fire[2],
            (tf !== null && tf.actions.fire[3]) || (mf !== null && mf.actions.fire[3]) || gf.actions.fire[3] || frame.actions.fire[3],
          ] as [boolean, boolean, boolean, boolean],
        },
      };
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
      unbindPointerEvents();
      for (const overlay of touchOverlays.values()) overlay.container.destroy({ children: true });
      touchOverlays.clear();
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
    // QR links must survive the GH Pages project-site subpath (ticket 55).
    pagePath: globalThis.location.pathname,
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

/**
 * ICE config for a connection attempt (ticket 55): TURN credential Worker
 * when configured, STUN-only otherwise (dev/e2e). Never throws — a failed
 * credential fetch degrades to STUN-only inside fetchIceConfig.
 */
async function iceConfigFor(): Promise<IceConfig | undefined> {
  if (!turnConfigured(deployEnv)) return undefined;
  const resolved = await fetchIceConfig(deployEnv.turnUrl as string, fetch);
  return resolved.turnEnabled ? { iceServers: resolved.iceServers } : undefined;
}

function startHostFlow(code: string): void {
  const guests = new Map<number, GuestEntry>();
  let room: ReturnType<typeof openHostRoom> | null = null;
  let copyPasteScreen: CopyPasteHostScreen | null = null;

  const flow = new MpFlow({
    host: appHost,
    locale,
    connect: async () => {
      try {
        const ice = await iceConfigFor();
        room = openHostRoom({
          code,
          signalingUrl: signalingUrlFor(deployEnv, code, "host", globalThis.location),
          ...(ice !== undefined ? { iceConfig: ice } : {}),
          connectGuest: (guestIndex, conn) => {
            guests.set(guestIndex, { conn });
            wireGuestChannels(flow, guestIndex, conn);
          },
        });
        room.onEvent((ev) => {
          if (ev.type === "host-left") flow.hostGoneFromOutside();
        });
        await room.ready();
      } catch {
        // Spec §9 fallback: signaling unavailable → copy-paste connect.
        // One guest, guest index 0 — the manual exchange is single-peer.
        room = null;
        let answerResolve: (code: string) => void = () => undefined;
        const answerReceived = new Promise<string>((resolve) => {
          answerResolve = resolve;
        });
        const hostFlow = await connectViaCopyPasteHost(answerReceived, await iceConfigFor());
        copyPasteScreen = new CopyPasteHostScreen({
          host: appHost,
          locale,
          offerCode: hostFlow.offerCode,
          onAnswer: answerResolve,
          onCancel: () => { globalThis.location.reload(); },
        });
        const conn = await hostFlow.connection;
        copyPasteScreen.close();
        copyPasteScreen = null;
        guests.set(0, { conn });
        wireGuestChannels(flow, 0, conn);
      }
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
            room?.onEvent((ev) => {
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

  const hostInput = makeLocalInput(flow);
  // Ticket 48: menu/pause edges (Esc / gamepad Start) — polled at render
  // cadence; the flow routes coop pause vs competitive quit-confirm.
  // N2: matchStart wires mouse/touch once fields exist; renderTick
  // refreshes the touch overlays.
  // Phase-driven lobby visibility: the opaque .ld-root overlay must get
  // out of the way when the match mounts (countdown keeps it visible —
  // the 3-2-1 rides its status line) and come back between matches.
  let hostInputStarted = false;
  let hostLobbyShown = true;
  const hostMenuPoll = globalThis.setInterval(() => {
    const phase = flow.currentPhase;
    if (phase === "inGame" && hostLobbyShown) {
      hostLobbyShown = false;
      hostLobbyUI.close();
    } else if (phase === "lobby" && !hostLobbyShown) {
      hostLobbyShown = true;
      hostLobbyUI.reopen();
    }
    if (phase === "inGame" && !hostInputStarted) {
      hostInputStarted = true;
      hostInput.matchStart();
    }
    if (hostInputStarted) hostInput.renderTick();
    if (hostInput.consumeMenuEdge()) flow.localPausePressed();
  }, 100);

  const hostLobbyUI: LobbyScreen = new LobbyScreen({
    host: appHost,
    locale,
    defaultSkinId: settings.appearance.skinId,
    onSettings: () => { openSettingsOverlay(flow); },
    onEvent: (event) => { flow.hostLocalEvent(event); },
    onStart: () => { flow.hostStartMatch(); },
    onQuit: () => {
      globalThis.clearInterval(hostMenuPoll);
      hostInput.dispose();
      hostLobbyUI.close();
      copyPasteScreen?.close();
      room?.close();
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
  let copyPasteScreen: CopyPasteGuestScreen | null = null;

  /** Signaling first; spec §9 fallback = copy-paste when the WS is down. */
  const connectGuest = async (): Promise<RtcConnection> => {
    try {
      return await connectViaSignalingGuest(
        code,
        await iceConfigFor(),
        signalingUrlFor(deployEnv, code, "guest", globalThis.location),
      );
    } catch {
      let offerResolve: (c: string) => void = () => undefined;
      const offerReceived = new Promise<string>((resolve) => {
        offerResolve = resolve;
      });
      const screen = new CopyPasteGuestScreen({
        host: appHost,
        locale,
        answerCode: "", // filled below once the answer exists
        onOffer: offerResolve,
        onCancel: () => { globalThis.location.reload(); },
      });
      copyPasteScreen = screen;
      const offer = await offerReceived;
      const guestFlow = await connectViaCopyPasteGuest(offer, await iceConfigFor());
      // Re-render the screen with the real answer code (same DOM slot).
      copyPasteScreen.close();
      copyPasteScreen = new CopyPasteGuestScreen({
        host: appHost,
        locale,
        answerCode: guestFlow.answerCode,
        onOffer: () => undefined,
        onCancel: () => { globalThis.location.reload(); },
      });
      const conn = await guestFlow.connection;
      copyPasteScreen.close();
      copyPasteScreen = null;
      return conn;
    }
  };

  const flow: MpFlow = new MpFlow({
    host: appHost,
    locale,
    connect: async (): Promise<MpConnectResult> => {
      const conn = await connectGuest();
      return wireGuestConn(flow, conn);
    },
    // Ticket 47: mid-match drop → one rejoin attempt with the same code.
    // Copy-paste sessions have no signaling to rejoin through — null.
    reconnect: async (): Promise<MpConnectResult | null> => {
      try {
        const conn = await connectViaSignalingGuest(
          code,
          await iceConfigFor(),
          signalingUrlFor(deployEnv, code, "guest", globalThis.location),
        );
        return wireGuestConn(flow, conn);
      } catch {
        return null;
      }
    },
    onLobbyState: (state) => { guestLobbyUI.sync(state); },
    sampleLocal: (player, tick) => guestInput.sample(player, tick),
  });

  const guestInput = makeLocalInput(flow);
  // Ticket 48: menu/pause edges — same routing as the host side.
  // N2: same matchStart/renderTick wiring; same phase-driven lobby
  // visibility (close on inGame, reopen on lobby).
  let guestInputStarted = false;
  let guestLobbyShown = true;
  const guestMenuPoll = globalThis.setInterval(() => {
    const phase = flow.currentPhase;
    if (phase === "inGame" && guestLobbyShown) {
      guestLobbyShown = false;
      guestLobbyUI.close();
    } else if (phase === "lobby" && !guestLobbyShown) {
      guestLobbyShown = true;
      guestLobbyUI.reopen();
    }
    if (phase === "inGame" && !guestInputStarted) {
      guestInputStarted = true;
      guestInput.matchStart();
    }
    if (guestInputStarted) guestInput.renderTick();
    if (guestInput.consumeMenuEdge()) flow.localPausePressed();
  }, 100);

  const guestLobbyUI: LobbyScreen = new LobbyScreen({
    host: appHost,
    locale,
    defaultSkinId: settings.appearance.skinId,
    onSettings: () => { openSettingsOverlay(flow); },
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
      copyPasteScreen?.close();
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
