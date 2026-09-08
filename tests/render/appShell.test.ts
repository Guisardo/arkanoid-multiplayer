// AppShell tests (ticket 54 coverage): createAppShell wiring — renderer
// config passthrough, resolution option, context-loss/restore listeners,
// setResolution live change, dispose. Pixi Application is mocked (no real
// WebGL in node); the shell's own wiring is the unit under test.
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inits: Record<string, unknown>[] = [];
const destroyed: number[] = [];

function makeFakeCanvas(): HTMLCanvasElement & { listeners: Map<string, Set<(e: Event) => void>> } {
  const c = document.createElement("canvas") as HTMLCanvasElement & {
    listeners: Map<string, Set<(e: Event) => void>>;
  };
  c.listeners = new Map();
  c.addEventListener = ((type: string, cb: (e: Event) => void) => {
    const set = c.listeners.get(type) ?? new Set();
    set.add(cb);
    c.listeners.set(type, set);
  }) as typeof c.addEventListener;
  return c;
}

vi.mock("pixi.js", () => {
  class FakeApp {
    canvas = makeFakeCanvas();
    renderer = { resolution: 1 };
    async init(opts: Record<string, unknown>): Promise<void> {
      inits.push(opts);
      await Promise.resolve();
    }
    destroy(): void {
      destroyed.push(1);
    }
  }
  return { Application: FakeApp };
});

import { createAppShell, RENDERER_CONFIG } from "render/appShell";

describe("createAppShell (ticket 54)", () => {
  beforeEach(() => {
    inits.length = 0;
    destroyed.length = 0;
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("passes the spec renderer config + host size to Application.init", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shell = await createAppShell(host);
    expect(inits.length).toBe(1);
    const init = inits[0]!;
    expect(init.antialias).toBe(false);
    expect(init.useContextAlpha).toBe(false);
    expect(init.preference).toBe("webgl");
    expect(init.resolution).toBe(RENDERER_CONFIG.resolution);
    expect(init.resizeTo).toBe(host);
    expect(host.contains(shell.app.canvas)).toBe(true);
    shell.dispose();
  });

  it("resolution option overrides the default", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shell = await createAppShell(host, { resolution: 1.5 });
    expect(inits[0]!.resolution).toBe(1.5);
    shell.dispose();
  });

  it("setResolution changes renderer.resolution live (Pixi v8 setter)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shell = await createAppShell(host);
    shell.setResolution(1.5);
    expect(shell.app.renderer.resolution).toBe(1.5);
    shell.setResolution(1);
    expect(shell.app.renderer.resolution).toBe(1);
    shell.dispose();
  });

  it("registers context-loss/restore canvas listeners", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shell = await createAppShell(host);
    const canvas = shell.app.canvas as unknown as {
      listeners: Map<string, Set<(e: Event) => void>>;
    };
    expect(canvas.listeners.has("webglcontextlost")).toBe(true);
    expect(canvas.listeners.has("webglcontextrestored")).toBe(true);
    shell.dispose();
  });

  it("context-loss event calls onContextLost and preventDefault", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let lost = 0;
    const shell = await createAppShell(host, {
      onContextLost: () => {
        lost++;
      },
    });
    const canvas = shell.app.canvas as unknown as {
      listeners: Map<string, Set<(e: Event) => void>>;
    };
    let prevented = false;
    const ev = {
      preventDefault: (): void => {
        prevented = true;
      },
    } as unknown as Event;
    for (const cb of canvas.listeners.get("webglcontextlost") ?? []) cb(ev);
    expect(lost).toBe(1);
    expect(prevented).toBe(true); // enables restore
    shell.dispose();
  });

  it("context-restore event calls onContextRestored", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let restored = 0;
    const shell = await createAppShell(host, {
      onContextRestored: () => {
        restored++;
      },
    });
    const canvas = shell.app.canvas as unknown as {
      listeners: Map<string, Set<(e: Event) => void>>;
    };
    for (const cb of canvas.listeners.get("webglcontextrestored") ?? []) {
      cb(new Event("webglcontextrestored"));
    }
    expect(restored).toBe(1);
    shell.dispose();
  });

  it("dispose destroys the app", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shell = await createAppShell(host);
    shell.dispose();
    expect(destroyed.length).toBe(1);
  });

  it("RENDERER_CONFIG locks the spec §3 values", () => {
    expect(RENDERER_CONFIG).toEqual({
      antialias: false,
      useContextAlpha: false,
      resolution: 1,
      // autoDensity true: canvas CSS size stays logical px while the backing
      // store is dpr-scaled — false overflowed every dpr>1 device (55).
      autoDensity: true,
      preference: "webgl",
    });
  });
});
