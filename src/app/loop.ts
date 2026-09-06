import { SIM_HZ } from "shared/simRates";

// Fixed-timestep accumulator loop (spec §2, §12): sim at fixed 60 Hz, render at
// rAF cadence. Lives in app/ (not sim/) — timing is wiring, sim stays pure.
export interface AccumulatorLoop {
  start(): void;
  stop(): void;
  /** Test hook: advance wall-clock by ms, running ticks + renders. */
  advance(ms: number): void;
  /** Update the sim time scale (ticket 47 slow-motion, live). */
  setTimeScale(scale: number): void;
  /** True when the last frame hit the catch-up cap (overload signal). */
  readonly lastFrameCapped: boolean;
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
}

export function createAccumulatorLoop(opts: LoopOptions): AccumulatorLoop {
  const tickMs = 1000 / SIM_HZ;
  const maxCatchUp = opts.maxCatchUpTicks ?? 5;
  let timeScale = opts.timeScale ?? 1;
  let cappedThisFrame = false;
  let accumulator = 0;
  let last = 0;
  let initialized = false;
  let tick = 0;
  let running = false;
  let ticksRun = 0;
  let rendersRun = 0;
  let rafHandle = 0;
  let lastAdvanceWall = 0;

  function runTicks(deltaMs: number): void {
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
    while (accumulator >= tickMs - epsilon) {
      opts.tick(tick);
      tick++;
      ticksRun++;
      accumulator -= tickMs;
      if (accumulator < 0) accumulator = 0;
    }
  }

  function frame(now: number): void {
    if (!running) return;
    const delta = Math.min(now - last, 1000);
    last = now;
    runTicks(delta);
    opts.render();
    rendersRun++;
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
      runTicks(delta);
      opts.render();
      rendersRun++;
      last = now;
    },
  };
}
