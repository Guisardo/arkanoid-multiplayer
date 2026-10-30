import type { InputFrame } from "shared/protocol";
import { EMPTY_ACTIONS } from "shared/protocol";

// Mouse adapter (spec §11): paddle chases the pointer at full speed beyond a
// small dead band — binary ±1/0, max-speed parity with keyboard. Click =
// launch. Wheel unmapped.
export interface MouseAdapterOptions {
  player: number;
  /** Dead band in field units. */
  deadBand?: number;
}

export class MouseAdapter {
  private readonly player: number;
  private readonly deadBand: number;
  private pointerX: number | null = null;
  private paddleX: number | null = null;
  private launchEdge = false;

  constructor(opts: MouseAdapterOptions) {
    this.player = opts.player;
    this.deadBand = opts.deadBand ?? 2;
  }

  /** App feeds pointer + paddle positions in field units each event/frame. */
  feedPointer(pointerFieldX: number, paddleFieldX: number): void {
    this.pointerX = pointerFieldX;
    this.paddleX = paddleFieldX;
  }

  /**
   * Refresh the paddle position every tick. Without this, the pointer chase
   * compares against the paddle position from the last pointermove and keeps
   * emitting ±1 after the paddle has arrived, starving every other device.
   */
  feedPaddle(paddleFieldX: number): void {
    this.paddleX = paddleFieldX;
  }

  /** Drop the chase target; the next pointer move re-arms it. */
  releaseTarget(): void {
    this.pointerX = null;
  }

  feedClick(): void {
    this.launchEdge = true;
  }

  sampleFrame(tick: number): InputFrame {
    let axisX = 0;
    if (this.pointerX !== null && this.paddleX !== null) {
      const diff = this.pointerX - this.paddleX;
      if (Math.abs(diff) > this.deadBand) {
        axisX = diff > 0 ? 1 : -1;
      }
    }
    const frame: InputFrame = {
      player: this.player,
      tick,
      axisX,
      axisY: 0,
      launch: this.launchEdge,
      actions: EMPTY_ACTIONS,
    };
    this.launchEdge = false;
    return frame;
  }
}
