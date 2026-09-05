// Duel mode (ticket 32, spec §6.3): two players, one shared field, both
// paddles bottom side-by-side, solid to each other with wall-constrained
// separation. No lives, no reset — ball drop pays the opponent +500.
// Ball model: shared (steal-on-touch) or owned (deflect-only).
import {
  BALL_R,
  BRICK_COLS,
  BRICK_H,
  BRICK_ROWS,
  BRICK_TOP_OFFSET,
  BRICK_W,
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
import { aabbOverlap, clampEdgeAngle, offsetDeflect, resolveCircleBoxOverlap, type Box } from "./collision";
import {
  BRICK_EMPTY,
  BRICK_GOLD,
  coloredCell,
  isDestructibleCell,
  isGoldCell,
  type CapsuleTypeId,
  type InputFrame,
  type SimEvent,
  type Snapshot,
} from "shared/protocol";
import type { LevelData } from "content/levelFormat";
import { DUEL_DROP_BONUS } from "content/scoring";
import { CapsuleScriptRunner, CAPSULE_EFFECTS } from "./capsules";

const EVENT_RING_SIZE = 8;
/** Duel draws rounds 1–32 only — round 33 (Doh) never selected (spec §4). */
export const DUEL_MAX_ROUND = 32;

export function assertDuelRound(round: number): void {
  if (round > DUEL_MAX_ROUND) {
    throw new Error(`duel cannot select round ${String(round)} (max ${String(DUEL_MAX_ROUND)})`);
  }
}

export type DuelBallModel = "shared" | "owned";

interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  attachedTo: number | null;
  owner: number | null;
}

interface PaddleState {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CapsuleState {
  x: number;
  y: number;
  type: CapsuleTypeId;
}

export interface DuelMatchResult {
  /** Winner player index, or -1 for a draw. */
  winner: number;
  scores: [number, number];
}

export interface DuelSim {
  readonly currentTick: number;
  step(inputs: InputFrame[]): void;
  snapshot(): Snapshot;
  /** Match result once the round ended (clear/timeout); null while playing. */
  getMatchResult(): DuelMatchResult | null;
  debugSetBall(x: number, y: number, vx: number, vy: number): void;
  debugDropCapsule(x: number, y: number, type: CapsuleTypeId): void;
}

export interface DuelOptions {
  ballModel: DuelBallModel;
  /** Finite time cap in ticks, or null = infinite. */
  timeCapTicks: number | null;
  playerNames?: [string, string];
  /** Compact per-session skin indices [p0, p1] (ticket 44). */
  skinIndices?: readonly [number, number];
}

export function createRoundDuel(level: LevelData, opts: DuelOptions): DuelSim {
  assertDuelRound(level.round);
  const names = opts.playerNames ?? ["Player 1", "Player 2"];
  const skinIndices = opts.skinIndices ?? [0, 1];

  const bricks = parseGrid(level.grid, level.silverHitOverride, level.round);
  const baseSpeed = level.baseBallSpeed;

  let tick = 0;
  let phase: Snapshot["phase"] = "serve";
  const scores: [number, number] = [0, 0];
  let result: DuelMatchResult | null = null;
  const balls: BallState[] = [];
  const capsules: CapsuleState[] = [];
  const events: SimEvent[] = [];
  const scriptRunner = new CapsuleScriptRunner(level.capsuleScript);
  let brickBreaks = 0;

  // Paddles side-by-side: player 0 left half, player 1 right half.
  const paddles: [PaddleState, PaddleState] = [
    { x: FIELD_W / 4, y: PADDLE_Y, w: PADDLE_W, h: PADDLE_H },
    { x: (FIELD_W * 3) / 4, y: PADDLE_Y, w: PADDLE_W, h: PADDLE_H },
  ];

  function pushEvent(type: SimEvent["type"], source: number, target: number): void {
    events.push({ type, source, target, tick });
    if (events.length > EVENT_RING_SIZE) events.shift();
  }

  function attachBall(player: number): void {
    const p = paddles[player];
    if (!p) return;
    balls.push({
      x: p.x,
      y: p.y - p.h / 2 - BALL_R,
      vx: 0,
      vy: 0,
      attachedTo: player,
      owner: player,
    });
  }

  function destructibleCount(): number {
    let n = 0;
    for (const c of bricks) if (isDestructibleCell(c)) n++;
    return n;
  }

  function speedFor(): number {
    let s = baseSpeed;
    const left = destructibleCount();
    if (left <= 15) s *= 1.08;
    if (left <= 8) s *= 1.08;
    return s;
  }

  /**
   * Wall-constrained separation (spec §5): each paddle moves only as far as
   * the wall allows; leftover shift goes to the other paddle; ends flush.
   * Deterministic order: player 0's input processed first.
   */
  function movePaddle(player: 0 | 1, axis: number): void {
    const me = paddles[player];
    const other = paddles[player === 0 ? 1 : 0];
    const halfSum = (me.w + other.w) / 2;
    let budget = axis * PADDLE_VMAX * TICK_DT;
    // Phase 1: me moves until wall or flush against other.
    while (budget !== 0) {
      const wallLimit = axis > 0 ? FIELD_W - me.w / 2 : me.w / 2;
      const otherLimit = other.x - Math.sign(axis) * halfSum;
      const limit = axis > 0 ? Math.min(wallLimit, otherLimit) : Math.max(wallLimit, otherLimit);
      const step = Math.sign(axis) * Math.min(Math.abs(budget), Math.abs(limit - me.x));
      me.x += step;
      budget -= step;
      if (Math.abs(me.x - limit) < 1e-9) {
        if (Math.abs(limit - wallLimit) < 1e-9) break; // wall reached — done
        // Flush against other: leftover shift pushes the other paddle.
        let otherBudget = budget;
        budget = 0;
        while (otherBudget !== 0) {
          const otherWall = axis > 0 ? FIELD_W - other.w / 2 : other.w / 2;
          const oStep = Math.sign(axis) * Math.min(Math.abs(otherBudget), Math.abs(otherWall - other.x));
          other.x += oStep;
          otherBudget -= oStep;
          if (Math.abs(other.x - otherWall) < 1e-9) break; // both flush at wall
        }
      }
    }
  }

  function stepBall(b: BallState): void {
    if (b.attachedTo !== null) {
      const p = paddles[b.attachedTo];
      if (p) {
        b.x = p.x;
        b.y = p.y - p.h / 2 - BALL_R;
      }
      return;
    }
    b.x += b.vx * TICK_DT;
    b.y += b.vy * TICK_DT;

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

    // Paddles: offset-deflect; ownership per ball model.
    for (let pi = 0; pi < paddles.length; pi++) {
      const p = paddles[pi as 0 | 1];
      if (b.vy <= 0) continue;
      if (!aabbOverlap(b.x, b.y, BALL_R * 2, BALL_R * 2, p.x, p.y, p.w, p.h)) continue;
      const speed = speedFor();
      const d = offsetDeflect(b.x, speed, p, BALL_R);
      const res = resolveCircleBoxOverlap(b.x, b.y, BALL_R, p.x, p.y, p.w, p.h);
      b.vx = d.vx;
      b.vy = d.vy;
      if (res) b.y = res.y - BALL_R - 0.01;
      if (opts.ballModel === "shared") {
        b.owner = pi; // steal-on-touch
      }
      // owned model: deflect-only — ownership unchanged (no transfer).
      break;
    }

    // Bricks.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const hit = brickAt(b.x + dx * BRICK_W * 0.5, b.y + dy * BRICK_H * 0.5);
        if (!hit) continue;
        const res = resolveCircleBoxOverlap(b.x, b.y, BALL_R, hit.box.x, hit.box.y, hit.box.w, hit.box.h);
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
          hitBrick(hit.index, b.owner as 0 | 1);
          return;
        }
      }
    }
  }

  function brickAt(cx: number, cy: number): { index: number; box: Box } | null {
    const gx = Math.floor(cx / BRICK_W);
    const gy = Math.floor((cy - BRICK_TOP_OFFSET) / BRICK_H);
    if (gx < 0 || gx >= BRICK_COLS || gy < 0 || gy >= BRICK_ROWS) return null;
    const index = gy * BRICK_COLS + gx;
    if ((bricks[index] ?? BRICK_EMPTY) === BRICK_EMPTY) return null;
    return {
      index,
      box: { x: gx * BRICK_W + BRICK_W / 2, y: BRICK_TOP_OFFSET + gy * BRICK_H + BRICK_H / 2, w: BRICK_W, h: BRICK_H },
    };
  }

  function bounceOffBox(b: BallState, box: Box, res: { x: number; y: number }, hitY: number): void {
    const insideY = Math.abs(hitY - box.y) <= box.h / 2;
    if (insideY) {
      b.vx = res.x > box.x ? Math.abs(b.vx) : -Math.abs(b.vx);
    } else {
      b.vy = res.y > box.y ? Math.abs(b.vy) : -Math.abs(b.vy);
    }
    const speed = Math.hypot(b.vx, b.vy);
    const cl = clampEdgeAngle(b.vx, b.vy, speed);
    b.vx = cl.vx;
    b.vy = cl.vy;
  }

  function hitBrick(index: number, owner: 0 | 1): void {
    const cellV = bricks[index] ?? BRICK_EMPTY;
    const col = index % BRICK_COLS;
    const row = Math.floor(index / BRICK_COLS);
    const at = { x: col * BRICK_W + BRICK_W / 2, y: BRICK_TOP_OFFSET + row * BRICK_H + BRICK_H / 2 };
    let points = 0;
    if (cellV > 8 && cellV < 13) {
      const hits = cellV - 8;
      if (hits > 1) {
        bricks[index] = 8 + hits - 1;
        pushEvent("brickSilverHit", owner, index);
        return;
      }
      bricks[index] = BRICK_EMPTY;
      points = 50;
    } else {
      bricks[index] = BRICK_EMPTY;
      points = 50 + (cellV - 1) * 10;
    }
    // Brick points to ball owner (spec §6.3).
    scores[owner] += points;
    pushEvent("brickBreak", owner, index);
    brickBreaks++;
    const drop = scriptRunner.onBrickBreak(brickBreaks);
    if (drop !== null) capsules.push({ x: at.x, y: at.y, type: drop });
    if (destructibleCount() === 0) {
      phase = "roundClear";
      pushEvent("roundClear", owner, -1);
      result = { winner: winnerByScore(), scores: [scores[0], scores[1]] };
    }
  }

  function winnerByScore(): number {
    const a = scores[0];
    const b = scores[1];
    if (a === b) return -1; // exact tie → draw
    return a > b ? 0 : 1;
  }

  function applyCapsule(type: CapsuleTypeId, catcher: 0 | 1): void {
    pushEvent("capsuleCatch", catcher, -1);
    scores[catcher] += CAPSULE_EFFECTS.capsuleCatchBonus;
    const p = paddles[catcher];
    switch (type) {
      case "E":
        p.w = PADDLE_W * CAPSULE_EFFECTS.expandFactor;
        break;
      case "R":
        p.w = PADDLE_W * CAPSULE_EFFECTS.reduceFactor;
        break;
      case "P":
        // No lives in duel — P converts to points for the catcher.
        scores[catcher] += 500;
        break;
      case "S": {
        for (const b of balls) {
          const speed = Math.hypot(b.vx, b.vy);
          if (speed > 0) {
            b.vx = (b.vx / speed) * baseSpeed;
            b.vy = (b.vy / speed) * baseSpeed;
          }
        }
        break;
      }
      case "M": {
        const mine = balls.filter((b) => b.attachedTo === null && b.owner === catcher);
        for (const b of mine) {
          const speed = Math.hypot(b.vx, b.vy) || baseSpeed;
          const baseAngle = Math.atan2(b.vy, b.vx);
          for (const spread of [Math.PI / 6, -Math.PI / 6]) {
            const a = baseAngle + spread;
            balls.push({ x: b.x, y: b.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, attachedTo: null, owner: b.owner });
          }
        }
        break;
      }
      case "B":
        phase = "roundClear";
        pushEvent("roundClear", catcher, -1);
        result = { winner: winnerByScore(), scores: [scores[0], scores[1]] };
        break;
      default:
        break;
    }
  }

  function stepCapsules(): void {
    for (let i = capsules.length - 1; i >= 0; i--) {
      const c = capsules[i];
      if (!c) continue;
      c.y += CAPSULE_FALL_SPEED * TICK_DT;
      if (c.y - CAPSULE_H / 2 > FIELD_H) {
        capsules.splice(i, 1);
        continue;
      }
      for (let pi = 0; pi < paddles.length; pi++) {
        const p = paddles[pi as 0 | 1];
        if (aabbOverlap(c.x, c.y, CAPSULE_W, CAPSULE_H, p.x, p.y, p.w, p.h)) {
          capsules.splice(i, 1);
          applyCapsule(c.type, pi as 0 | 1);
          break;
        }
      }
    }
  }

  attachBall(0);

  const sim: DuelSim = {
    get currentTick() {
      return tick;
    },
    step(inputs) {
      if (phase === "roundClear" || phase === "gameOver") return;
      const byPlayer = new Map<number, InputFrame>();
      for (const f of inputs) byPlayer.set(f.player, f);

      // Paddle moves: player 0 first (deterministic), wall-constrained
      // separation with leftover-shift.
      const f0 = byPlayer.get(0);
      const f1 = byPlayer.get(1);
      movePaddle(0, f0 ? Math.max(-1, Math.min(1, f0.axisX)) : 0);
      movePaddle(1, f1 ? Math.max(-1, Math.min(1, f1.axisX)) : 0);

      // Launch: attached ball's owner launches.
      for (const f of inputs) {
        if (!f.launch) continue;
        for (const b of balls) {
          if (b.attachedTo === f.player) {
            const speed = speedFor();
            b.vx = 0;
            b.vy = -speed;
            b.attachedTo = null;
            phase = "play";
            pushEvent("ballLaunch", f.player, -1);
            break;
          }
        }
      }

      for (const b of [...balls]) stepBall(b);
      stepCapsules();

      // Ball drop: opponent +500; ball re-serves attached to the dropper.
      // Multiball: only the LAST ball re-attaches; others simply lost.
      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        if (b && b.attachedTo === null && b.y - BALL_R > FIELD_H) {
          const dropper: 0 | 1 = b.owner === 1 ? 1 : 0;
          const opponent: 0 | 1 = dropper === 0 ? 1 : 0;
          scores[opponent] += DUEL_DROP_BONUS;
          pushEvent("ballLoss", dropper, opponent);
          balls.splice(i, 1);
          if (balls.length === 0) {
            attachBall(dropper);
            phase = "serve";
          }
        }
      }

      // Timeout: winner = most points; exact tie → draw.
      if (opts.timeCapTicks !== null && tick >= opts.timeCapTicks && result === null) {
        phase = "roundClear";
        result = { winner: winnerByScore(), scores: [scores[0], scores[1]] };
        pushEvent("roundClear", -1, -1);
      }

      tick++;
    },
    snapshot() {
      return {
        tick,
        phase,
        round: level.round,
        players: paddles.map((p, i) => ({
          player: i,
          name: names[i] ?? `Player ${String(i + 1)}`,
          skinIndex: skinIndices[i] ?? i,
          paddle: { x: p.x, y: p.y, w: p.w, h: p.h, edge: "bottom" as const },
          lives: 0, // no lives in duel
          score: scores[i as 0 | 1],
          meter: 0,
          target: -1,
          chain: 0,
          state: "playing" as const,
          effects: {},
        })),
        balls: balls.map((b) => ({
          x: b.x, y: b.y, vx: b.vx, vy: b.vy,
          attachedTo: b.attachedTo, owner: b.owner,
        })),
        capsules: capsules.map((c) => ({ x: c.x, y: c.y, type: c.type })),
        bricks: [...bricks],
        events: [...events],
        inputAcks: [tick, tick],
      };
    },
    getMatchResult() {
      return result;
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
        const hits = typeof silverOverride === "number" ? silverOverride : Math.min(1 + Math.floor(round / 8), 4);
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
