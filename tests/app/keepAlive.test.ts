// Ticket 47: keep-alive glue — wake lock + background tick + visibility
// pause-and-resync, all injected (browser-free tests).
import { describe, expect, it } from "vitest";
import { createKeepAlive, BACKGROUND_TICK_MS } from "app/keepAlive";

interface KeepAliveTestDeps {
  resyncs: number[];
  requestWakeLock: () => Promise<{ release(): Promise<void> } | null>;
  onVisibilityChange: (cb: (visible: boolean) => void) => () => void;
  setInterval: (ms: number, cb: () => void) => () => void;
  onResync: () => void;
  lastVisibilityCb?: (visible: boolean) => void;
  lastIntervalMs?: number;
  lastIntervalCb?: () => void;
}

function makeDeps(overrides: Partial<KeepAliveTestDeps> = {}): KeepAliveTestDeps {
  const deps: KeepAliveTestDeps = {
    resyncs: [],
    requestWakeLock: (): Promise<{ release(): Promise<void> } | null> =>
      Promise.resolve({ release: (): Promise<void> => Promise.resolve() }),
    onVisibilityChange: (cb: (visible: boolean) => void) => {
      deps.lastVisibilityCb = cb;
      return () => undefined;
    },
    setInterval: (ms: number, cb: () => void) => {
      deps.lastIntervalMs = ms;
      deps.lastIntervalCb = cb;
      return () => undefined;
    },
    onResync: () => {
      deps.resyncs.push(deps.resyncs.length + 1);
    },
    ...overrides,
  };
  return deps;
}

describe("keep-alive (spec §10 host backgrounding)", () => {
  it("start acquires the wake lock + background tick + visibility watch", () => {
    const deps = makeDeps();
    const ka = createKeepAlive(deps);
    ka.start();
    expect(deps.lastIntervalMs).toBe(BACKGROUND_TICK_MS);
    expect(deps.lastVisibilityCb).toBeDefined();
    expect(ka.ticking).toBe(true);
    ka.stop();
  });

  it("wake lock held once granted", async () => {
    const deps = makeDeps();
    const ka = createKeepAlive(deps);
    ka.start();
    // The lock promise resolves async.
    await new Promise((r) => setTimeout(r, 0));
    expect(ka.wakeLockHeld).toBe(true);
    ka.stop();
    expect(ka.wakeLockHeld).toBe(false);
  });

  it("wake-lock denial degrades gracefully (tick still runs)", async () => {
    const deps = makeDeps({ requestWakeLock: (): Promise<null> => Promise.resolve(null) });    const ka = createKeepAlive(deps);
    ka.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(ka.wakeLockHeld).toBe(false);
    expect(ka.ticking).toBe(true);
    ka.stop();
  });

  it("background tick fires the resync hook", () => {
    const deps = makeDeps();
    const ka = createKeepAlive(deps);
    ka.start();
    deps.lastIntervalCb?.();
    expect(deps.resyncs.length).toBe(1);
    ka.stop();
  });

  it("visibility return fires the resync hook (pause-and-resync)", () => {
    const deps = makeDeps();
    const ka = createKeepAlive(deps);
    ka.start();
    deps.lastVisibilityCb?.(true);
    expect(deps.resyncs.length).toBe(1);
    deps.lastVisibilityCb?.(false);
    expect(deps.resyncs.length).toBe(1); // hidden: no resync
    ka.stop();
  });

  it("stop halts the tick", () => {
    const deps = makeDeps();
    const ka = createKeepAlive(deps);
    ka.start();
    ka.stop();
    expect(ka.ticking).toBe(false);
  });
});
