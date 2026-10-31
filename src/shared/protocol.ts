// Cross-seam protocol types (spec §2, §9, §11). Leaf module: imports nothing.
// sim/, net/, render/, input/ all import from here — never each other.

// ---- Wire protocol version (spec §9 version handshake) ----

/** Bump on any incompatible change to the game/control wire format. */
// v2: added the `multiballBoost` SimEvent type (ticket #97). An older build
// cannot decode it — `indexOfOrThrow` rejects unknown event types — so the
// handshake refuses the mixed pair rather than desyncing mid-match.
// v3: Laser plumbing (ticket #141) — input flags bit 7 carries `primaryHeld`;
// snapshots gain a per-player Armed flag and a Bolt tail. A v3 decoder throws
// on a v2 snapshot (no tail) and a v2 host ignores held fire, so the handshake
// refuses the mixed pair.
// v4: Laser feedback events (ticket #148) — `laserFire`, `boltHit` and
// `boltGoldHit`. A v3 decoder rejects the unknown event types.
export const PROTOCOL_VERSION = 4;

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
  /**
   * Held state of the primary action (Space / gamepad A / touch button /
   * click) — level, not edge. Drives the Laser auto-repeat. Distinct from the
   * `actions.fire` attack/assist meter slots.
   */
  primaryHeld: boolean;
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
  /** Current consecutive-brick chain without paddle touch (attack mode). */
  chain: number;
  state: PlayerSlotState;
  /**
   * Per-player effect timers (ms remaining), by effect id. `effects.L`
   * (ARMED_EFFECT) is a presence flag, not a timer: 1 while the Paddle is
   * Armed with the Laser.
   */
  effects: Record<string, number>;
  /**
   * Laser (ticket #148): the Armed Paddle is off cooldown and would fire now.
   * Host-authoritative (sims set it from the Bolt cooldown), so ready-ticks
   * follow the Paddle, not the shooter. Absent when not Armed.
   */
  laserReady?: boolean;
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
  /**
   * Classic "D" multiball spawned faster balls (ticket #97). Separate from
   * `capsuleCatch` so the effects layer can play the boost differently from an
   * ordinary catch — the speed jump *is* the reward.
   */
  | "multiballBoost"
  | "roundClear"
  | "gameOver"
  | "attack"
  | "assist"
  | "pause"
  | "resume"
  | "paddleBounce"
  | "bossHit"
  | "bossDead"
  /** Laser (ticket #148): an Armed Paddle fired a shot; source = shooter. */
  | "laserFire"
  /**
   * A Bolt hit a normal or silver Brick; source = shooter, target = cell.
   * Sims push it immediately before the `brickBreak` / `brickSilverHit` that
   * the same hit produces, so feedback can tell a Bolt hit from a ball hit
   * (see `isBoltBrickEvent`).
   */
  | "boltHit"
  /** A Bolt was spent on a gold Brick (no damage); source = shooter, target = cell. */
  | "boltGoldHit";

/**
 * Sim event ring size (ticket #148; spec §9 had 8). Laser bursts need room:
 * every Bolt hit pushes 2 events and every volley 1, so 4 Armed Paddles can
 * push well past 8 in one tick. Sessions read the whole ring on the host;
 * the wire carries a bounded slice (see `serializeSnapshot`).
 */
export const SIM_EVENT_RING_SIZE = 32;
/** Events every snapshot carries regardless of age (the spec §9 ring). */
export const SNAPSHOT_EVENTS_BASE = 8;
/**
 * Extra events from the last this-many ticks ride along on top of the base
 * 8, so a burst survives a 30 Hz broadcast and a few lost snapshots without
 * paying 32 events on every quiet one.
 */
export const SNAPSHOT_EVENT_BURST_TICKS = 8;

/** Ring buffer event: type, source, target, tick (spec §9). */
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
  /** Doh boss (round 33 only; absent otherwise). */
  boss?: BossSnapshot;
  /** Boss projectiles (round 33 only; absent otherwise). */
  bossProjectiles?: BossProjectileSnapshot[];
  /** Laser Bolts in flight (absent when the sim has no Laser state). */
  bolts?: readonly BoltSnapshot[];
}

/** Laser Bolt in a snapshot (ticket #141): tip position + shooting player. */
export interface BoltSnapshot {
  x: number;
  y: number;
  /** Shooting player index (the Paddle that fired it). */
  owner: number;
}

/**
 * True when `event` is the Brick result of a Bolt hit: a `brickBreak` or
 * `brickSilverHit` directly preceded by the `boltHit` for the same cell and
 * tick (the order sims push them in). Feedback uses it to play the Bolt's
 * quiet hit instead of the ball's.
 */
export function isBoltBrickEvent(
  event: SimEvent,
  prev: SimEvent | undefined,
): event is SimEvent & { type: "brickBreak" | "brickSilverHit" } {
  return (
    prev !== undefined &&
    prev.type === "boltHit" &&
    (event.type === "brickBreak" || event.type === "brickSilverHit") &&
    prev.target === event.target &&
    prev.tick === event.tick
  );
}

/**
 * Visit the ring events newer than `afterTick` in order, each with the ring
 * event just before it (`prev`, for `isBoltBrickEvent` pairing), and return
 * the new watermark. The ring repeats across snapshots, so every consumer
 * (audio, visual effects) keeps a watermark and walks only the fresh suffix.
 */
export function forEachFreshEvent(
  events: readonly SimEvent[],
  afterTick: number,
  visit: (event: SimEvent, prev: SimEvent | undefined) => void,
): number {
  let first = events.length;
  while (first > 0 && (events[first - 1]?.tick ?? -Infinity) > afterTick) first--;
  for (let i = first; i < events.length; i++) {
    const event = events[i];
    if (event !== undefined) visit(event, events[i - 1]);
  }
  // Nothing fresh: the watermark stays where it was.
  return first < events.length ? (events[events.length - 1]?.tick ?? afterTick) : afterTick;
}

/** Bolts spawn this far in from each Paddle end (classic 1986 placement). */
export const LASER_BOLT_INSET = 2;

/** The two Bolt columns for a Paddle centred at `x` with live width `w` (left, right). */
export function laserBoltXs(x: number, w: number): readonly [number, number] {
  const reach = w / 2 - LASER_BOLT_INSET;
  return [x - reach, x + reach];
}

/** Effect id of the Laser's Armed presence flag in `PlayerSnapshot.effects`. */
export const ARMED_EFFECT: CapsuleTypeId = "L";

/** Armed = Laser key present and non-zero (sims may encode "until ball loss" as -1). */
export function isArmedPlayer(p: PlayerSnapshot): boolean {
  return (p.effects[ARMED_EFFECT] ?? 0) !== 0;
}
/** Bolts in flight per shooting Paddle (2 per shot × 4 shots, spec #140). */
export const LASER_BOLTS_PER_PADDLE = 8;
/** Max players per snapshot (serializer bound). */
export const SNAPSHOT_PLAYERS_MAX = 4;

/** Doh boss state in a snapshot (ticket 49). */
export interface BossSnapshot {
  x: number;
  y: number;
  hp: number;
  /** 1 = opening, 2 = final tier. */
  phase: 1 | 2;
  dead: boolean;
}

export interface BossProjectileSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Boss projectile square size in field units (render + sim shared, ticket 49). */
export const BOSS_PROJECTILE_SIZE = 4;
