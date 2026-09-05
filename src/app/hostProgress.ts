// Progress wire (kind 3, ticket 45 spec §12): parallel-mode guests receive
// only their own fields; remote players' progress-strip rows ride this
// small binary payload at ~5 Hz: [u8 3][u8 count] × {u8 player, u32 score,
// u16 round, u8 lives, u8 state (0 playing / 1 downed / 2 removed)}.

export const PROGRESS_KIND = 3;

export interface ProgressWireRow {
  player: number;
  score: number;
  round: number;
  lives: number;
  state: number;
}

export function packProgress(
  rows: ReadonlyArray<ProgressWireRow>,
): ArrayBuffer {
  const out = new ArrayBuffer(2 + rows.length * 9);
  const view = new DataView(out);
  view.setUint8(0, PROGRESS_KIND);
  view.setUint8(1, rows.length);
  let o = 2;
  for (const r of rows) {
    view.setUint8(o, r.player & 0xff);
    view.setUint32(o + 1, r.score >>> 0, true);
    view.setUint16(o + 5, r.round & 0xffff, true);
    view.setUint8(o + 7, r.lives & 0xff);
    view.setUint8(o + 8, r.state & 0xff);
    o += 9;
  }
  return out;
}

export function unpackProgress(buffer: ArrayBuffer): ProgressWireRow[] {
  if (buffer.byteLength < 2) throw new Error("malformed progress: truncated header");
  const view = new DataView(buffer);
  const kind = view.getUint8(0);
  if (kind !== PROGRESS_KIND) throw new Error("malformed progress: unknown kind");
  const count = view.getUint8(1);
  if (buffer.byteLength < 2 + count * 9) throw new Error("malformed progress: truncated payload");
  const rows: ProgressWireRow[] = [];
  let o = 2;
  for (let i = 0; i < count; i++) {
    rows.push({
      player: view.getUint8(o),
      score: view.getUint32(o + 1, true),
      round: view.getUint16(o + 5, true),
      lives: view.getUint8(o + 7),
      state: view.getUint8(o + 8),
    });
    o += 9;
  }
  return rows;
}
