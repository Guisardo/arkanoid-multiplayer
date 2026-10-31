import {
  BALL_R,
  BRICK_H,
  BRICK_ROWS,
  BRICK_TOP_OFFSET,
  BRICK_W,
  BRICK_COLS,
  CAPSULE_FALL_SPEED,
  CAPSULE_H,
  CAPSULE_W,
  FIELD_H,
  FIELD_W,
  PADDLE_H,
  PADDLE_VMAX,
  PADDLE_W,
  PADDLE_Y,
  POOL_PREWARM,
  TICK_DT,
} from "./constants";
import {
  aabbOverlap,
  clampEdgeAngle,
  offsetDeflect,
  resolveCircleBoxOverlap,
  type Box,
} from "./collision";
import {
  ARMED_EFFECT,
  BRICK_EMPTY,
  BRICK_GOLD,
  brickBreakScore,
  coloredCell,
  isDestructibleCell,
  isGoldCell,
  SIM_EVENT_RING_SIZE,
  type CapsuleTypeId,
  type InputFrame,
  type PaddleEdge,
  type SimEvent,
  type Snapshot,
} from "shared/protocol";
import type { LevelData } from "content/levelFormat";
import { CapsuleScriptRunner, CAPSULE_EFFECTS, EFFECTS_CLEAR_ON_BALL_LOSS } from "./capsules";
import { createBossState, stepBoss, hitBoss, bossBox, type BossState } from "./boss";
import { Pool } from "./pool";
import {
  applyBallInit,
  applyCapsuleInit,
  makeBallState,
  makeCapsuleState,
  resetBallState,
  resetCapsuleState,
  type BallInit,
  type BallState,
  type CapsuleState,
} from "./simState";
import { MULTIBALL_BOOST, ballSpeedFor, decayBoost, registerCeilingHit } from "./ballSpeed";
import { probeBricks } from "./brickProbe";
import { Bolts } from "./bolts";
import {
  ARMED_FLAG,
  PADDLE_SLOT_EFFECTS,
  laserHooks,
  type PaddleSlotEffect,
} from "./laserWiring";

const EVENT_RING_SIZE = SIM_EVENT_RING_SIZE;

/**
 * Ticket 102: cap on the destroyed-brick history behind Attack's brick rain.
 * A continuous Attack match can run for hundreds of rounds, and every break
 * used to append forever — unbounded growth in a long-lived array. Only the
 * most recent entries matter (rain resurrects LIFO), so overflow drops the
 * oldest. Deliberately far above one field's BRICK_COLS × BRICK_ROWS cells so
 * rain can always find the cells it broke.
 */
export const DESTROYED_HISTORY_CAP = 500;
/** Round 33 = Doh boss finale (ticket 49). */
const BOSS_ROUND = 33;

export interface RoundSimOptions {
  lives: number;
  score: number;
  playerName?: string | undefined;
  /** Compact per-session skin index (ticket 44; 0 = default). */
  skinIndex?: number | undefined;
}

export interface RoundSim {
  readonly currentTick: number;
  step(inputs: InputFrame[]): void;
  snapshot(): Snapshot;
  /** Test hook: place the ball. */
  debugSetBall(x: number, y: number, vx: number, vy: number): void;
  /** Test hook: force-drop a capsule. */
  debugDropCapsule(x: number, y: number, type: CapsuleTypeId): void;
  /** Test hook: force all but one ball below the field (no life penalty). */
  debugLoseBallsExcept(keepIndex: number): void;
  /** Attack hook (ticket 39): paddle width factor (shrink 0.6). */
  setAttackWidthFactor(factor: number): void;
  /** Attack hook (ticket 39): ball speed factor (speed-up 1.3). */
  setAttackSpeedFactor(factor: number): void;
  /** Attack hook (ticket 39): resurrect destroyed bricks (rain). Deterministic LIFO. */
  resurrectBricks(count: number): number;
  /** Ticket 102: entries in the capped destroyed-brick history (telemetry). */
  readonly destroyedHistorySize: number;
  /** Assist hook (ticket 40): revive a downed field — 1 life, ball attached. */
  revivePlayer(): void;
  /** Assist hook (ticket 40): remove the n lowest destructible bricks (brick clear). */
  clearLowestBricks(count: number): number;
  /** Assist hook (ticket 40): drop a gifted capsule onto this field. */
  giftCapsule(type: CapsuleTypeId): void;
  /** Assist hook (ticket 40): last capsule type caught on this field (gift payload). */
  lastCaughtCapsule(): CapsuleTypeId | null;
}

/**
 * Headless fixed-timestep (60 Hz) single-field round simulation (spec §2, §5).
 * Consumes Input frames, emits Snapshots. Deterministic: identical input
 * sequences produce identical outcomes. No DOM/Pixi/network ever.
 */
export function createRoundSim(level: LevelData, opts: RoundSimOptions): RoundSim {
  // ---- Static state ----
  const bricks = parseGrid(level.grid, level.silverHitOverride, level.round);
  // Boss round (ticket 49): classic Doh fight = empty arena — the gold
  // frame stays, destructibles are stripped so the ball reaches the boss.
  if (level.round === BOSS_ROUND) {
    for (let i = 0; i < bricks.length; i++) {
      if (isDestructibleCell(bricks[i] ?? BRICK_EMPTY)) bricks[i] = BRICK_EMPTY;
    }
  }
  const baseSpeed = level.baseBallSpeed;

  // ---- Dynamic state ----
  let tick = 0;
  let phase: Snapshot["phase"] = "serve";
  let lives = opts.lives;
  let score = opts.score;
  const balls: BallState[] = [];
  const capsules: CapsuleState[] = [];
  const events: SimEvent[] = [];
  const scriptRunner = new CapsuleScriptRunner(level.capsuleScript);
  let brickBreaks = 0;

  // ADR 0006: pooled balls + capsules. Steady-state play (multiball splits,
  // script drops, ball loss) allocates nothing after prewarm.
  const ballPool = new Pool<BallState>(makeBallState, resetBallState);
  ballPool.prewarm(POOL_PREWARM.balls);
  const capsulePool = new Pool<CapsuleState>(makeCapsuleState, resetCapsuleState);
  capsulePool.prewarm(POOL_PREWARM.capsules);

  function spawnBall(init: BallInit): BallState {
    const b = applyBallInit(ballPool.acquire(), init);
    balls.push(b);
    return b;
  }

  function spawnCapsule(x: number, y: number, type: CapsuleState["type"]): void {
    capsules.push(applyCapsuleInit(capsulePool.acquire(), x, y, type));
  }

  /** Return the ball at `index` to the pool. The caller removes it from `balls`. */
  function releaseBall(b: BallState): void {
    ballPool.release(b);
  }

  function releaseCapsule(c: CapsuleState): void {
    capsulePool.release(c);
  }

  /** Empty the live ball list back into the pool (revive, boss kill, re-serve). */
  function releaseAllBalls(): void {
    while (balls.length > 0) {
      const b = balls.pop();
      if (b !== undefined) ballPool.release(b);
    }
  }

  function releaseAllCapsules(): void {
    while (capsules.length > 0) {
      const c = capsules.pop();
      if (c !== undefined) capsulePool.release(c);
    }
  }

  const paddle: Box & { edge: PaddleEdge } = {
    x: FIELD_W / 2,
    y: PADDLE_Y,
    w: PADDLE_W,
    h: PADDLE_H,
    edge: "bottom",
  };
  /** Active effect timers in ms remaining (classic: cleared on ball loss). */
  const effects = new Map<CapsuleTypeId, number>();
  /** Last capsule type caught (assist gift payload, ticket 40). */
  let lastCaught: CapsuleTypeId | null = null;

  const consumedLaunch = new Set<number>();

  // ---- Doh boss (ticket 49): round 33 only ----
  const boss: BossState | null = level.round === BOSS_ROUND ? createBossState() : null;
  // ---- Laser (ticket #144, spec #140): one Paddle, the shooter is player 0 ----
  // A sim lives one round, so the boss counter starts each round at 0.
  const bolts = new Bolts(1, laserHooks({
    bricks,
    pushEvent,
    hitBrick: (index, shooter) => {
      hitBrick(index, bricks[index] ?? BRICK_EMPTY, shooter);
    },
    liveBoss: () => (boss && !boss.dead ? boss : null),
    damageBoss,
  }));

  // ---- Attack-mode hooks (ticket 39) — inert (1.0) outside Attack ----
  let attackWidthFactor = 1;
  let attackSpeedFactor = 1;
  /** Destroyed-brick indices in break order — rain resurrects from here. */
  const destroyedBricks: number[] = [];

  /**
   * Record a break, keeping the history bounded (ticket 102). Overflow drops
   * the OLDEST entry: rain is LIFO, so the newest breaks are the ones it
   * resurrects next and the old ones are the cheapest to forget. shift() on a
   * 500-entry array is not free, but a break is a rare event next to a 60 Hz
   * tick — correctness and a flat memory ceiling beat micro-optimizing here.
   */
  function pushDestroyed(index: number): void {
    destroyedBricks.push(index);
    if (destroyedBricks.length > DESTROYED_HISTORY_CAP) destroyedBricks.shift();
  }

  function pushEvent(type: SimEvent["type"], source: number, target: number): void {
    events.push({ type, source, target, tick });
    if (events.length > EVENT_RING_SIZE) events.shift();
  }

  function attachBall(player: number): void {
    releaseAllBalls();
    spawnBall({
      x: paddle.x,
      y: paddle.y - paddle.h / 2 - BALL_R,
      attachedTo: player,
      owner: player,
    });
  }

  function brickAt(cx: number, cy: number): { index: number; box: Box } | null {
    const gx = Math.floor(cx / BRICK_W);
    const gy = Math.floor((cy - BRICK_TOP_OFFSET) / BRICK_H);
    if (gx < 0 || gx >= BRICK_COLS || gy < 0 || gy >= BRICK_ROWS) return null;
    const index = gy * BRICK_COLS + gx;
    if ((bricks[index] ?? BRICK_EMPTY) === BRICK_EMPTY) return null;
    return {
      index,
      box: {
        x: gx * BRICK_W + BRICK_W / 2,
        y: BRICK_TOP_OFFSET + gy * BRICK_H + BRICK_H / 2,
        w: BRICK_W,
        h: BRICK_H,
      },
    };
  }

  function destructibleCount(): number {
    let n = 0;
    for (const c of bricks) if (isDestructibleCell(c)) n++;
    return n;
  }

  /** Spec §4: tier bumps at ≤15 and ≤8 bricks remaining (+8% each). */
  function speedFor(bricksLeft: number): number {
    let s = baseSpeed;
    if (bricksLeft <= 15) s *= 1.08;
    if (bricksLeft <= 8) s *= 1.08;
    return s * attackSpeedFactor;
  }

  /** Effective paddle width: base × capsule effects × attack shrink. */
  function paddleWidth(): number {
    let w = PADDLE_W;
    if (effects.has("E")) w *= CAPSULE_EFFECTS.expandFactor;
    if (effects.has("R")) w *= CAPSULE_EFFECTS.reduceFactor;
    return w * attackWidthFactor;
  }

  function stepBall(b: BallState, player: number): void {
    if (b.attachedTo !== null) {
      b.x = paddle.x;
      b.y = paddle.y - paddle.h / 2 - BALL_R;
      return;
    }
    b.x += b.vx * TICK_DT;
    b.y += b.vy * TICK_DT;
    decayBoost(b);

    // walls
    if (b.x - BALL_R < 0) {
      b.x = BALL_R;
      b.vx = Math.abs(b.vx);
    } else if (b.x + BALL_R > FIELD_W) {
      b.x = FIELD_W - BALL_R;
      b.vx = -Math.abs(b.vx);
    }
    if (b.y - BALL_R < 0) {
      b.y = BALL_R;
      b.vy = Math.abs(b.vy);
      // Classic ceiling/back-wall speed-up (ticket 96): the contact counts and
      // each full threshold of contacts buys one more speed tier.
      registerCeilingHit(b);
    }

    // paddle
    if (
      b.vy > 0 &&
      aabbOverlap(b.x, b.y, BALL_R * 2, BALL_R * 2, paddle.x, paddle.y, paddle.w, paddle.h)
    ) {
      const speed = ballSpeedFor(speedFor(destructibleCount()), b);
      const d = offsetDeflect(b.x, speed, paddle, BALL_R);
      const res = resolveCircleBoxOverlap(b.x, b.y, BALL_R, paddle.x, paddle.y, paddle.w, paddle.h);
      b.vx = d.vx;
      b.vy = d.vy;
      if (res) b.y = res.y - BALL_R - 0.01;
      b.owner = player;
      pushEvent("paddleBounce", player, -1);
    }

    // bricks: probe the 3x3 neighbourhood, closest brick first (ticket 98).
    for (const hit of probeBricks(b.x, b.y, brickAt)) {
      const res = resolveCircleBoxOverlap(
        b.x, b.y, BALL_R, hit.box.x, hit.box.y, hit.box.w, hit.box.h,
      );
      if (res === null) continue;
      const hitY = b.y;
      b.x = res.x;
      b.y = res.y;
      const cell = bricks[hit.index] ?? BRICK_EMPTY;
      if (isGoldCell(cell)) {
        bounceOffBox(b, hit.box, res, hitY);
        continue;
      }
      if (isDestructibleCell(cell)) {
        bounceOffBox(b, hit.box, res, hitY);
        hitBrick(hit.index, cell, player);
        return; // one brick per step
      }
    }

    // Doh boss (ticket 49): ball bounces off the boss box; each contact = 1 hit.
    if (boss && !boss.dead) {
      const box = bossBox(boss);
      const res = resolveCircleBoxOverlap(b.x, b.y, BALL_R, box.x, box.y, box.w, box.h);
      if (res !== null) {
        b.x = res.x;
        b.y = res.y;
        // Bounce off the face the ball came from (boss sits above the ball).
        if (b.y > box.y + box.h / 2) b.vy = Math.abs(b.vy);
        else if (b.y < box.y - box.h / 2) b.vy = -Math.abs(b.vy);
        else b.vx = b.x > box.x ? Math.abs(b.vx) : -Math.abs(b.vx);
        damageBoss(player);
      }
    }
  }

  /** The boss loses 1 HP (a ball contact or every 4th Bolt); its death clears the round. */
  function damageBoss(player: number): void {
    if (!boss || boss.dead) return;
    pushEvent("bossHit", player, -1);
    if (hitBoss(boss)) {
      pushEvent("bossDead", player, -1);
      phase = "roundClear";
      pushEvent("roundClear", player, -1);
    }
  }

  function bounceOffBox(b: BallState, box: Box, res: { x: number; y: number }, hitY: number): void {
    // If the circle center's y was inside the box's y-range → resolved horizontally.
    const insideY = Math.abs(hitY - box.y) <= box.h / 2;
    if (insideY) {
      b.vx = res.x > box.x ? Math.abs(b.vx) : -Math.abs(b.vx);
    } else {
      b.vy = res.y > box.y ? Math.abs(b.vy) : -Math.abs(b.vy);
    }
    // Edge-contact clamp for shallow bounces (spec §5).
    const speed = Math.hypot(b.vx, b.vy);
    const cl = clampEdgeAngle(b.vx, b.vy, speed);
    b.vx = cl.vx;
    b.vy = cl.vy;
  }

  function hitBrick(index: number, _cell: number, player: number): void {
    const cellV = bricks[index] ?? BRICK_EMPTY;
    const col = index % BRICK_COLS;
    const row = Math.floor(index / BRICK_COLS);
    const at = { x: col * BRICK_W + BRICK_W / 2, y: BRICK_TOP_OFFSET + row * BRICK_H + BRICK_H / 2 };
    if (cellV > 8 && cellV < 13) {
      // silver: decrement hits remaining
      const hits = cellV - 8;
      if (hits > 1) {
        bricks[index] = 8 + hits - 1;
        pushEvent("brickSilverHit", player, index);
        return;
      }
      bricks[index] = BRICK_EMPTY;
      pushEvent("brickBreak", player, index);
      score += brickBreakScore(cellV); // silver: final break
    } else {
      bricks[index] = BRICK_EMPTY;
      pushEvent("brickBreak", player, index);
      score += brickBreakScore(cellV);
    }
    pushDestroyed(index);
    // Deterministic capsule script trigger (spec §4): zero RNG.
    brickBreaks++;
    const drop = scriptRunner.onBrickBreak(brickBreaks);
    if (drop !== null) {
      spawnCapsule(at.x, at.y, drop);
    }
    // Boss round (49): only the boss's death clears the round — clearing
    // every destructible brick while Doh lives does not (classic Doh fight).
    if (destructibleCount() === 0 && !(boss && !boss.dead)) {
      phase = "roundClear";
      pushEvent("roundClear", player, -1);
    }
  }

  /** Apply a caught capsule's effect (classic-accurate, spec §4). */
  function applyCapsule(type: CapsuleTypeId, player: number): void {
    pushEvent("capsuleCatch", player, -1);
    score += CAPSULE_EFFECTS.capsuleCatchBonus;
    lastCaught = type;
    switch (type) {
      case "E":
      case "C":
      case "L":
        takePaddleSlot(type);
        break;
      case "R":
        effects.set("R", Number.MAX_SAFE_INTEGER);
        refitPaddle();
        break;
      case "P":
        lives++;
        break;
      case "S": {
        // Slow: reset ball speeds to base (tier bumps re-apply on next paddle hit)
        for (const b of balls) {
          const speed = Math.hypot(b.vx, b.vy);
          if (speed > 0) {
            const target = baseSpeed;
            b.vx = (b.vx / speed) * target;
            b.vy = (b.vy / speed) * target;
          }
          b.boostTicks = 0; // classic slow drops the multiball boost too
        }
        effects.set("S", 10_000);
        break;
      }
      case "M": {
        // Multiball: split each in-flight ball to 3 total (classic splits the
        // one ball into 3); only the last ball re-attaches on drop (ball-loss
        // path), others are simply lost. Classic "D" also spawns the extra
        // balls *faster* (ticket 97): the boost rides the children only, for a
        // fixed number of ticks, so it is a window rather than a permanent edge.
        const inFlight = balls.filter((b) => b.attachedTo === null);
        for (const b of inFlight) {
          const speed = Math.hypot(b.vx, b.vy) || baseSpeed;
          const baseAngle = Math.atan2(b.vy, b.vx);
          for (const spread of [Math.PI / 6, -Math.PI / 6]) {
            const a = baseAngle + spread;
            // Boosted at the split, not at the next paddle touch: the speed
            // jump leaving the paddle is the whole reward (ticket #97).
            spawnBall({
              x: b.x, y: b.y,
              vx: Math.cos(a) * speed * MULTIBALL_BOOST.factor,
              vy: Math.sin(a) * speed * MULTIBALL_BOOST.factor,
              attachedTo: null,
              owner: b.owner,
              ceilingHits: b.ceilingHits,
              boostTicks: MULTIBALL_BOOST.ticks,
            });
          }
        }
        if (inFlight.length > 0) pushEvent("multiballBoost", player, -1);
        break;
      }
      case "B": {
        // Break: fly through the exit = round clear, standard clear points,
        // counts as clear in every respect (spec §4). Never on the boss
        // round — Doh must be defeated (ticket 49).
        if (boss && !boss.dead) break;
        phase = "roundClear";
        pushEvent("roundClear", player, -1);
        break;
      }
      case "D":
      case "?":
        // Disrupt timer: effect machinery lands with the modes that need it.
        effects.set(type, CAPSULE_EFFECTS.catchMaxMs);
        break;
    }
  }

  /**
   * E, C and L share one exclusive Paddle slot (spec #140): the catch evicts
   * the other two and the width is recomputed. A repeat L only refreshes,
   * and every L catch readies the Laser at once.
   */
  function takePaddleSlot(type: PaddleSlotEffect): void {
    for (const other of PADDLE_SLOT_EFFECTS) if (other !== type) effects.delete(other);
    switch (type) {
      case "E":
        effects.set("E", Number.MAX_SAFE_INTEGER); // until ball loss
        break;
      case "C":
        effects.set("C", CAPSULE_EFFECTS.catchMaxMs);
        break;
      case "L":
        effects.set(ARMED_EFFECT, ARMED_FLAG); // presence flag: until last ball loss / round clear / revive
        bolts.resetCooldown(0);
        break;
    }
    refitPaddle();
  }

  /** Recompute the Paddle width from its effects and keep it inside the walls. */
  function refitPaddle(): void {
    paddle.w = paddleWidth();
    paddle.x = Math.max(paddle.w / 2, Math.min(FIELD_W - paddle.w / 2, paddle.x));
  }

  function currentPhase(): Snapshot["phase"] {
    return phase;
  }

  /** The Laser ends: disarm and drop every Bolt in flight. */
  function disarmLaser(): void {
    effects.delete(ARMED_EFFECT);
    bolts.clear();
  }

  /** Classic rule: effects clear on ball loss. */
  function clearEffectsOnBallLoss(): void {
    for (const type of EFFECTS_CLEAR_ON_BALL_LOSS) {
      if (effects.has(type)) effects.delete(type);
    }
    disarmLaser();
    refitPaddle();
  }

  function stepCapsules(player: number): void {
    for (let i = capsules.length - 1; i >= 0; i--) {
      const c = capsules[i];
      if (!c) continue;
      c.y += CAPSULE_FALL_SPEED * TICK_DT;
      if (c.y - CAPSULE_H / 2 > FIELD_H) {
        capsules.splice(i, 1);
        releaseCapsule(c);
        continue;
      }
      if (
        aabbOverlap(
          c.x, c.y, CAPSULE_W, CAPSULE_H,
          paddle.x, paddle.y, paddle.w, paddle.h,
        )
      ) {
        capsules.splice(i, 1);
        const caught = c.type;
        releaseCapsule(c);
        applyCapsule(caught, player);
      }
    }
  }

  attachBall(0);

  const sim: RoundSim = {
    get currentTick() {
      return tick;
    },

    debugSetBall(x, y, vx, vy) {
      const b = balls[0];
      if (b) {
        b.x = x;
        b.y = y;
        b.vx = vx;
        b.vy = vy;
        b.attachedTo = null;
      }
    },

    debugDropCapsule(x, y, type) {
      spawnCapsule(x, y, type);
    },

    debugLoseBallsExcept(keepIndex) {
      // Multiball rule test hook: drop every ball except keepIndex with no
      // life penalty (only the LAST ball loss costs a life + re-attaches).
      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        if (b && i !== keepIndex) {
          b.y = FIELD_H + BALL_R + 10;
          b.attachedTo = null;
        }
      }
    },

    setAttackWidthFactor(factor) {
      attackWidthFactor = factor;
      refitPaddle();
    },

    setAttackSpeedFactor(factor) {
      attackSpeedFactor = factor;
    },

    get destroyedHistorySize() {
      return destroyedBricks.length;
    },

    resurrectBricks(count) {
      // Brick rain (ticket 39): refill destroyed cells with tier-1 colored
      // bricks, most-recently-destroyed first — deterministic LIFO order,
      // no RNG (bot-determinism rule). When the destroyed history is
      // exhausted (target never broke bricks), fill the topmost empty
      // cells instead — rain must always add bricks.
      let placed = 0;
      while (placed < count && destroyedBricks.length > 0) {
        const index = destroyedBricks.pop();
        if (index === undefined) break;
        if ((bricks[index] ?? BRICK_EMPTY) !== BRICK_EMPTY) continue;
        bricks[index] = coloredCell(1);
        placed++;
      }
      for (let i = 0; placed < count && i < bricks.length; i++) {
        if ((bricks[i] ?? BRICK_EMPTY) === BRICK_EMPTY) {
          bricks[i] = coloredCell(1);
          placed++;
        }
      }
      return placed;
    },

    revivePlayer() {
      // Assist life gift (ticket 40): revive = 1 life, ball attached,
      // owner launches. The life is created by the spend, never
      // transferred — the giver's own lives are untouched.
      lives = 1;
      phase = "serve";
      releaseAllBalls();
      releaseAllCapsules();
      effects.clear();
      disarmLaser();
      paddle.w = paddleWidth();
      attachBall(0);
    },

    clearLowestBricks(count) {
      // Assist brick clear (ticket 40): remove the n lowest destructible
      // bricks (largest row index first — "lowest" = closest to the
      // paddle). Gold and empty cells are never removed.
      let removed = 0;
      for (let i = bricks.length - 1; i >= 0 && removed < count; i--) {
        const cell = bricks[i] ?? BRICK_EMPTY;
        if (isDestructibleCell(cell)) {
          bricks[i] = BRICK_EMPTY;
          removed++;
        }
      }
      return removed;
    },

    giftCapsule(type) {
      // Assist power-up gift (ticket 40): drop a capsule above the
      // paddle so the teammate can catch it. High enough that it is
      // NOT caught on the drop tick (catch check runs in stepCapsules
      // during the same step that would otherwise splice it instantly).
      spawnCapsule(paddle.x, paddle.y - 40, type);
    },

    lastCaughtCapsule() {
      return lastCaught;
    },

    step(inputs) {
      if (phase === "roundClear" || phase === "gameOver") return;
      let frame: InputFrame | null = null;
      for (const f of inputs) if (f.player === 0) frame = f;

      // paddle: binary/proportional axis × Vmax (spec §5)
      const axis = frame ? Math.max(-1, Math.min(1, frame.axisX)) : 0;
      paddle.x += axis * PADDLE_VMAX * TICK_DT;
      paddle.x = Math.max(paddle.w / 2, Math.min(FIELD_W - paddle.w / 2, paddle.x));

      // serve: attach-and-launch (edge event)
      let launched = false;
      if (frame && frame.launch) {
        const b = balls.find((x) => x.attachedTo !== null);
        if (b && b.attachedTo === 0) {
          const speed = speedFor(destructibleCount());
          b.vx = 0;
          b.vy = -speed;
          b.attachedTo = null;
          phase = "play";
          pushEvent("ballLaunch", 0, -1);
          launched = true;
        }
      }

      // Laser: held primary fires while Armed in play; a launch spends the frame.
      if (frame?.primaryHeld === true && !launched && phase === "play" && effects.has(ARMED_EFFECT)) {
        if (bolts.tryFire(0, 0, paddle)) pushEvent("laserFire", 0, -1);
      }
      // Bolts before balls: a Bolt wins a Brick both reach this tick.
      bolts.step();

      for (const b of [...balls]) stepBall(b, 0);
      stepCapsules(0);

      // Doh boss (ticket 49): advance boss + projectiles; projectile contact
      // kills the paddle — routed through the standard ball-loss path.
      if (boss && !boss.dead) {
        const r = stepBoss(boss, tick, paddle);
        if (r.paddleDied) {
          releaseAllBalls(); // force the ball-loss path below
        }
      }

      // ball loss (multiball-safe): drop lost balls; only when the LAST ball
      // is lost does a life decrement + effects clear + re-serve (spec §5).
      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        if (b && b.attachedTo === null && b.y - BALL_R > FIELD_H) {
          balls.splice(i, 1);
          releaseBall(b);
        }
      }
      if (balls.length === 0) {
        lives--;
        pushEvent("ballLoss", 0, -1);
        clearEffectsOnBallLoss();
        if (lives <= 0) {
          phase = "gameOver";
          pushEvent("gameOver", 0, -1);
        } else {
          phase = "serve";
          attachBall(0);
        }
      }

      // Round clear (last Brick, boss death or B) ends the Laser. Read through
      // a call: TS keeps `phase` narrowed from the early return above.
      if (currentPhase() === "roundClear") disarmLaser();

      tick++;
      consumedLaunch.clear();
    },

    snapshot() {
      return {
        tick,
        phase,
        round: level.round,
        players: [
          {
            player: 0,
            name: opts.playerName ?? "Player 1",
            skinIndex: opts.skinIndex ?? 0,
            paddle: { x: paddle.x, y: paddle.y, w: paddle.w, h: paddle.h, edge: paddle.edge },
            lives,
            score,
            meter: 0,
            target: -1,
            chain: 0,
            state: "playing",
            effects: Object.fromEntries(
              [...effects].map(([k, v]) => [k, v === Number.MAX_SAFE_INTEGER ? -1 : v]),
            ),
            ...(effects.has(ARMED_EFFECT) ? { laserReady: bolts.cooldown(0) === 0 } : {}),
          },
        ],
        balls: balls.map((b) => ({
          x: b.x, y: b.y, vx: b.vx, vy: b.vy,
          attachedTo: b.attachedTo, owner: b.owner,
        })),
        capsules: capsules.map((c) => ({ x: c.x, y: c.y, type: c.type })),
        bolts: bolts.toSnapshot(),
        bricks: [...bricks],
        events: [...events],
        inputAcks: [tick],
        ...(boss
          ? {
              boss: { x: boss.x, y: boss.y, hp: boss.hp, phase: boss.phase, dead: boss.dead },
              bossProjectiles: boss.projectiles.map((p) => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy })),
            }
          : {}),
      };
    },
  };
  return sim;
}

function parseGrid(grid: string[], silverOverride: number | null, round: number): number[] {
  const out = new Array<number>(BRICK_COLS * BRICK_ROWS).fill(BRICK_EMPTY);
  for (let r = 0; r < grid.length && r < BRICK_ROWS; r++) {
    const row = grid[r] ?? "";
    for (let c = 0; c < row.length && c < BRICK_COLS; c++) {
      const ch = row[c];
      if (!ch || ch === ".") continue;
      if (ch === "G") out[r * BRICK_COLS + c] = BRICK_GOLD;
      else if (ch === "S") {
        // Silver hits: min(1 + floor(round/8), 4), per-level override (spec §4).
        const hits = silverHits(silverOverride, round);
        out[r * BRICK_COLS + c] = 8 + hits;
      } else out[r * BRICK_COLS + c] = coloredCell(tierForChar(ch));
    }
  }
  return out;
}

function tierForChar(ch: string): number {
  const code = ch.toLowerCase().charCodeAt(0);
  return 1 + ((code - 97) % 6);
}

function silverHits(override: number | null | undefined, round: number): number {
  if (typeof override === "number") return Math.max(1, Math.min(4, override));
  return Math.min(1 + Math.floor(round / 8), 4);
}
