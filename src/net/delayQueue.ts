// Uniform tick-D delay queue (spec §9): host-local players' frames enter the
// same queue as guest frames — the host skips only the network hop. Dedupes
// by (player, tick); input redundancy window ~10 ticks; out-of-order safe.
import type { InputFrame } from "shared/protocol";

export interface DelayQueueOptions {
  /** Tick delay D. 0 = all-local/coop; 3–5 competitive remote (default 4). */
  delay: number;
}

interface QueuedFrame {
  frame: InputFrame;
  /** Absolute host tick at which the frame becomes consumable. */
  dueTick: number;
}

export interface DelayQueue {
  /** Enqueue a frame for player at frame tick t (due at t + D). */
  push(frame: InputFrame): void;
  /** All frames due at host tick t (deduped, ascending). Empty array OK. */
  due(hostTick: number): InputFrame[];
  /** Number of frames currently queued. */
  readonly size: number;
}

export function createDelayQueue(opts: DelayQueueOptions): DelayQueue {
  const delay = opts.delay;
  let pending: QueuedFrame[] = [];
  // Dedupe: latest frame per (player, tick); older dupes dropped.
  const seen = new Map<string, InputFrame>();
  const key = (player: number, tick: number): string => `${String(player)}:${String(tick)}`;

  return {
    get size() {
      return pending.length;
    },
    push(frame) {
      seen.set(key(frame.player, frame.tick), frame);
      pending.push({ frame, dueTick: frame.tick + delay });
    },
    due(hostTick) {
      const ready: InputFrame[] = [];
      const stillPending: QueuedFrame[] = [];
      // Delivery order: ascending frame tick (stable, deterministic).
      pending.sort((a, b) => a.frame.tick - b.frame.tick);
      const delivered = new Set<string>();
      for (const q of pending) {
        const k = key(q.frame.player, q.frame.tick);
        if (q.dueTick <= hostTick) {
          if (!delivered.has(k)) {
            ready.push(seen.get(k) ?? q.frame);
            delivered.add(k);
          }
        } else {
          stillPending.push(q);
        }
      }
      // Redundancy window: forget seen-entries far behind the host tick.
      const cutoff = hostTick - 16;
      for (const k of [...seen.keys()]) {
        const t = Number(k.split(":")[1]);
        if (t < cutoff) seen.delete(k);
      }
      pending = stillPending;
      return ready;
    },
  };
}
