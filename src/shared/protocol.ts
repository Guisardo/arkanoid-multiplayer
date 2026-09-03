// Cross-seam protocol types (spec §2, §9, §11). Leaf module: imports nothing.
// sim/, net/, render/, input/ all import from here — never each other.

// ---- Input frame (the input→sim seam) ----

/** Sim action edge events, buffered max 1 per action per tick (spec §11). */
export interface InputFrameActions {
  cycleForward: boolean;
  cycleBack: boolean;
  fire: readonly [boolean, boolean, boolean, boolean];
}

/** Per-player, per-sim-tick normalized input sample (spec §11). */
export interface InputFrame {
  player: number;
  tick: number;
  /** Move axis, each component in [-1..1]. Keyboard quantizes to -1/0/+1. */
  axisX: number;
  axisY: number;
  /** Launch edge event (serve). */
  launch: boolean;
  actions: InputFrameActions;
}

export const EMPTY_ACTIONS: InputFrameActions = {
  cycleForward: false,
  cycleBack: false,
  fire: [false, false, false, false],
};

// ---- Brick cell encoding (snapshot + serializer + renderer shared) ----

export const BRICK_EMPTY = 0;
/** Colored tier 1..6 (one hit). */
export const BRICK_COLORED_BASE = 0;
/** Silver with n hits remaining: 8 + n, n in 1..4 → 9..12. */
export const BRICK_SILVER_BASE = 8;
export const BRICK_GOLD = 13;
export const SILVER_MAX_HITS = 4;

export function coloredCell(tier: number): number {
  return BRICK_COLORED_BASE + tier;
}
export function silverCell(hitsRemaining: number): number {
  return BRICK_SILVER_BASE + hitsRemaining;
}
export function isEmptyCell(cell: number): boolean {
  return cell === BRICK_EMPTY;
}
export function isDestructibleCell(cell: number): boolean {
  return cell !== BRICK_EMPTY && cell !== BRICK_GOLD;
}
export function cellColoredTier(cell: number): number | null {
  return cell >= 1 && cell <= 6 ? cell : null;
}
export function cellSilverHits(cell: number): number | null {
  return cell >= BRICK_SILVER_BASE + 1 && cell <= BRICK_SILVER_BASE + SILVER_MAX_HITS
    ? cell - BRICK_SILVER_BASE
    : null;
}
export function isGoldCell(cell: number): boolean {
  return cell === BRICK_GOLD;
}

// ---- Snapshot (the sim→render seam) ----

export type PaddleEdge = "bottom" | "left" | "right" | "top";

export interface PaddleSnapshot {
  /** Center coordinates in field units. */
  x: number;
  y: number;
  w: number;
  h: number;
  edge: PaddleEdge;
}

export type PlayerSlotState = "playing" | "downed" | "removed";

export interface PlayerSnapshot {
  player: number;
  name: string;
  /** Compact per-session skin index (byte). */
  skinIndex: number;
  paddle: PaddleSnapshot;
  lives: number;
  score: number;
  meter: number;
  /** Current attack/assist target player index (-1 none). */
  target: number;
  state: PlayerSlotState;
  /** Per-player effect timers (ms remaining), by effect id. */
  effects: Record<string, number>;
}

export interface BallSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Attached (serve) player index, or null when in flight. */
  attachedTo: number | null;
  /** Last paddle toucher (ownership), or null. */
  owner: number | null;
}

export type CapsuleTypeId =
  | "B" | "C" | "D" | "E" | "L" | "M" | "P" | "S" | "R" | "?";

export interface CapsuleSnapshot {
  x: number;
  y: number;
  type: CapsuleTypeId;
}

export type SimEventType =
  | "ballLaunch"
  | "ballLoss"
  | "brickBreak"
  | "brickSilverHit"
  | "capsuleCatch"
  | "roundClear"
  | "gameOver"
  | "attack"
  | "assist"
  | "pause"
  | "resume";

/** Ring buffer event (last 8): type, source, target, tick (spec §9). */
export interface SimEvent {
  type: SimEventType;
  source: number;
  target: number;
  tick: number;
}

export type SimPhase =
  | "serve"
  | "play"
  | "roundClear"
  | "gameOver";

export interface Snapshot {
  tick: number;
  phase: SimPhase;
  round: number;
  players: PlayerSnapshot[];
  balls: BallSnapshot[];
  capsules: CapsuleSnapshot[];
  /** Flat brick grid, row-major, BRICK_COLS * BRICK_ROWS cells. */
  bricks: number[];
  events: SimEvent[];
  /** Per-player last acked input tick (net seam; host fills with current tick). */
  inputAcks: number[];
}
