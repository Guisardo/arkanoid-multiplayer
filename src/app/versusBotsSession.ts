// Versus bots app session layer (ticket 56, spec §6.2/§7): consumes the
// sim module (createVersusBotsSession) — human plays, N bots play, all 5
// variants rendered (split-screen for race/attack/parallelAssist, single
// field for duel/sharedField), pause freely (coop semantics), end screens
// per ticket 50 shapes, rematch / back-to-config / quit flow.
import type { Application } from "pixi.js";
import type { InputFrame, Snapshot } from "shared/protocol";
import { createAccumulatorLoop, type AccumulatorLoop } from "./loop";
import { KeyboardAdapter, KEYSET_1, KEYSET_2 } from "input/keyboard";
import { MouseAdapter } from "input/mouse";
import { GamepadAdapter, type GamepadState } from "input/gamepad";
import { TouchAdapter } from "input/touch";
import { TouchOverlay } from "render/touchOverlay";
import { detectDeviceClass } from "app/mobileLayout";
import { SplitScreenView } from "render/splitScreen";
import {
  createVersusBotsSession,
  type BotVariant,
  type VersusBotsEnd,
  type VersusBotsSession as Sim,
} from "sim/versusBots";
import type { BotDifficulty } from "sim/bot";
import { resolveLocale, t, type Locale } from "ui/strings";
import type { AppShell } from "render/appShell";
import { Storage } from "persistence/storage";
import { loadSettings, effectiveDpr } from "ui/settings";
import { showSettings } from "./settingsRoute";
import type { SettingsScreen } from "ui/settingsScreen";
import {
  EndScreen,
  raceStandings,
  attackStandings,
  duelStandings,
  coopOutcome,
  type EndScreenChoice,
  type EndScreenOptions,
} from "ui/endScreens";
import { createPerfLadder, rungForDprMode, type PerfLadder } from "app/perfLadder";
import { FrameStats } from "app/frameStats";
import { PerfOverlay, perfFlagOn } from "app/perfOverlay";
import { createSessionAudio, type SessionAudio } from "audio/sessionAudio";

export interface VersusBotsAppOptions {
  locale?: Locale;
  variant: BotVariant;
  bots: number;
  difficulty: BotDifficulty;
  /** Human's skin UUID (Settings Appearance default). */
  skinId?: string;
  /** Rematch with the same config (fresh session). */
  onRematch?: () => void;
  /** Back to the trimmed config screen. */
  onBackToConfig?: () => void;
  /** Quit to landing. */
  onQuit?: () => void;
}

export interface VersusBotsAppSession {
  app: Application;
  loop: AccumulatorLoop;
  dispose(): void;
  /** Test/e2e probe: rendered field count. */
  readonly fieldCount: number;
  /** Test/e2e probe: current pause state. */
  readonly paused: boolean;
  /** Test/e2e probe: match over + end screen up. */
  readonly matchOver: boolean;
  /** Test/e2e probe: latest snapshots. */
  snapshots(): Snapshot[];
  /** Test probe (assist): force a player downed — drives the lost path. */
  debugSetDowned(player: number): void;
}

export async function startVersusBotsSession(
  canvasHost: HTMLElement,
  opts: VersusBotsAppOptions,
): Promise<VersusBotsAppSession> {
  const { createAppShell } = await import("render/appShell");
  const storage = new Storage();
  const settings = loadSettings(storage);
  const ladder: PerfLadder = createPerfLadder(rungForDprMode(settings.display.dprMode));
  const frameStats = new FrameStats();
  const perfOn = perfFlagOn(globalThis.location.href);

  const languages: readonly string[] =
    typeof globalThis.navigator !== "undefined" ? globalThis.navigator.languages : ["en"];
  const locale: Locale = opts.locale ?? resolveLocale(storage.loadAll().language, languages);

  const shell: AppShell = await createAppShell(canvasHost, {
    resolution: effectiveDpr(settings.display.dprMode, globalThis.devicePixelRatio || 1),
    onContextLost: () => { showContextBanner(t(locale, "perf.contextLost")); },
    onContextRestored: () => {
      split.invalidate();
      showContextBanner(t(locale, "perf.contextRestored"));
    },
  });
  const app = shell.app;

  // Sim (ticket 51): human = player 0, bots = 1..N, D = 0.
  const sim: Sim = createVersusBotsSession({
    variant: opts.variant,
    humans: 1,
    bots: opts.bots,
    difficulty: opts.difficulty,
    humanSkinId: opts.skinId ?? settings.appearance.skinId,
  });

  // Input adapters (soloSession pattern): keyboard + mouse + gamepad + touch.
  const keyboard = KeyboardAdapter.solo();
  const mouse = new MouseAdapter({ player: 0 });
  const gamepad = new GamepadAdapter({ player: 0 });

  const coarse =
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(pointer: coarse)").matches;
  const ua: string =
    typeof globalThis.navigator !== "undefined" ? globalThis.navigator.userAgent : "";
  const device = detectDeviceClass(coarse, ua);
  const touch: TouchAdapter | null = device.touch ? new TouchAdapter({
    player: 0,
    mode: "solo",
    layout: { stick: { x: 80, y: 0 }, buttons: {}, buttonRadius: 24 },
  }) : null;

  const applyStoredBindings = (): void => {
    const controls = loadSettings(storage).controls;
    const p0 = controls.keyboard[0] ?? KEYSET_1;
    const p1 = controls.keyboard[1] ?? KEYSET_2;
    keyboard.setBindings([p0, p1]);
    gamepad.setBindings(controls.gamepad);
  };
  applyStoredBindings();

  // Audio (ticket 30): unlock on first gesture, volumes from Settings.
  const audio: SessionAudio = createSessionAudio(() => new AudioContext());
  audio.setVolumes({
    music: settings.audio.music,
    sfx: settings.audio.sfx,
    mute: settings.audio.mute,
  });
  let audioUnlocked = false;
  const unlockAudio = (): void => {
    if (audioUnlocked) return;
    audioUnlocked = true;
    audio.unlock();
  };

  // Render (mpFlow mountRender pattern): parallel variants (race/attack/
  // parallelAssist) = N fields, 1 player each; single-field variants
  // (duel/sharedField) = 1 field — FieldView renders every player's paddle
  // from the shared snapshot (ticket 56 multi-paddle).
  const parallel = opts.variant === "race" || opts.variant === "attack" || opts.variant === "parallelAssist";
  const viewport = (): { w: number; h: number } => ({
    w: app.renderer.width,
    h: app.renderer.height,
  });
  const fields = parallel
    ? Array.from({ length: sim.playerCount }, (_, i) => i)
    : [0];
  const split = new SplitScreenView({
    viewport: viewport(),
    players: fields,
    locale,
    maxRound: 33,
    skinIds: sim.skinIds(),
    themeId: settings.appearance.themeId,
    reducedEffects: settings.display.reducedEffects,
  });
  app.stage.addChild(split.container);

  // Touch overlay floats over the whole canvas (single-field anchor).
  let touchOverlay: TouchOverlay | null = null;
  if (touch !== null) {
    touchOverlay = new TouchOverlay(touch, { x: 0, y: 0, w: app.renderer.width, h: app.renderer.height }, "solo");
    app.stage.addChild(touchOverlay.container);
  }

  let settingsScreen: SettingsScreen | null = null;
  let pauseMenu: HTMLElement | null = null;
  let endScreen: EndScreen | null = null;
  let paused = false;
  let over = false;

  const quitTo = (choice: EndScreenChoice): void => {
    teardown();
    if (choice === "rematch") opts.onRematch?.();
    else if (choice === "lobby") opts.onBackToConfig?.();
    else opts.onQuit?.();
  };

  /** Pause menu (spec §14: versus bots pauses freely, coop semantics). */
  function buildPauseMenu(): HTMLElement {
    const root = document.createElement("div");
    root.dataset.pauseMenu = "";
    root.style.cssText =
      "position:absolute;inset:0;background:rgba(8,8,16,.92);display:flex;" +
      "align-items:center;justify-content:center;z-index:1000;";
    const panel = document.createElement("div");
    panel.style.cssText =
      "background:#181828;color:#eee;padding:24px 32px;border:2px solid #444;" +
      "min-width:320px;display:flex;flex-direction:column;gap:12px;font-family:monospace;";
    const title = document.createElement("h2");
    title.textContent = t(locale, "pause.soloTitle");
    title.style.cssText = "font-size:20px;font-weight:bold;margin:0 0 8px;text-align:center;";
    panel.appendChild(title);
    const mkBtn = (label: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText =
        "padding:8px 16px;font-family:monospace;min-height:48px;min-width:48px;" +
        "touch-action:manipulation;cursor:pointer;";
      b.addEventListener("click", onClick);
      return b;
    };
    panel.appendChild(mkBtn(t(locale, "menu.resume"), resumeFromPause));
    panel.appendChild(mkBtn(t(locale, "menu.settings"), () => {
      pauseMenu?.remove();
      pauseMenu = null;
      openSettings(true);
    }));
    panel.appendChild(mkBtn(t(locale, "menu.quit"), () => { quitTo("quit"); }));
    root.appendChild(panel);
    return root;
  }

  function openPauseMenu(): void {
    if (paused || over) return;
    paused = true;
    sim.pause();
    loop.stop();
    pauseMenu = buildPauseMenu();
    canvasHost.appendChild(pauseMenu);
  }

  function resumeFromPause(): void {
    if (!paused) return;
    pauseMenu?.remove();
    pauseMenu = null;
    paused = false;
    sim.resume();
    loop.start();
  }

  /** End screen per variant (ticket 50 shapes). */
  function showEnd(): void {
    if (over || endScreen !== null) return;
    const data = sim.endData();
    if (data === null) return;
    over = true;
    loop.stop();
    audio.dispose();
    endScreen = new EndScreen({
      host: canvasHost,
      locale,
      data: endScreenData(data),
      onChoice: (choice) => { quitTo(choice); },
    });
  }

  function endScreenData(data: VersusBotsEnd): EndScreenOptions["data"] {
    const names = ["You", ...Array.from({ length: opts.bots }, (_, i) => `Bot ${String(i + 1)}`)];
    switch (data.kind) {
      case "race":
        return { kind: "competitive", mode: "race", standings: raceStandings(data.state, names) };
      case "attack":
        return { kind: "competitive", mode: "attack", standings: attackStandings(data.state, names) };
      case "duel":
        return {
          kind: "competitive",
          mode: "duel",
          standings: duelStandings(data.result, [names[0] ?? "You", names[1] ?? "Bot 1"]),
        };
      case "sharedField":
        return {
          kind: "coop",
          outcome: {
            cleared: data.cleared,
            teamScore: data.teamScore,
            roundReached: data.round,
            maxRound: 33,
            perPlayer: names.map((name, player) => ({ player, name, bricks: 0, capsules: 0 })),
          },
        };
      case "assist":
        return {
          kind: "coop",
          outcome: coopOutcome(
            data.state,
            names.map((name, player) => ({ player, name, bricks: 0, capsules: 0 })),
            33,
          ),
        };
    }
  }

  /** Screen px → field units via the human's field region. */
  const toFieldX = (clientX: number): number => {
    const region = split.regionOf(0);
    if (region === null) return 0;
    const rect = app.canvas.getBoundingClientRect();
    const scale = region.w / 208;
    return (clientX - rect.left - region.x) / scale;
  };

  const onPointerMove = (e: PointerEvent): void => {
    mouse.feedPointer(toFieldX(e.clientX), 0);
  };
  const onPointerDown = (e: PointerEvent): void => {
    unlockAudio();
    if (e.button === 0) mouse.feedClick();
  };
  app.canvas.addEventListener("pointermove", onPointerMove);
  app.canvas.addEventListener("pointerdown", onPointerDown);

  if (touch !== null) {
    const route = (e: PointerEvent, down: boolean): void => {
      const rect = app.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (down) touch.pointerDown(e.pointerId, x, y);
      else touch.pointerMove(e.pointerId, x, y);
    };
    app.canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") {
        unlockAudio();
        route(e, true);
      }
    });
    app.canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") route(e, false);
    });
    const up = (e: PointerEvent): void => {
      if (e.pointerType === "touch") touch.pointerUp(e.pointerId);
    };
    app.canvas.addEventListener("pointerup", up);
    app.canvas.addEventListener("pointercancel", up);
  }

  /** Poll gamepads once per rendered frame. */
  function pollGamepads(): void {
    const pads = navigator.getGamepads();
    const pad = pads.find((p) => p !== null);
    if (!pad) {
      gamepad.reset();
      return;
    }
    const b = (i: number): boolean => pad.buttons[i]?.pressed === true;
    if (pad.buttons.some((btn) => btn.pressed)) unlockAudio();
    const state: GamepadState = {
      stickX: pad.axes[0] ?? 0,
      stickY: pad.axes[1] ?? 0,
      dpadLeft: b(14),
      dpadRight: b(15),
      buttons: {
        a: b(0), b: b(1), x: b(2), y: b(3),
        lb: b(4), rb: b(5), rt: b(7), lt: b(6),
        start: b(9),
      },
    };
    gamepad.feedState(state);
  }

  const kd = (e: KeyboardEvent): void => {
    unlockAudio();
    keyboard.keyDown(e.code);
  };
  const ku = (e: KeyboardEvent): void => {
    keyboard.keyUp(e.code);
  };
  globalThis.addEventListener("keydown", kd);
  globalThis.addEventListener("keyup", ku);

  function menuRequested(): boolean {
    return keyboard.consumeMenuEvent() === "pause" || gamepad.consumeMenuEvent() === "pause";
  }

  const onEsc = (e: KeyboardEvent): void => {
    if (e.code !== "Escape" || settingsScreen !== null) return;
    e.preventDefault();
    keyboard.consumeMenuEvent();
    gamepad.consumeMenuEvent();
    if (paused) resumeFromPause();
    else if (!over) openPauseMenu();
  };
  globalThis.addEventListener("keydown", onEsc);

  let lastSyncMs = 0;
  const loop = createAccumulatorLoop({
    tick: (tick) => {
      if (paused || over) return;
      // Merge devices (soloSession pattern): last active wins, edges OR.
      const kf = keyboard.sampleFrame(tick);
      const mf = mouse.sampleFrame(tick);
      const gf = gamepad.sampleFrame(tick);
      const tf = touch !== null ? touch.sampleFrame(tick) : null;
      const active =
        (tf !== null && tf.axisX !== 0 ? "touch" : "") ||
        (mf.axisX !== 0 ? "mouse" : "") ||
        (gf.axisX !== 0 ? "gamepad" : "") ||
        (kf.axisX !== 0 ? "keyboard" : "");
      const pick: InputFrame =
        active === "touch" && tf !== null ? tf :
        active === "mouse" ? mf :
        active === "gamepad" ? gf : kf;
      const edges =
        (tf !== null && (tf.launch || tf.actions.cycleForward)) ||
        mf.launch || gf.launch || kf.launch ||
        mf.actions.cycleForward || gf.actions.cycleForward || kf.actions.cycleForward;
      const frame: InputFrame = edges
        ? {
            ...pick,
            launch: (tf !== null && tf.launch) || mf.launch || gf.launch || kf.launch,
            actions: {
              cycleForward: (tf !== null && tf.actions.cycleForward) || mf.actions.cycleForward || gf.actions.cycleForward || kf.actions.cycleForward,
              cycleBack: (tf !== null && tf.actions.cycleBack) || mf.actions.cycleBack || gf.actions.cycleBack || kf.actions.cycleBack,
              fire: [
                (tf !== null && tf.actions.fire[0]) || mf.actions.fire[0] || gf.actions.fire[0] || kf.actions.fire[0],
                (tf !== null && tf.actions.fire[1]) || mf.actions.fire[1] || gf.actions.fire[1] || kf.actions.fire[1],
                (tf !== null && tf.actions.fire[2]) || mf.actions.fire[2] || gf.actions.fire[2] || kf.actions.fire[2],
                (tf !== null && tf.actions.fire[3]) || mf.actions.fire[3] || gf.actions.fire[3] || kf.actions.fire[3],
              ] as [boolean, boolean, boolean, boolean],
            },
          }
        : pick;
      sim.step(frame);
      if (sim.over()) showEnd();
    },
    render: () => {
      pollGamepads();
      const touchPause = touch !== null && touch.consumePause();
      if (paused) {
        keyboard.consumeMenuEvent();
        gamepad.consumeMenuEvent();
      } else if ((menuRequested() || touchPause) && !settingsScreen && !over) {
        openPauseMenu();
      }
      touchOverlay?.redraw();
      const syncStart = performance.now();
      const snaps = sim.snapshots();
      for (const s of snaps) audio.consume(s);
      // Parallel: N snapshots → N fields. Single-field: 1 snapshot (all
      // players) → 1 field — SplitScreenView.sync index-aligns.
      split.sync(snaps);
      lastSyncMs = performance.now() - syncStart;
    },
    onFrameStats: (sample) => {
      frameStats.push(
        { simMs: sample.simMs, syncMs: lastSyncMs, renderMs: sample.renderMs },
        sample.frameMs,
      );
      const appWork = sample.simMs + lastSyncMs + sample.renderMs;
      ladder.observe(appWork);
      if (ladder.changed) applyLadderRung();
      perfOverlay?.update({
        stats: frameStats.view,
        dpr: ladder.rung.dpr,
        renderEvery: ladder.rung.renderEvery,
        drawCalls: null,
        textureMb: null,
      });
    },
  });

  function applyLadderRung(): void {
    const rung = ladder.rung;
    const deviceDpr = globalThis.devicePixelRatio || 1;
    shell.setResolution(Math.min(rung.dpr, effectiveDpr("auto", deviceDpr)));
    loop.setRenderEvery(rung.renderEvery);
    updateDegradedBanner(rung.degraded);
  }

  let degradedBanner: HTMLDivElement | null = null;
  function updateDegradedBanner(degraded: boolean): void {
    if (degraded && degradedBanner === null) {
      degradedBanner = document.createElement("div");
      degradedBanner.dataset.perfDegraded = "";
      degradedBanner.style.cssText =
        "position:absolute;bottom:0;left:0;right:0;z-index:10;" +
        "display:flex;justify-content:center;pointer-events:none;";
      const chip = document.createElement("div");
      chip.style.cssText =
        "background:rgba(8,8,16,0.85);color:#fd4;padding:4px 14px;" +
        "font-family:monospace;font-size:12px;";
      chip.textContent = t(locale, "perf.degraded");
      degradedBanner.appendChild(chip);
      canvasHost.appendChild(degradedBanner);
    } else if (!degraded && degradedBanner !== null) {
      degradedBanner.remove();
      degradedBanner = null;
    }
  }

  let contextBanner: HTMLDivElement | null = null;
  function showContextBanner(message: string): void {
    contextBanner?.remove();
    contextBanner = document.createElement("div");
    contextBanner.dataset.perfContext = "";
    contextBanner.style.cssText =
      "position:absolute;top:0;left:0;right:0;z-index:11;" +
      "display:flex;justify-content:center;pointer-events:none;";
    const chip = document.createElement("div");
    chip.style.cssText =
      "background:rgba(8,8,16,0.85);color:#eee;padding:4px 14px;" +
      "font-family:monospace;font-size:12px;";
    chip.textContent = message;
    contextBanner.appendChild(chip);
    canvasHost.appendChild(contextBanner);
    if (message === t(locale, "perf.contextRestored")) {
      globalThis.setTimeout(() => {
        contextBanner?.remove();
        contextBanner = null;
      }, 2000);
    }
  }

  const perfOverlay = perfOn ? new PerfOverlay(canvasHost) : null;

  const onResize = (): void => {
    split.resize(viewport());
    if (touchOverlay !== null) {
      touchOverlay.setRegion({ x: 0, y: 0, w: app.renderer.width, h: app.renderer.height });
    }
  };
  globalThis.addEventListener("resize", onResize);

  function openSettings(fromPause = false): void {
    loop.stop();
    settingsScreen = showSettings(app.canvas.parentElement ?? canvasHost, locale, storage, {
      ...(fromPause ? { sections: ["audio", "display"] as const } : {}),
      onChange: (audioChanged) => {
        audio.setVolumes({
          music: audioChanged.music,
          sfx: audioChanged.sfx,
          mute: audioChanged.mute,
        });
      },
      onClose: () => {
        settingsScreen = null;
        applyStoredBindings();
        keyboard.flush();
        gamepad.flush();
        const audioSettings = loadSettings(storage).audio;
        audio.setVolumes({
          music: audioSettings.music,
          sfx: audioSettings.sfx,
          mute: audioSettings.mute,
        });
        const display = loadSettings(storage).display;
        ladder.setRung(rungForDprMode(display.dprMode));
        applyLadderRung();
        split.setReducedEffects(display.reducedEffects);
        if (fromPause) {
          pauseMenu = buildPauseMenu();
          canvasHost.appendChild(pauseMenu);
        } else if (!paused && !over) {
          loop.start();
        }
      },
    });
  }

  loop.start();

  function teardown(): void {
    loop.stop();
    audio.dispose();
    globalThis.removeEventListener("keydown", kd);
    globalThis.removeEventListener("keyup", ku);
    globalThis.removeEventListener("keydown", onEsc);
    globalThis.removeEventListener("resize", onResize);
    app.canvas.removeEventListener("pointermove", onPointerMove);
    app.canvas.removeEventListener("pointerdown", onPointerDown);
    settingsScreen?.close();
    pauseMenu?.remove();
    endScreen?.close();
    perfOverlay?.close();
    degradedBanner?.remove();
    contextBanner?.remove();
    shell.dispose();
  }

  return {
    app,
    loop,
    get fieldCount(): number {
      return split.fieldCount;
    },
    get paused(): boolean {
      return paused;
    },
    get matchOver(): boolean {
      return over;
    },
    snapshots(): Snapshot[] {
      return sim.snapshots();
    },
    debugSetDowned(player: number): void {
      sim.debugSetDowned(player);
    },
    dispose: teardown,
  };
}
