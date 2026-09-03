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
  BRICK_EMPTY,
  BRICK_GOLD,
  coloredCell,
  isDestructibleCell,
  isGoldCell,
  type CapsuleTypeId,
  type InputFrame,
  type PaddleEdge,
  type SimEvent,
  type Snapshot,
} from "shared/protocol";
import type { LevelData } from "content/levelFormat";
import { CapsuleScriptRunner, CAPSULE_EFFECTS, EFFECTS_CLEAR_ON_BALL_LOSS } from "./capsules";

const EVENT_RING_SIZE = 8;

interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  attachedTo: number | null;
  owner: number | null;
}

interface CapsuleState {
  x: number;
  y: number;
  type: LevelData["capsuleScript"][number]["capsule"];
}

export interface RoundSimOptions {
  lives: number;
  score: number;
  playerName?: string;
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
}

/**
 * Headless fixed-timestep (60 Hz) single-field round simulation (spec §2, §5).
 * Consumes Input frames, emits Snapshots. Deterministic: identical input
 * sequences produce identical outcomes. No DOM/Pixi/network ever.
 */
export function createRoundSim(level: LevelData, opts: RoundSimOptions): RoundSim {
  // ---- Static state ----
  const bricks = parseGrid(level.grid, level.silverHitOverride, level.round);
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

  const paddle: Box & { edge: PaddleEdge } = {
    x: FIELD_W / 2,
    y: PADDLE_Y,
    w: PADDLE_W,
    h: PADDLE_H,
    edge: "bottom",
  };
  /** Active effect timers in ms remaining (classic: cleared on ball loss). */
  const effects = new Map<CapsuleTypeId, number>();

  const consumedLaunch = new Set<number>();

  function pushEvent(type: SimEvent["type"], source: number, target: number): void {
    events.push({ type, source, target, tick });
    if (events.length > EVENT_RING_SIZE) events.shift();
  }

  function attachBall(player: number): void {
    balls.length = 0;
    balls.push({
      x: paddle.x,
      y: paddle.y - paddle.h / 2 - BALL_R,
      vx: 0,
      vy: 0,
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
    return s;
  }

  function stepBall(b: BallState, player: number): void {
    if (b.attachedTo !== null) {
      b.x = paddle.x;
      b.y = paddle.y - paddle.h / 2 - BALL_R;
      return;
    }
    b.x += b.vx * TICK_DT;
    b.y += b.vy * TICK_DT;

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
    }

    // paddle
    if (
      b.vy > 0 &&
      aabbOverlap(b.x, b.y, BALL_R * 2, BALL_R * 2, paddle.x, paddle.y, paddle.w, paddle.h)
    ) {
      const speed = speedFor(destructibleCount());
      const d = offsetDeflect(b.x, speed, paddle, BALL_R);
      const res = resolveCircleBoxOverlap(b.x, b.y, BALL_R, paddle.x, paddle.y, paddle.w, paddle.h);
      b.vx = d.vx;
      b.vy = d.vy;
      if (res) b.y = res.y - BALL_R - 0.01;
      b.owner = player;
    }

    // bricks: probe cells around the ball
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const hit = brickAt(b.x + dx * BRICK_W * 0.5, b.y + dy * BRICK_H * 0.5);
        if (!hit) continue;
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
      score += 50; // silver pays per hit (final break here)
    } else {
      bricks[index] = BRICK_EMPTY;
      pushEvent("brickBreak", player, index);
      score += 50 + (cellV - 1) * 10; // colored tier scoring (placeholder table)
    }
    // Deterministic capsule script trigger (spec §4): zero RNG.
    brickBreaks++;
    const drop = scriptRunner.onBrickBreak(brickBreaks);
    if (drop !== null) {
      capsules.push({ x: at.x, y: at.y, type: drop });
    }
    if (destructibleCount() === 0) {
      phase = "roundClear";
      pushEvent("roundClear", player, -1);
    }
  }

  /** Apply a caught capsule's effect (classic-accurate, spec §4). */
  function applyCapsule(type: CapsuleTypeId, player: number): void {
    pushEvent("capsuleCatch", player, -1);
    score += CAPSULE_EFFECTS.capsuleCatchBonus;
    switch (type) {
      case "E":
        paddle.w = PADDLE_W * CAPSULE_EFFECTS.expandFactor;
        effects.set("E", Number.MAX_SAFE_INTEGER); // until ball loss
        break;
      case "R":
        paddle.w = PADDLE_W * CAPSULE_EFFECTS.reduceFactor;
        effects.set("R", Number.MAX_SAFE_INTEGER);
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
        }
        effects.set("S", 10_000);
        break;
      }
      case "M": {
        // Multiball: split each in-flight ball to 3 total (classic splits the
        // one ball into 3); only the last ball re-attaches on drop (ball-loss
        // path), others are simply lost.
        const inFlight = balls.filter((b) => b.attachedTo === null);
        for (const b of inFlight) {
          const speed = Math.hypot(b.vx, b.vy) || baseSpeed;
          const baseAngle = Math.atan2(b.vy, b.vx);
          for (const spread of [Math.PI / 6, -Math.PI / 6]) {
            const a = baseAngle + spread;
            balls.push({
              x: b.x, y: b.y,
              vx: Math.cos(a) * speed,
              vy: Math.sin(a) * speed,
              attachedTo: null,
              owner: b.owner,
            });
          }
        }
        break;
      }
      case "B": {
        // Break: fly through the exit = round clear, standard clear points,
        // counts as clear in every respect (spec §4).
        phase = "roundClear";
        pushEvent("roundClear", player, -1);
        break;
      }
      case "C":
      case "L":
      case "D":
      case "?":
        // Catch/Laser/Disrupt timers: effect machinery lands with modes that
        // need them (laser rendering, catch hold); durations tracked now.
        effects.set(type, CAPSULE_EFFECTS.catchMaxMs);
        break;
    }
  }

  /** Classic rule: effects clear on ball loss. */
  function clearEffectsOnBallLoss(): void {
    for (const type of EFFECTS_CLEAR_ON_BALL_LOSS) {
      if (effects.has(type)) effects.delete(type);
    }
    paddle.w = PADDLE_W;
    paddle.x = Math.max(paddle.w / 2, Math.min(FIELD_W - paddle.w / 2, paddle.x));
  }

  function stepCapsules(player: number): void {
    for (let i = capsules.length - 1; i >= 0; i--) {
      const c = capsules[i];
      if (!c) continue;
      c.y += CAPSULE_FALL_SPEED * TICK_DT;
      if (c.y - CAPSULE_H / 2 > FIELD_H) {
        capsules.splice(i, 1);
        continue;
      }
      if (
        aabbOverlap(
          c.x, c.y, CAPSULE_W, CAPSULE_H,
          paddle.x, paddle.y, paddle.w, paddle.h,
        )
      ) {
        capsules.splice(i, 1);
        applyCapsule(c.type, player);
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
      capsules.push({ x, y, type });
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

    step(inputs) {
      if (phase === "roundClear" || phase === "gameOver") return;
      let frame: InputFrame | null = null;
      for (const f of inputs) if (f.player === 0) frame = f;

      // paddle: binary/proportional axis × Vmax (spec §5)
      const axis = frame ? Math.max(-1, Math.min(1, frame.axisX)) : 0;
      paddle.x += axis * PADDLE_VMAX * TICK_DT;
      paddle.x = Math.max(paddle.w / 2, Math.min(FIELD_W - paddle.w / 2, paddle.x));

      // serve: attach-and-launch (edge event)
      if (frame && frame.launch) {
        const b = balls.find((x) => x.attachedTo !== null);
        if (b && b.attachedTo === 0) {
          const speed = speedFor(destructibleCount());
          b.vx = 0;
          b.vy = -speed;
          b.attachedTo = null;
          phase = "play";
          pushEvent("ballLaunch", 0, -1);
        }
      }

      for (const b of [...balls]) stepBall(b, 0);
      stepCapsules(0);

      // ball loss (multiball-safe): drop lost balls; only when the LAST ball
      // is lost does a life decrement + effects clear + re-serve (spec §5).
      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        if (b && b.attachedTo === null && b.y - BALL_R > FIELD_H) {
          balls.splice(i, 1);
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
            skinIndex: 0,
            paddle: { x: paddle.x, y: paddle.y, w: paddle.w, h: paddle.h, edge: paddle.edge },
            lives,
            score,
            meter: 0,
            target: -1,
            state: "playing",
            effects: Object.fromEntries(
              [...effects].map(([k, v]) => [k, v === Number.MAX_SAFE_INTEGER ? -1 : v]),
            ),
          },
        ],
        balls: balls.map((b) => ({
          x: b.x, y: b.y, vx: b.vx, vy: b.vy,
          attachedTo: b.attachedTo, owner: b.owner,
        })),
        capsules: capsules.map((c) => ({ x: c.x, y: c.y, type: c.type })),
        bricks: [...bricks],
        events: [...events],
        inputAcks: [tick],
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
