import type { Application } from "pixi.js";
import type { InputFrame, Snapshot } from "shared/protocol";
import { createAccumulatorLoop, type AccumulatorLoop } from "./loop";
import type { RoundSim } from "sim/roundSim";
import { createRoundSim } from "sim/roundSim";
import { getLevel } from "content/levels";
import { KeyboardAdapter, KEYSET_1, KEYSET_2 } from "input/keyboard";
import { MouseAdapter } from "input/mouse";
import { GamepadAdapter, type GamepadState } from "input/gamepad";
import { TouchAdapter } from "input/touch";
import { TouchOverlay } from "render/touchOverlay";
import { detectDeviceClass } from "app/mobileLayout";
import { createBot, type BotDifficulty } from "sim/bot";
import { FieldView } from "render/fieldView";
import { layoutField } from "render/layout";
import { detectLocale, type Locale } from "ui/strings";
import type { AppShell } from "render/appShell";
import { Storage } from "persistence/storage";
import { loadSettings, effectiveDpr } from "ui/settings";
import { showSettings } from "./settingsRoute";
import type { SettingsScreen } from "ui/settingsScreen";

export interface SoloSessionOptions {
  locale?: Locale;
  lives?: number;
  /** Bot drives player 0 (versus-bots demo path; keyboard ignored for P0). */
  bot?: { difficulty: BotDifficulty; seed: number };
  /** Enable mouse + gamepad input alongside keyboard (default true). */
  enablePointer?: boolean;
}

export interface SoloSession {
  app: Application;
  loop: AccumulatorLoop;
  dispose(): void;
  /** Latest snapshot (for tests/e2e probing). */
  latestSnapshot(): Snapshot;
  /** Open the settings overlay (pauses the loop while open). */
  openSettings(): void;
}

export async function startSoloSession(
  canvasHost: HTMLElement,
  round = 1,
  opts: SoloSessionOptions = {},
): Promise<SoloSession> {
  const { createAppShell } = await import("render/appShell");
  const storage = new Storage();
  const settings = loadSettings(storage);
  const shell: AppShell = await createAppShell(canvasHost, {
    resolution: effectiveDpr(settings.display.dprMode, globalThis.devicePixelRatio || 1),
  });
  const app = shell.app;

  const languages: readonly string[] =
    typeof globalThis.navigator !== "undefined"
      ? globalThis.navigator.languages
      : ["en"];
  const locale: Locale = opts.locale ?? detectLocale(languages);
  const level = getLevel(round);
  const sim: RoundSim = createRoundSim(level, {
    lives: opts.lives ?? 3,
    score: 0,
    playerName: "Player 1",
  });

  const keyboard = KeyboardAdapter.solo();
  const mouse = new MouseAdapter({ player: 0 });
  const gamepad = new GamepadAdapter({ player: 0 });
  const bot = opts.bot ? createBot(0, opts.bot.difficulty, opts.bot.seed) : null;
  const enablePointer = opts.enablePointer ?? true;

  // Touch overlay (ticket 42): touch devices get the virtual stick + cluster.
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
  let touchOverlay: TouchOverlay | null = null;

  // Stored rebinds apply from the start (ticket 41); solo merges both keysets.
  const applyStoredBindings = (): void => {
    const controls = loadSettings(storage).controls;
    const p0 = controls.keyboard[0] ?? KEYSET_1;
    const p1 = controls.keyboard[1] ?? KEYSET_2;
    keyboard.setBindings([p0, p1]);
    gamepad.setBindings(controls.gamepad);
  };
  applyStoredBindings();

  const kd = (e: KeyboardEvent): void => {
    keyboard.keyDown(e.code);
  };
  const ku = (e: KeyboardEvent): void => {
    keyboard.keyUp(e.code);
  };
  globalThis.addEventListener("keydown", kd);
  globalThis.addEventListener("keyup", ku);

  const makeView = (): FieldView =>
    new FieldView({
      layout: layoutField({ x: 0, y: 0, w: app.renderer.width, h: app.renderer.height }),
      player: 0,
      locale,
      maxRound: 33,
      skinId: settings.appearance.skinId,
      themeId: settings.appearance.themeId,
    });

  const firstView = makeView();
  const views: FieldView[] = [firstView];
  app.stage.addChild(firstView.container);

  // Touch overlay floats over the whole canvas, anchored to the field region.
  if (touch !== null) {
    const region = { x: 0, y: 0, w: app.renderer.width, h: app.renderer.height };
    touchOverlay = new TouchOverlay(touch, region, "solo");
    app.stage.addChild(touchOverlay.container);
    const route = (e: PointerEvent, down: boolean): void => {
      const rect = app.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (down) touch.pointerDown(e.pointerId, x, y);
      else touch.pointerMove(e.pointerId, x, y);
    };
    app.canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") route(e, true);
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

  let latest: Snapshot = sim.snapshot();
  let settingsScreen: SettingsScreen | null = null;

  /** Screen px → field units via the current layout scale. */
  const toFieldX = (clientX: number): number => {
    const layout = layoutField({ x: 0, y: 0, w: app.renderer.width, h: app.renderer.height });
    const rect = app.canvas.getBoundingClientRect();
    return (clientX - rect.left - layout.field.x) / layout.scale;
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!enablePointer) return;
    mouse.feedPointer(toFieldX(e.clientX), latest.players[0]?.paddle.x ?? 104);
  };
  const onPointerDown = (e: PointerEvent): void => {
    if (!enablePointer) return;
    if (e.button === 0) mouse.feedClick();
  };
  app.canvas.addEventListener("pointermove", onPointerMove);
  app.canvas.addEventListener("pointerdown", onPointerDown);

  /** Poll gamepads once per rendered frame. */
  function pollGamepads(): void {
    if (!enablePointer) return;
    const pads = navigator.getGamepads();
    const pad = pads.find((p) => p !== null);
    if (!pad) {
      gamepad.reset();
      return;
    }
    const b = (i: number): boolean => pad.buttons[i]?.pressed === true;
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

  const loop = createAccumulatorLoop({
    tick: (tick) => {
      let frame;
      if (bot) {
        frame = bot.sampleFrame(tick, latest);
      } else {
        // Merge devices: last device with non-zero axis or edge wins.
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
        frame = edges
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
      }
      sim.step([frame]);
      latest = sim.snapshot();
    },
    render: () => {
      pollGamepads();
      // Rebound menu key / gamepad Start opens settings (ticket 41).
      // Touch pause icon (ticket 42) — same overlay, same semantics.
      const touchPause = touch !== null && touch.consumePause();
      if ((menuRequested() || touchPause) && !settingsScreen) openSettings();
      touchOverlay?.redraw();
      for (const v of views) v.sync(latest);
    },
  });

  const onResize = (): void => {
    for (const v of views) v.container.destroy({ children: true });
    app.stage.removeChildren();
    const fresh = makeView();
    views.length = 0;
    views.push(fresh);
    app.stage.addChild(fresh.container);
    if (touchOverlay !== null) {
      touchOverlay.setRegion({ x: 0, y: 0, w: app.renderer.width, h: app.renderer.height });
      app.stage.addChild(touchOverlay.container);
    }
  };
  globalThis.addEventListener("resize", onResize);

  // Menu/pause: rebindable menu key (ticket 41) + gamepad Start. Checked in
  // render (not tick) so it works while paused and never races the sim.
  function menuRequested(): boolean {
    return keyboard.consumeMenuEvent() === "pause" || gamepad.consumeMenuEvent() === "pause";
  }

  const onEsc = (e: KeyboardEvent): void => {
    if (e.code === "Escape" && !settingsScreen) {
      e.preventDefault();
      openSettings();
    }
  };
  globalThis.addEventListener("keydown", onEsc);

  function openSettings(): void {
    loop.stop();
    settingsScreen = showSettings(app.canvas.parentElement ?? canvasHost, locale, storage, {
      onClose: () => {
        settingsScreen = null;
        // Rebinds may have changed — re-apply live (ticket 41). Flush stale
        // edges first so rebind keypresses never leak into gameplay frames.
        applyStoredBindings();
        keyboard.flush();
        gamepad.flush();
        loop.start();
      },
    });
  }

  loop.start();

  return {
    app,
    loop,
    latestSnapshot: () => latest,
    openSettings,
    dispose() {
      loop.stop();
      globalThis.removeEventListener("keydown", kd);
      globalThis.removeEventListener("keyup", ku);
      globalThis.removeEventListener("keydown", onEsc);
      globalThis.removeEventListener("resize", onResize);
      app.canvas.removeEventListener("pointermove", onPointerMove);
      app.canvas.removeEventListener("pointerdown", onPointerDown);
      settingsScreen?.close();
      shell.dispose();
    },
  };
}
