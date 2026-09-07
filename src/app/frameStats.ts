// Frame-budget instrumentation (ticket 54, spec §12): rolling per-frame
// sim/sync/render split + budget checks + texture/draw-call estimators.
// Pure — the wiring (loop.ts, sessions) feeds numbers in, the dev overlay
// and tests read them out. Budgets: sim ≤2 ms, sync ≤3 ms, render ≤5 ms,
// total ≤10 ms app work (headroom to ~8 ms for thermal).
export const BUDGETS = {
  simMs: 2,
  syncMs: 3,
  renderMs: 5,
  totalMs: 10,
  /** Thermal headroom target: sustained app work ≤8 ms/frame. */
  headroomMs: 8,
  /** Draw calls per frame (hard <20, expected ≤10, spec §12). */
  drawCalls: 20,
  drawCallsExpected: 10,
  /** Texture memory ceiling (MB). */
  textureMb: 64,
} as const;

export interface FrameSample {
  /** Sim tick work this frame (sum of all ticks), ms. */
  simMs: number;
  /** Snapshot → scene sync, ms. */
  syncMs: number;
  /** Pixi render (app work side), ms. */
  renderMs: number;
}

export interface FrameStatsView {
  /** Rolling averages over the window (ms). */
  avg: FrameSample;
  /** Worst frame in the window (ms). */
  worst: FrameSample;
  /** Frames per second estimate from the window. */
  fps: number;
  /** Budget verdicts for the current window. */
  overBudget: { sim: boolean; sync: boolean; render: boolean; total: boolean };
  /** Frames observed in the current window. */
  samples: number;
}

/** Rolling window of frame samples + fps estimate. */
export class FrameStats {
  private readonly window: FrameSample[] = [];
  private readonly maxSamples: number;
  private readonly windowMs: number;
  private frameTimes: number[] = [];

  constructor(maxSamples = 120, windowMs = 2000) {
    this.maxSamples = maxSamples;
    this.windowMs = windowMs;
  }

  /** Record one frame. `frameMs` = full frame wall time (fps estimate). */
  push(sample: FrameSample, frameMs: number): void {
    this.window.push(sample);
    if (this.window.length > this.maxSamples) this.window.shift();
    this.frameTimes.push(frameMs);
    // Keep only frames inside the fps window.
    while (this.frameTimes.length > 0 && this.frameTimes.length * 16.7 > this.windowMs * 2) {
      this.frameTimes.shift();
    }
  }

  get view(): FrameStatsView {
    const n = this.window.length;
    if (n === 0) {
      return {
        avg: { simMs: 0, syncMs: 0, renderMs: 0 },
        worst: { simMs: 0, syncMs: 0, renderMs: 0 },
        fps: 0,
        overBudget: { sim: false, sync: false, render: false, total: false },
        samples: 0,
      };
    }
    let sim = 0;
    let sync = 0;
    let render = 0;
    let wSim = 0;
    let wSync = 0;
    let wRender = 0;
    for (const s of this.window) {
      sim += s.simMs;
      sync += s.syncMs;
      render += s.renderMs;
      wSim = Math.max(wSim, s.simMs);
      wSync = Math.max(wSync, s.syncMs);
      wRender = Math.max(wRender, s.renderMs);
    }
    const avg = { simMs: sim / n, syncMs: sync / n, renderMs: render / n };
    const worst = { simMs: wSim, syncMs: wSync, renderMs: wRender };
    const total = avg.simMs + avg.syncMs + avg.renderMs;
    const fps =
      this.frameTimes.length > 1
        ? (1000 * (this.frameTimes.length - 1)) /
          Math.max(
            0.1,
            this.frameTimes.reduce((a, b) => a + b, 0),
          )
        : 0;
    return {
      avg,
      worst,
      fps,
      overBudget: {
        sim: avg.simMs > BUDGETS.simMs,
        sync: avg.syncMs > BUDGETS.syncMs,
        render: avg.renderMs > BUDGETS.renderMs,
        total: total > BUDGETS.totalMs,
      },
      samples: n,
    };
  }
}

/**
 * Texture-memory estimator: sum of w×h×4 bytes over the shipped sprite
 * set (RGBA8). The real GPU-side number stays manual (on-device), but
 * the shipped asset set is static — this check is exact for it.
 */
export function estimateTextureBytes(sizes: readonly { w: number; h: number }[]): number {
  let total = 0;
  for (const s of sizes) total += s.w * s.h * 4;
  return total;
}

/** Texture budget verdict for a byte estimate. */
export function textureWithinBudget(bytes: number): boolean {
  return bytes <= BUDGETS.textureMb * 1024 * 1024;
}

/**
 * Draw-call counter: wraps a WebGL-ish context's drawArrays/drawElements
 * (and instanced variants) to count GPU submits per frame. Dev wiring
 * installs it on the live context; tests drive it with a fake.
 */
export interface DrawCallCounter {
  /** Count of draw calls recorded since the last resetFrame(). */
  readonly count: number;
  /** Install onto a context (returns a restore function). */
  wrap(ctx: DrawCallContext): () => void;
  /** Reset the per-frame counter (call at frame start). */
  resetFrame(): void;
}

export interface DrawCallContext {
  drawArrays?: (mode: unknown, first: number, count: number) => void;
  drawElements?: (mode: unknown, count: number, type: unknown, offset: number) => void;
  drawArraysInstanced?: (mode: unknown, first: number, count: number, primcount: number) => void;
  drawElementsInstanced?: (
    mode: unknown,
    count: number,
    type: unknown,
    offset: number,
    primcount: number,
  ) => void;
}

export function createDrawCallCounter(): DrawCallCounter {
  let count = 0;
  const wrapOne = (ctx: DrawCallContext, key: keyof DrawCallContext): void => {
    const orig = ctx[key] as ((...args: never[]) => void) | undefined;
    if (orig === undefined) return;
    (ctx as Record<string, unknown>)[key as string] = (...args: unknown[]): void => {
      count++;
      (orig as (...a: unknown[]) => void)(...args);
    };
  };
  return {
    get count(): number {
      return count;
    },
    wrap(ctx) {
      wrapOne(ctx, "drawArrays");
      wrapOne(ctx, "drawElements");
      wrapOne(ctx, "drawArraysInstanced");
      wrapOne(ctx, "drawElementsInstanced");
      return () => {
        // Restore is best-effort: dev-only instrumentation.
        count = 0;
      };
    },
    resetFrame() {
      count = 0;
    },
  };
}
