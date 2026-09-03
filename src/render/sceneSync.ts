// Snapshot → scene sync (spec §2 sim/render seam): render reads Snapshots
// only, never sim internals. Pure sync math unit-testable headless.
import type { Snapshot, PlayerSnapshot, BallSnapshot, CapsuleSnapshot } from "shared/protocol";
import { BRICK_COLS, BRICK_ROWS } from "shared/gridConstants";

/** Brick render model: grid cell contents deduped for batching. */
export interface BrickSpriteInfo {
  index: number;
  col: number;
  row: number;
  cell: number;
}

export interface FieldSceneModel {
  bricks: BrickSpriteInfo[];
  paddle: { x: number; y: number; w: number; h: number };
  balls: Array<{ x: number; y: number; owner: number | null }>;
  capsules: CapsuleSnapshot[];
  hud: {
    name: string;
    skinIndex: number;
    lives: number;
    score: number;
    round: number;
    meter: number;
    target: number;
  };
}

export interface SceneDiff {
  /** Bricks added (cell changed empty→occupied). */
  added: BrickSpriteInfo[];
  /** Bricks removed (cell changed occupied→empty). */
  removed: number[];
  /** Bricks whose cell value changed (silver hit states). */
  changed: BrickSpriteInfo[];
}

/**
 * Diff two brick grids for incremental scene updates. Keep allocations small:
 * sync ≤3 ms budget (spec §12).
 */
export function diffBricks(prev: readonly number[], next: readonly number[]): SceneDiff {
  const added: BrickSpriteInfo[] = [];
  const removed: number[] = [];
  const changed: BrickSpriteInfo[] = [];
  const len = Math.min(prev.length, next.length, BRICK_COLS * BRICK_ROWS);
  for (let i = 0; i < len; i++) {
    const a = prev[i] ?? 0;
    const b = next[i] ?? 0;
    if (a === b) continue;
    const info: BrickSpriteInfo = {
      index: i,
      col: i % BRICK_COLS,
      row: Math.floor(i / BRICK_COLS),
      cell: b,
    };
    if (a === 0 && b !== 0) added.push(info);
    else if (a !== 0 && b === 0) removed.push(i);
    else changed.push(info);
  }
  return { added, removed, changed };
}

/** Extract the flat view model a field renderer needs from a snapshot. */
export function fieldSceneModel(
  snap: Snapshot,
  fieldPlayer: number,
): FieldSceneModel | null {
  const player: PlayerSnapshot | undefined = snap.players.find((p) => p.player === fieldPlayer);
  if (!player) return null;
  const balls: BallSnapshot[] = snap.balls;
  return {
    bricks: [],
    paddle: { ...player.paddle },
    balls: balls.map((b) => ({ x: b.x, y: b.y, owner: b.owner })),
    capsules: snap.capsules.map((c) => ({ ...c })),
    hud: {
      name: player.name,
      skinIndex: player.skinIndex,
      lives: player.lives,
      score: player.score,
      round: snap.round,
      meter: player.meter,
      target: player.target,
    },
  };
}
