import type { Application } from "pixi.js";
import type { Snapshot } from "shared/protocol";
import { createAccumulatorLoop, type AccumulatorLoop } from "./loop";
import type { RoundSim } from "sim/roundSim";
import { createRoundSim } from "sim/roundSim";
import { getLevel } from "content/levels";
import { KeyboardAdapter } from "input/keyboard";
import { FieldView } from "render/fieldView";
import { layoutField } from "render/layout";
import { detectLocale, type Locale } from "ui/strings";
import type { AppShell } from "render/appShell";

export interface SoloSession {
  app: Application;
  loop: AccumulatorLoop;
  dispose(): void;
  /** Latest snapshot (for tests/e2e probing). */
  latestSnapshot(): Snapshot;
}

export async function startSoloSession(
  canvasHost: HTMLElement,
  round = 1,
  opts: { locale?: Locale; lives?: number } = {},
): Promise<SoloSession> {
  const { createAppShell } = await import("render/appShell");
  const shell: AppShell = await createAppShell(canvasHost);
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
    });

  const firstView = makeView();
  const views: FieldView[] = [firstView];
  app.stage.addChild(firstView.container);

  let latest: Snapshot = sim.snapshot();

  const loop = createAccumulatorLoop({
    tick: (tick) => {
      const frame = keyboard.sampleFrame(tick);
      sim.step([frame]);
      latest = sim.snapshot();
    },
    render: () => {
      for (const v of views) v.sync(latest);
    },
  });

  const onResize = (): void => {
    for (const v of views) v.container.destroy({ children: true });
    app.stage.removeChildren();
    // Rebuild with fresh layout — simple path; perf-safe resize is ticket 54.
    const fresh = makeView();
    views.length = 0;
    views.push(fresh);
    app.stage.addChild(fresh.container);
  };
  globalThis.addEventListener("resize", onResize);

  loop.start();

  return {
    app,
    loop,
    latestSnapshot: () => latest,
    dispose() {
      loop.stop();
      globalThis.removeEventListener("keydown", kd);
      globalThis.removeEventListener("keyup", ku);
      globalThis.removeEventListener("resize", onResize);
      shell.dispose();
    },
  };
}
