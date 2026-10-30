// Progress wire (kind 3, ticket 45 spec §12): parallel-mode guests receive
// only their own fields; remote players' progress-strip rows ride this
// small binary payload at ~5 Hz: [u8 3][u8 count] × {u8 player, u32 score,
// u16 round, u8 lives, u8 state (0 playing / 1 downed / 2 removed)}.

import type { Snapshot } from "shared/protocol";
import type { ProgressRow } from "app/guestGame";

export const PROGRESS_KIND = 3;

export interface ProgressWireRow {
  player: number;
  score: number;
  round: number;
  lives: number;
  state: number;
}

/**
 * Wire rows for every player in `players` that is NOT in `exclude` — the
 * viewer's own players never appear on its strip. Parallel modes carry each
 * player's field in `snapshots[player]`; single-field modes carry everyone in
 * `snapshots[0]`. Players with no snapshot row are skipped.
 */
export function collectProgressRows(
  players: readonly { player: number }[],
  exclude: ReadonlySet<number>,
  snapshots: readonly Snapshot[],
): ProgressWireRow[] {
  const rows: ProgressWireRow[] = [];
  for (const { player } of players) {
    if (exclude.has(player)) continue;
    const snap = snapshots[player] ?? snapshots[0];
    if (snap === undefined) continue;
    // Parallel modes renumber each field's lone player to 0 (multiField
    // remap), so an own-field snapshot's only row is this player's whatever
    // its id; single-field snapshots carry global ids and are matched by id.
    const ownField = snapshots[player] !== undefined && snap.players.length === 1;
    const ps = snap.players.find((x) => x.player === player) ?? (ownField ? snap.players[0] : undefined);
    if (ps === undefined) continue;
    rows.push({
      player,
      score: ps.score,
      round: snap.round,
      lives: ps.lives,
      state: ps.state === "downed" ? 1 : ps.state === "removed" ? 2 : 0,
    });
  }
  return rows;
}

/** Strip row for a wire row: names come from the lobby, by sim index. */
export function wireRowToProgress(
  row: ProgressWireRow,
  names: readonly string[],
  maxRound: number,
): ProgressRow {
  return {
    player: row.player,
    name: names[row.player] ?? `P${String(row.player + 1)}`,
    score: row.score,
    round: row.round,
    maxRound,
    lives: row.lives,
    downed: row.state === 1,
  };
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
