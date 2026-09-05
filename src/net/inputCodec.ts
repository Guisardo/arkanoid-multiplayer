// Game-channel input codec (spec §9): guests send 60 Hz Input frames with a
// ~10-tick redundancy window — each send carries the newest frame plus recent
// history so one lost datagram never drops input. Binary on the game channel.
//
// Envelope layout (little-endian):
//   u8 kind (1 = input batch)
//   u8 frameCount (1..10)
//   per frame:
//     u8 deviceLocal (0 or 1 — which of the guest device's local players)
//     u32 tick | i8 axisX (-127..127 = -1..1) | i8 axisY | u8 flags
//     (bit0 launch, bit1 cycleForward, bit2 cycleBack, bits3..6 fire slots)
// The host maps deviceLocal → sim player via the guest's player list.
import type { InputFrame } from "shared/protocol";

export const INPUT_BATCH_MAX = 10;
export const INPUT_KIND = 1;
/** Frames whose deviceLocal doesn't match decode to this (single-local guests). */
export const SINGLE_LOCAL = 0;

function axisToI8(v: number): number {
  const clamped = Math.max(-1, Math.min(1, v));
  return Math.round(clamped * 127);
}

function axisFromI8(v: number): number {
  return v / 127;
}

function actionsToFlags(frame: InputFrame): number {
  let flags = 0;
  if (frame.launch) flags |= 0x01;
  if (frame.actions.cycleForward) flags |= 0x02;
  if (frame.actions.cycleBack) flags |= 0x04;
  for (let i = 0; i < 4; i++) {
    if (frame.actions.fire[i] === true) flags |= 1 << (3 + i);
  }
  return flags & 0xff;
}

function flagsToFrame(flags: number): Pick<InputFrame, "launch" | "actions"> {
  const fire: [boolean, boolean, boolean, boolean] = [
    (flags & 0x08) !== 0,
    (flags & 0x10) !== 0,
    (flags & 0x20) !== 0,
    (flags & 0x40) !== 0,
  ];
  return {
    launch: (flags & 0x01) !== 0,
    actions: {
      cycleForward: (flags & 0x02) !== 0,
      cycleBack: (flags & 0x04) !== 0,
      fire,
    },
  };
}

/**
 * Encode a redundancy batch: newest frame last, history before it, oldest
 * first. Frames must share one player index (set by the caller).
 */
export function encodeInputBatch(frames: readonly InputFrame[]): ArrayBuffer {
  if (frames.length === 0) throw new Error("empty input batch");
  if (frames.length > INPUT_BATCH_MAX) {
    throw new Error(`input batch exceeds ${String(INPUT_BATCH_MAX)} frames`);
  }
  const buf = new ArrayBuffer(2 + frames.length * 8);
  const view = new DataView(buf);
  view.setUint8(0, INPUT_KIND);
  view.setUint8(1, frames.length);
  let o = 2;
  for (const f of frames) {
    view.setUint8(o, f.player);
    view.setUint32(o + 1, f.tick >>> 0, true);
    view.setInt8(o + 5, axisToI8(f.axisX));
    view.setInt8(o + 6, axisToI8(f.axisY));
    view.setUint8(o + 7, actionsToFlags(f));
    o += 8;
  }
  return buf;
}

/** Keep the newest `max` frames plus everything newer than `sinceTick`. */
export function redundancyWindow(
  history: readonly InputFrame[],
  max = INPUT_BATCH_MAX,
): InputFrame[] {
  const recent = history.slice(-max);
  return [...recent];
}

/** Decode a batch; throws on malformed payload (host guards + drops). */
export function decodeInputBatch(buffer: ArrayBuffer): InputFrame[] {
  if (buffer.byteLength < 2) throw new Error("malformed input: truncated header");
  const view = new DataView(buffer);
  const kind = view.getUint8(0);
  if (kind !== INPUT_KIND) throw new Error(`malformed input: unknown kind ${String(kind)}`);
  const count = view.getUint8(1);
  if (count === 0 || count > INPUT_BATCH_MAX) {
    throw new Error(`malformed input: bad frame count ${String(count)}`);
  }
  if (buffer.byteLength < 2 + count * 8) {
    throw new Error("malformed input: truncated payload");
  }
  const frames: InputFrame[] = [];
  let o = 2;
  for (let i = 0; i < count; i++) {
    const player = view.getUint8(o);
    const tick = view.getUint32(o + 1, true);
    const axisX = axisFromI8(view.getInt8(o + 5));
    const axisY = axisFromI8(view.getInt8(o + 6));
    const { launch, actions } = flagsToFrame(view.getUint8(o + 7));
    frames.push({ player, tick, axisX, axisY, launch, actions });
    o += 8;
  }
  return frames;
}
