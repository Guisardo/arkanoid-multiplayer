// App entry (tickets 23/34/43/45/51): boot → landing. Solo goes straight
// to the session; versus bots opens the trimmed config screen; multiplayer
// opens the room-code flow (create: host room + lobby; join: signaling
// guest + lobby) and drives MpFlow over real WebRTC channels.
import { startSoloSession } from "app/soloSession";
import { initAssets } from "render/spriteSheet";
import { startWithGameplayAssets } from "app/gameplayLoad";
import { LandingScreen, RoomCodeScreen, LobbyScreen, codeFromUrl } from "ui/lobbyScreens";
import { VersusBotsConfigScreen, type VersusBotsConfig } from "ui/versusBotsScreen";
import { startVersusBotsSession } from "app/versusBotsSession";
import { resolveLocale, t, DEFAULT_LOCALE, type Locale } from "ui/strings";
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
import { createSaveBackend, Storage } from "persistence/storage";
import { ConflictMergeScreen } from "ui/conflictMerge";
import { isContinuableEpisode, type EpisodeState } from "persistence/saveDocument";
import { ContinueEpisodeScreen } from "ui/continueEpisode";
import { loadSettings } from "ui/settings";
import { showSettings } from "app/settingsRoute";
import { KeyboardAdapter, KEYSET_1, KEYSET_2 } from "input/keyboard";
import { GamepadAdapter, type GamepadState } from "input/gamepad";
import { MouseAdapter } from "input/mouse";
import { TouchAdapter } from "input/touch";
import { bindInputSafety, bindMouseHeld, type MouseHeldTarget } from "input/inputSafety";
import { mergeDeviceFrames } from "input/mergeFrames";
import { TouchOverlay } from "render/touchOverlay";
import { launchGlyphFor } from "render/launchGlyph";
import { detectDeviceClass, touchClusterFor } from "app/mobileLayout";
import { layoutField } from "render/layout";

const appHostElement = document.getElementById("app");
if (appHostElement === null) throw new Error("missing #app host");
const appHost: HTMLElement = appHostElement;

// ADR 0008 §6 / ticket 103: the swappable backend.
//
// The store is module-scope `let` rather than `const` because the backend opens
// asynchronously and this file's browser target does not support top-level
// await. `boot()` awaits it before ANY read — `loadSettings` is synchronous and
// an async backend can only answer a cold sync read from an empty mirror, so
// reading before the await would boot on default settings and then write those
// defaults over the real save. Every read below happens after `boot()` has
// assigned these, which is why the functions using them can stay module-level
// instead of being threaded through the boot result.
let storage: Storage = new Storage();
let settings: ReturnType<typeof loadSettings> | null = null;

// Ticket 103: when two tabs have genuinely diverged (both changed the save
// since they last agreed), neither wins by clock — the player chooses. Only one
// prompt at a time: a second conflict arriving while the first is still open is
// ignored rather than stacked, so the player always answers exactly one
// question. The later divergence is not lost — it is still sitting in the other
// tab's save, so the next write from that side conflicts again and re-prompts.
let conflictScreen: ConflictMergeScreen | null = null;

/** Deploy environment (ticket 55): production reads VITE_SIGNALING_BASE /
 * VITE_TURN_URL at build time; absent (dev/e2e) keeps same-origin
 * signaling + STUN-only ICE. */
const deployEnv: DeployEnv = deployEnvFromVite(import.meta.env);

let locale: Locale = DEFAULT_LOCALE;
let playerName = "Player 1";

/** Watches for a cross-tab divergence once the real store is live. */
function watchForSaveConflicts(): void {
  storage.onConflict((local, remote) => {
    if (conflictScreen !== null) return;
    conflictScreen = new ConflictMergeScreen({
      host: appHost,
      locale,
      local,
      remote,
      onChoice: (side) => {
        const kept = side === "local" ? local : remote;
        // Write the kept side through the normal path so it is stamped, stored
        // atomically, announced to the other tabs, and becomes the new baseline
        // (which is what stops the losing side re-conflicting on the next write).
        storage.writeDocument(kept);
        conflictScreen?.close();
        conflictScreen = null;
      },
    });
  });
}

/** Settings for the active run; `boot` has always assigned it by now. */
function storedSettings(): ReturnType<typeof loadSettings> {
  return settings ?? loadSettings(storage);
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

/**
 * Restart the app flow (quitting a session returns here).
 *
 * Synchronous on purpose: it is handed to `onQuit` callbacks typed as void, and
 * the store is already open by then — re-opening it would only re-await work
 * that is done. The async part of booting happened once, at page load.
 */
function restart(): void {
  showLanding(codeFromUrl(globalThis.location.href));
}

/**
 * Boot: open the save store, then draw the first screen.
 *
 * Async, and the await is load-bearing rather than incidental — everything
 * below reads the save, and the store is not trustworthy until it is hydrated.
 * Nothing that needs the save runs before the await resolves.
 *
 * Never rejects: `createSaveBackend` degrades to the memory backend rather than
 * blocking the game, and this catch is the last line of defence for a throw
 * from anywhere in the boot path, so a store failure cannot leave a blank page.
 */
async function boot(): Promise<void> {
  try {
    const saveBackend = await createSaveBackend();
    storage = saveBackend.storage;
  } catch (err) {
    // Keep the synchronous localStorage store the module started with. The game
    // is playable; only cross-tab sync and IndexedDB are lost.
    console.warn("[main] save backend unavailable; continuing with localStorage", err);
  }

  settings = loadSettings(storage);
  watchForSaveConflicts();
  // Settings override + auto-detect (spec §14): stored language wins.
  locale = resolveLocale(storage.loadAll().language, globalThis.navigator.languages);
  playerName = storage.loadAll().name;

  // Document chrome follows the active locale (spec §14).
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === "es-419" ? "es" : "en";
    document.title = t(locale, "app.title");
  }

  const prefill = codeFromUrl(globalThis.location.href);
  // Ticket 89: a run interrupted by a crash / closed tab is offered as a
  // Continue before the landing screen, because it is the reason the player
  // came back. A record from a finished run is not continuable and never
  // reaches this point.
  const pending = storage.readEpisode();
  if (isContinuableEpisode(pending)) {
    const prompt = new ContinueEpisodeScreen({
      host: appHost,
      locale,
      episode: pending,
      onChoice: (choice) => {
        prompt.close();
        if (choice === "continue") openSolo(pending.round, pending);
        else {
          storage.clearEpisode();
          showLanding(prefill);
        }
      },
    });
    return;
  }
  showLanding(prefill);
}

function showLanding(prefill: string | null): void {
  const landing = new LandingScreen({
    host: appHost,
    locale,
    prefillCode: prefill,
    onSettings: openSettingsOverlay,
    onChoice: (choice, joinCode) => {
      landing.close();
      if (choice === "solo") openSolo(1);
      else if (choice === "versusBots") openVersusBots();
      else openMultiplayer(joinCode ?? undefined);
    },
  });
}

/** Boot the solo session; `continuing` is a record to Continue from (ticket 89). */
function openSolo(round: number, continuing?: EpisodeState): void {
  void initAssets()
    .then(() =>
      // Ticket 87: the gameplay bundle loads here, with a progress screen on a
      // cold first match and none once it is cached.
      startWithGameplayAssets({
        host: appHost,
        locale,
        start: () =>
          startSoloSession(appHost, round, {
            onQuit: restart,
            ...(continuing !== undefined ? { continueEpisode: continuing } : {}),
          }),
      }),
    )
    .then((session) => {
      globalThis.__arkanoid = session;
    });
}

function openVersusBots(): void {
  void initAssets();
  const screen = new VersusBotsConfigScreen({
    host: appHost,
    locale,
    onStart: (config) => {
      screen.root.remove();
      // Ticket 56: real versus match — human plays, bots play. Ticket 87: the
      // deferred gameplay bundle loads first, behind a progress screen.
      void startWithGameplayAssets({
        host: appHost,
        locale,
        start: () => startVersusBots(config),
      }).then((session) => {
        globalThis.__arkanoidBots = session;
      });
    },
    onBack: () => {
      screen.root.remove();
      restart();
    },
  });
}

/** Rematch: same config, fresh session (ticket 56 end-screen flow). */
function openVersusBotsWith(config: VersusBotsConfig): void {
  void initAssets();
  // Ticket 87: a rematch re-enters the match. The bundle is a cache hit in the
  // common case, so no loading screen appears.
  void startWithGameplayAssets({
    host: appHost,
    locale,
    start: () => startVersusBots(config),
  }).then((session) => {
    globalThis.__arkanoidBots = session;
  });
}

/** One versus-bots match from a config (ticket 56 end-screen flow). */
function startVersusBots(config: VersusBotsConfig): ReturnType<typeof startVersusBotsSession> {
  return startVersusBotsSession(appHost, {
    variant: config.variant,
    bots: config.bots,
    difficulty: config.difficulty,
    skinId: storedSettings().appearance.skinId,
    onRematch: () => { openVersusBotsWith(config); },
    onBackToConfig: () => { openVersusBots(); },
    onQuit: restart,
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
  // The page's hydrated store, not a fresh `new Storage()`: a new one would
  // fall back to localStorage and miss anything the active backend holds.
  const controls = loadSettings(storage).controls;
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
  // Ticket #143: held input must never stick. Adapters are created lazily
  // per player, so the device list is read at release time.
  const inputSafety = bindInputSafety(() => [
    ...keyboards,
    ...gamepads.values(),
    ...mice.values(),
    ...touches.values(),
  ]);
  /** Mouse held button fans out like clicks: every local mouse adapter. */
  const allMice: MouseHeldTarget = {
    feedButtons: (buttons) => {
      for (const m of mice.values()) m.feedButtons(buttons);
    },
    releaseHeld: () => {
      for (const m of mice.values()) m.releaseHeld();
    },
  };
  let unbindMouseHeld: (() => void) | null = null;
  let wasBlocked = true;

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
        const overlay = new TouchOverlay(adapter, region, touchClusterFor(flow.currentMode ?? "race"), locale);
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
    // Every matchStart rebinds; drop the previous match's binding first.
    unbindMouseHeld?.();
    unbindMouseHeld = bindMouseHeld(app.canvas, allMice);
  };
  const unbindPointerEvents = (): void => {
    unbindMouseHeld?.();
    unbindMouseHeld = null;
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
      // A rematch may change mode: overlays outlive the match, clusters follow it.
      const cluster = touchClusterFor(flow.currentMode ?? "race");
      for (const overlay of touchOverlays.values()) overlay.setMode(cluster);
      bindPointerEvents();
    },
    /**
     * Release held input when the match stops taking it (pause, quit-confirm,
     * end screen, leaving `inGame`). Polled at the menu cadence; releases on
     * the transition only, so a key pressed while blocked is not re-cleared.
     */
    watchBlocked(): void {
      const blocked = flow.localInputBlocked;
      if (blocked && !wasBlocked) inputSafety.release();
      wasBlocked = blocked;
    },
    /** Per-render overlay refresh (stick knob + held buttons). */
    renderTick(): void {
      for (const [player, overlay] of touchOverlays) {
        // Resize / rotation moves the field region; keep the overlay (and the
        // adapter's hit areas) anchored to it.
        const region = flow.localRegion(player);
        if (region !== null && overlay.regionDiffers(region)) overlay.setRegion(region);
        // Ticket #148: launch triangle while stuck, laser glyph while Armed.
        const snap = flow.localSnapshots().find((s) => s.players.some((p) => p.player === player));
        if (snap !== undefined) overlay.setLaunchGlyph(launchGlyphFor(snap, player));
        overlay.redraw();
      }
    },
    /** Per-tick sample: moving device steers (touch > mouse > gamepad > keyboard); edges and held fire OR. */
    sample(player: number, tick: number) {
      const kb = keyboards[player] ?? keyboards[0];
      const kf = kb === undefined ? null : kb.sampleFrame(tick);
      const pad = poll(player);
      const gf = pad.sampleFrame(tick);
      const touch = touches.get(player);
      const tf = touch !== undefined ? touch.sampleFrame(tick) : null;
      const mouse = mice.get(player);
      if (mouse !== undefined) {
        // Another device taking over cancels the pointer chase, so a stale
        // mouse target cannot override keyboard/gamepad/touch input.
        if ((kf !== null && kf.axisX !== 0) || gf.axisX !== 0 || (tf !== null && tf.axisX !== 0)) {
          mouse.releaseTarget();
        }
        const snap = flow.localSnapshots()[mice.size > 1 ? flow.localPlayers.indexOf(player) : 0];
        const paddleX = snap?.players.find((p) => p.player === player)?.paddle.x;
        if (paddleX !== undefined) mouse.feedPaddle(paddleX);
      }
      const mf = mouse !== undefined ? mouse.sampleFrame(tick) : null;
      return mergeDeviceFrames(player, tick, { touch: tf, mouse: mf, gamepad: gf, keyboard: kf });
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
      inputSafety.unbind();
      unbindPointerEvents();
      for (const overlay of touchOverlays.values()) overlay.container.destroy({ children: true });
      touchOverlays.clear();
    },
  };
}

function openMultiplayer(joinCode?: string): void {
  void initAssets();
  const onBack = (): void => {
    screen.root.remove();
    restart();
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
    storage,
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
    hostInput.watchBlocked();
    if (hostInput.consumeMenuEdge()) flow.localPausePressed();
  }, 100);

  const hostLobbyUI: LobbyScreen = new LobbyScreen({
    host: appHost,
    locale,
    // Ticket 101: the lobby re-shows the join QR (GH Pages subpath preserved).
    pageHost: globalThis.location.host,
    pagePath: globalThis.location.pathname,
    defaultSkinId: storedSettings().appearance.skinId,
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
      restart();
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
    storage,
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
    guestInput.watchBlocked();
    if (guestInput.consumeMenuEdge()) flow.localPausePressed();
  }, 100);

  const guestLobbyUI: LobbyScreen = new LobbyScreen({
    host: appHost,
    locale,
    defaultSkinId: storedSettings().appearance.skinId,
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
      restart();
    },
  });

  void flow.start().then(() => {
    flow.guestHello(playerName, storedSettings().appearance.skinId);
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

// Exported so callers (and tests) can await the point where the first screen
// exists. Boot is now genuinely async — the save store opens before anything is
// drawn — so "the module has loaded" no longer implies "the UI is up".
// Resolves, never rejects: `boot` catches its own backend failure.
export const booted: Promise<void> = boot();
