import { Application } from "pixi.js";

// Spec §3 renderer config: antialias false, useContextAlpha false, one WebGL
// context per device, webglcontextrestored = resync-from-snapshot (contract stub).
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
}

export async function createAppShell(canvasHost: HTMLElement): Promise<AppShell> {
  const app = new Application();
  await app.init({
    ...RENDERER_CONFIG,
    width: canvasHost.clientWidth,
    height: canvasHost.clientHeight,
    resizeTo: canvasHost,
  });
  canvasHost.appendChild(app.canvas);

  // Resync-from-snapshot contract: on context restore, the renderer must rebuild
  // its scene entirely from the latest Snapshot (never from partial GPU state).
  // Implementation lands with snapshot consumption; stub the handler now.
  app.canvas.addEventListener("webglcontextrestored", () => {
    // TODO(54): resync-from-snapshot on context restore.
  });

  return {
    app,
    dispose() {
      app.destroy(true, { children: true });
    },
  };
}
