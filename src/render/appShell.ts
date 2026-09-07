import { Application } from "pixi.js";

// Spec §3 renderer config: antialias false, useContextAlpha false, one WebGL
// context per device, webglcontextrestored = resync-from-snapshot (ticket 54:
// Pixi re-uploads GPU state automatically; the app-level listener lets the
// session invalidate its scene caches and resync from the latest snapshot).
export const RENDERER_CONFIG = {
  antialias: false,
  useContextAlpha: false as const,
  resolution: 1,
  autoDensity: false,
  preference: "webgl" as const,
};

export interface AppShell {
  app: Application;
  dispose(): void;
  /**
   * Ticket 54: live renderer resolution change (dpr ladder). Pixi v8
   * supports runtime `renderer.resolution = n` — it resizes the backing
   * store and emits resolutionChange; textures are untouched.
   */
  setResolution(dpr: number): void;
}

export interface AppShellOptions {
  /** Resolution override (dpr mode from Settings; default 1). */
  resolution?: number;
  /** Context-loss callback (app pauses + shows a banner). */
  onContextLost?: () => void;
  /** Context-restore callback (app invalidates caches + resyncs). */
  onContextRestored?: () => void;
}

export async function createAppShell(
  canvasHost: HTMLElement,
  opts: AppShellOptions = {},
): Promise<AppShell> {
  const app = new Application();
  await app.init({
    ...RENDERER_CONFIG,
    width: canvasHost.clientWidth,
    height: canvasHost.clientHeight,
    resizeTo: canvasHost,
    resolution: opts.resolution ?? RENDERER_CONFIG.resolution,
  });
  canvasHost.appendChild(app.canvas);

  // Context loss/restore are native canvas DOM events (Pixi handles GPU
  // re-upload itself; these listeners drive the app-level resync contract).
  app.canvas.addEventListener("webglcontextlost", (e: Event) => {
    e.preventDefault(); // enable restore
    opts.onContextLost?.();
  });
  app.canvas.addEventListener("webglcontextrestored", () => {
    opts.onContextRestored?.();
  });

  return {
    app,
    setResolution(dpr: number): void {
      // Runtime resolution change (Pixi v8: setter resizes the backing
      // store + emits resolutionChange; asset textures keep own _resolution).
      app.renderer.resolution = dpr;
    },
    dispose() {
      app.destroy(true, { children: true });
    },
  };
}
