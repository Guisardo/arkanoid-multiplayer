import { SIM_HZ } from "shared/simRates";

/** Per-frame timing sample the loop emits (sync is session-measured). */
export interface LoopFrameSample {
  /** Measured sim tick work this frame (sum of all ticks), ms. */
  simMs: number;
  /** Measured render callback work, ms. */
  renderMs: number;
  /** Full frame wall time (fps estimate), ms. */
  frameMs: number;
}

// Fixed-timestep accumulator loop (spec §2, §12): sim at fixed 60 Hz, render at
// rAF cadence. Lives in app/ (not sim/) — timing is wiring, sim stays pure.
// Ticket 54: per-frame timing (sim/render split), onFrameStats hook, and
// renderEvery (30 fps degraded rung — sim stays fixed 60 Hz regardless).
export interface AccumulatorLoop {
  start(): void;
  stop(): void;
  /** Test hook: advance wall-clock by ms, running ticks + renders. */
  advance(ms: number): void;
  /** Update the sim time scale (ticket 47 slow-motion, live). */
  setTimeScale(scale: number): void;
  /** True when the last frame hit the catch-up cap (overload signal). */
  readonly lastFrameCapped: boolean;
  /** Render every Nth frame (2 = 30 fps degraded; sim untouched). */
  setRenderEvery(n: number): void;
  readonly ticksRun: number;
  readonly rendersRun: number;
}

export interface LoopOptions {
  /** Called once per sim tick with the tick index. */
  tick(tick: number): void;
  /** Called once per rendered frame. */
  render(): void;
  /** Max catch-up ticks per frame (host overload cap, spec §9). */
  maxCatchUpTicks?: number;
  /**
   * Sim time scale (ticket 47 slow-motion): 1 = full speed; < 1 = the sim
   * advances slower than wall-clock (sustained overload degradation).
   * Render cadence is untouched — only tick accumulation scales.
   */
  timeScale?: number;
  /**
   * Ticket 54: per-frame stats hook. `simMs` = measured tick work this
   * frame; `renderMs` = measured render callback work; `frameMs` = full
   * frame wall time (fps estimate). The sync split is measured by the
   * session (it owns the snapshot→scene call) and merged separately.
   */
  onFrameStats?(sample: LoopFrameSample): void;
}

export function createAccumulatorLoop(opts: LoopOptions): AccumulatorLoop {
  const tickMs = 1000 / SIM_HZ;
  const maxCatchUp = opts.maxCatchUpTicks ?? 5;
  let timeScale = opts.timeScale ?? 1;
  let cappedThisFrame = false;
  let renderEvery = 1;
  let frameIndex = 0;
  let accumulator = 0;
  let last = 0;
  let initialized = false;
  let tick = 0;
  let running = false;
  let ticksRun = 0;
  let rendersRun = 0;
  let rafHandle = 0;
  let lastAdvanceWall = 0;

  function runTicks(deltaMs: number): number {
    // Slow-motion (ticket 47): scale the elapsed time the sim consumes —
    // render cadence untouched, sim falls behind wall-clock deliberately.
    accumulator += deltaMs * timeScale;
    // Catch-up cap: sustained overload → slow-motion, never spiral (spec §9).
    if (accumulator > maxCatchUp * tickMs) {
      accumulator = maxCatchUp * tickMs;
      cappedThisFrame = true;
    } else {
      cappedThisFrame = false;
    }
    // Epsilon guards FP drift: 60 frames × (1000/60) must yield 60 ticks.
    const epsilon = 1e-6;
    const t0 = opts.onFrameStats !== undefined ? performance.now() : 0;
    while (accumulator >= tickMs - epsilon) {
      opts.tick(tick);
      tick++;
      ticksRun++;
      accumulator -= tickMs;
      if (accumulator < 0) accumulator = 0;
    }
    return opts.onFrameStats !== undefined ? performance.now() - t0 : 0;
  }

  function frame(now: number): void {
    if (!running) return;
    const delta = Math.min(now - last, 1000);
    last = now;
    const simMs = runTicks(delta);
    const doRender = renderEvery <= 1 || frameIndex % renderEvery === 0;
    let renderMs = 0;
    if (doRender) {
      const r0 = opts.onFrameStats !== undefined ? performance.now() : 0;
      opts.render();
      rendersRun++;
      renderMs = opts.onFrameStats !== undefined ? performance.now() - r0 : 0;
      frameIndex++;
      if (opts.onFrameStats !== undefined) {
        opts.onFrameStats({ simMs, renderMs, frameMs: delta });
      }
    } else {
      frameIndex++;
    }
    rafHandle = requestAnimationFrame(frame);
  }

  return {
    get ticksRun() {
      return ticksRun;
    },
    get rendersRun() {
      return rendersRun;
    },
    get lastFrameCapped() {
      return cappedThisFrame;
    },
    setTimeScale(scale) {
      timeScale = Math.max(0.1, Math.min(1, scale));
    },
    setRenderEvery(n) {
      renderEvery = Math.max(1, Math.trunc(n));
    },
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      rafHandle = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafHandle);
    },
    advance(ms) {
      // Offline/test mode: no rAF, deterministic wall-clock stepping.
      const now = lastAdvanceWall + ms;
      lastAdvanceWall = now;
      if (!initialized) {
        initialized = true;
        last = now;
        return;
      }
      const delta = Math.min(now - last, 1000);
      const simMs = runTicks(delta);
      const doRender = renderEvery <= 1 || frameIndex % renderEvery === 0;
      let renderMs = 0;
      if (doRender) {
        const r0 = opts.onFrameStats !== undefined ? performance.now() : 0;
        opts.render();
        rendersRun++;
        renderMs = opts.onFrameStats !== undefined ? performance.now() - r0 : 0;
        frameIndex++;
        if (opts.onFrameStats !== undefined) {
          opts.onFrameStats({ simMs, renderMs, frameMs: delta });
        }
      } else {
        frameIndex++;
      }
      last = now;
    },
  };
}
