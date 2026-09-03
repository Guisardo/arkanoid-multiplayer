// Shared field coop (ticket 33, spec §6.4): 2–4 players on one field, shared
// team life pool = 3 × player count, placements A/B/C, shared or per-player
// ball model, +6.5% ball speed per player beyond 2 (A/B; C exempt).
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
  type PaddleEdge,
  type SimEvent,
  type Snapshot,
} from "shared/protocol";
import type { LevelData } from "content/levelFormat";
import { CapsuleScriptRunner, CAPSULE_EFFECTS } from "./capsules";

const EVENT_RING_SIZE = 8;
/** Ball speed scaling per player beyond 2 (spec: +5–8%; 6.5% mid). */
export const SPEED_SCALE_PER_EXTRA_PLAYER = 1.065;

export type Placement = "A" | "B" | "C";
export type SharedBallModel = "shared" | "perPlayer";

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
  edge: PaddleEdge;
  /** Placement A: movement slice [minX, maxX]. */
  minX: number;
  maxX: number;
  /** Vertical paddles (placement B sides). */
  minY: number;
  maxY: number;
}

interface CapsuleState {
  x: number;
  y: number;
  type: CapsuleTypeId;
}

export interface SharedFieldSim {
  readonly currentTick: number;
  step(inputs: InputFrame[]): void;
  snapshot(): Snapshot;
  getTeamState(): { lives: number; score: number; round: number };
  isPaused(): boolean;
  requestPause(player: number): void;
  requestResume(player: number): void;
  debugSetBall(x: number, y: number, vx: number, vy: number): void;
  debugDropCapsule(x: number, y: number, type: CapsuleTypeId): void;
}

export interface SharedFieldOptions {
  placement: Placement;
  ballModel: SharedBallModel;
  playerCount: 2 | 3 | 4;
  playerNames?: string[];
}

/** Edge assignment for placement B (spec: 2P bottom+right, 3P +left, 4P +top). */
export function placementBEdges(playerCount: 2 | 3 | 4): PaddleEdge[] {
  switch (playerCount) {
    case 2:
      return ["bottom", "right"];
    case 3:
      return ["bottom", "right", "left"];
    case 4:
      return ["bottom", "right", "left", "top"];
  }
}

export function createSharedFieldSim(level: LevelData, opts: SharedFieldOptions): SharedFieldSim {
  const { playerCount, placement, ballModel } = opts;
  const names =
    opts.playerNames ?? Array.from({ length: playerCount }, (_, i) => `Player ${String(i + 1)}`);

  const bricks = parseGrid(level.grid, level.silverHitOverride, level.round);
  const baseSpeed =
    placement === "C"
      ? level.baseBallSpeed
      : level.baseBallSpeed * Math.pow(SPEED_SCALE_PER_EXTRA_PLAYER, Math.max(0, playerCount - 2));

  let tick = 0;
  let phase: Snapshot["phase"] = "serve";
  let lives = 3 * playerCount;
  let score = 0;
  let paused = false;
  const balls: BallState[] = [];
  const capsules: CapsuleState[] = [];
  const events: SimEvent[] = [];
  const scriptRunner = new CapsuleScriptRunner(level.capsuleScript);
  let brickBreaks = 0;

  const paddles: PaddleState[] = makePaddles();

  function makePaddles(): PaddleState[] {
    const out: PaddleState[] = [];
    if (placement === "A") {
      const sliceW = FIELD_W / playerCount;
      for (let i = 0; i < playerCount; i++) {
        const minX = i * sliceW;
        const maxX = (i + 1) * sliceW;
        out.push({
          x: minX + sliceW / 2,
          y: PADDLE_Y,
          w: PADDLE_W,
          h: PADDLE_H,
          edge: "bottom",
          minX: minX + PADDLE_W / 2,
          maxX: maxX - PADDLE_W / 2,
          minY: 0,
          maxY: 0,
        });
      }
    } else if (placement === "B") {
      const edges = placementBEdges(playerCount);
      for (const edge of edges) {
        if (edge === "bottom") {
          out.push({ x: FIELD_W / 2, y: PADDLE_Y, w: PADDLE_W, h: PADDLE_H, edge, minX: PADDLE_W / 2, maxX: FIELD_W - PADDLE_W / 2, minY: 0, maxY: 0 });
        } else if (edge === "right") {
          out.push({ x: FIELD_W - PADDLE_H / 2 - 4, y: FIELD_H / 2, w: PADDLE_H, h: PADDLE_W, edge, minX: 0, maxX: 0, minY: PADDLE_W / 2, maxY: FIELD_H - PADDLE_W / 2 });
        } else if (edge === "left") {
          out.push({ x: PADDLE_H / 2 + 4, y: FIELD_H / 2, w: PADDLE_H, h: PADDLE_W, edge, minX: 0, maxX: 0, minY: PADDLE_W / 2, maxY: FIELD_H - PADDLE_W / 2 });
        } else {
          out.push({ x: FIELD_W / 2, y: PADDLE_H / 2 + 4, w: PADDLE_W, h: PADDLE_H, edge, minX: PADDLE_W / 2, maxX: FIELD_W - PADDLE_W / 2, minY: 0, maxY: 0 });
        }
      }
    } else {
      // C: one shared paddle, driven by summed inputs.
      out.push({
        x: FIELD_W / 2,
        y: PADDLE_Y,
        w: PADDLE_W,
        h: PADDLE_H,
        edge: "bottom",
        minX: PADDLE_W / 2,
        maxX: FIELD_W - PADDLE_W / 2,
        minY: 0,
        maxY: 0,
      });
    }
    return out;
  }

  function pushEvent(type: SimEvent["type"], source: number, target: number): void {
    events.push({ type, source, target, tick });
    if (events.length > EVENT_RING_SIZE) events.shift();
  }

  function attachBall(player: number): void {
    const p = paddles[player] ?? paddles[0];
    if (!p) return;
    let x = p.x;
    let y = p.y;
    if (p.edge === "bottom") y = p.y - p.h / 2 - BALL_R;
    else if (p.edge === "top") y = p.y + p.h / 2 + BALL_R;
    else if (p.edge === "left") x = p.x + p.w / 2 + BALL_R;
    else x = p.x - p.w / 2 - BALL_R;
    balls.push({ x, y, vx: 0, vy: 0, attachedTo: player, owner: player });
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

  function paddleBox(p: PaddleState): Box {
    return { x: p.x, y: p.y, w: p.w, h: p.h };
  }

  function stepBall(b: BallState): void {
    if (b.attachedTo !== null) {
      const p = paddles[b.attachedTo];
      if (p) {
        b.x = p.x;
        b.y = p.edge === "bottom" ? p.y - p.h / 2 - BALL_R : p.y + p.h / 2 + BALL_R;
      }
      return;
    }
    b.x += b.vx * TICK_DT;
    b.y += b.vy * TICK_DT;

    // Walls: placement B non-paddle edges are walls; bottom ALWAYS open.
    const hasLeftPaddle = paddles.some((p) => p.edge === "left");
    const hasRightPaddle = paddles.some((p) => p.edge === "right");
    const hasTopPaddle = paddles.some((p) => p.edge === "top");
    if (b.x - BALL_R < 0 && !hasLeftPaddle) {
      b.x = BALL_R;
      b.vx = Math.abs(b.vx);
    }
    if (b.x + BALL_R > FIELD_W && !hasRightPaddle) {
      b.x = FIELD_W - BALL_R;
      b.vx = -Math.abs(b.vx);
    }
    if (b.y - BALL_R < 0 && !hasTopPaddle) {
      b.y = BALL_R;
      b.vy = Math.abs(b.vy);
    }

    // Paddles: each edge type bounces off its inner face.
    for (const p of paddles) {
      if (!aabbOverlap(b.x, b.y, BALL_R * 2, BALL_R * 2, p.x, p.y, p.w, p.h)) continue;
      const res = resolveCircleBoxOverlap(b.x, b.y, BALL_R, p.x, p.y, p.w, p.h);
      if (!res) continue;
      const speed = speedFor();
      if (p.edge === "bottom" && b.vy > 0) {
        const d = offsetDeflect(b.x, speed, paddleBox(p), BALL_R);
        b.vx = d.vx;
        b.vy = d.vy;
        b.y = res.y - BALL_R - 0.01;
        b.attachedTo = null;
      } else if (p.edge === "top" && b.vy < 0) {
        b.vy = Math.abs(b.vy);
        b.y = res.y + BALL_R + 0.01;
        const cl = clampEdgeAngle(b.vx, b.vy, speed);
        b.vx = cl.vx;
        b.vy = cl.vy;
      } else if (p.edge === "left" && b.vx < 0) {
        b.vx = Math.abs(b.vx);
        b.x = res.x + BALL_R + 0.01;
        const cl = clampEdgeAngle(b.vx, b.vy, speed);
        b.vx = cl.vx;
        b.vy = cl.vy;
      } else if (p.edge === "right" && b.vx > 0) {
        b.vx = -Math.abs(b.vx);
        b.x = res.x - BALL_R - 0.01;
        const cl = clampEdgeAngle(b.vx, b.vy, speed);
        b.vx = cl.vx;
        b.vy = cl.vy;
      }
    }

    // Bricks (any direction).
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
          hitBrick(hit.index, b.owner ?? 0);
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

  function hitBrick(index: number, player: number): void {
    const cellV = bricks[index] ?? BRICK_EMPTY;
    const col = index % BRICK_COLS;
    const row = Math.floor(index / BRICK_COLS);
    const at = { x: col * BRICK_W + BRICK_W / 2, y: BRICK_TOP_OFFSET + row * BRICK_H + BRICK_H / 2 };
    if (cellV > 8 && cellV < 13) {
      const hits = cellV - 8;
      if (hits > 1) {
        bricks[index] = 8 + hits - 1;
        pushEvent("brickSilverHit", player, index);
        return;
      }
      bricks[index] = BRICK_EMPTY;
      pushEvent("brickBreak", player, index);
      score += 50;
    } else {
      bricks[index] = BRICK_EMPTY;
      pushEvent("brickBreak", player, index);
      score += 50 + (cellV - 1) * 10;
    }
    brickBreaks++;
    const drop = scriptRunner.onBrickBreak(brickBreaks);
    if (drop !== null) capsules.push({ x: at.x, y: at.y, type: drop });
    if (destructibleCount() === 0) {
      phase = "roundClear";
      pushEvent("roundClear", player, -1);
    }
  }

  /** Capsules affect the capturer's paddle only (C: the shared paddle). */
  function applyCapsule(type: CapsuleTypeId, catcher: number): void {
    pushEvent("capsuleCatch", catcher, -1);
    score += CAPSULE_EFFECTS.capsuleCatchBonus;
    const p = paddles[placement === "C" ? 0 : catcher] ?? paddles[0];
    if (!p) return;
    switch (type) {
      case "E":
        p.w = PADDLE_W * CAPSULE_EFFECTS.expandFactor;
        break;
      case "R":
        p.w = PADDLE_W * CAPSULE_EFFECTS.reduceFactor;
        break;
      case "P":
        lives++;
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
        // Multiball splits the capturing player's ball only.
        const mine = balls.filter((b) => b.attachedTo === null && (ballModel === "shared" || b.owner === catcher));
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
      for (const p of paddles) {
        if (p.edge !== "bottom") continue;
        if (aabbOverlap(c.x, c.y, CAPSULE_W, CAPSULE_H, p.x, p.y, p.w, p.h)) {
          capsules.splice(i, 1);
          applyCapsule(c.type, paddles.indexOf(p));
          break;
        }
      }
    }
  }

  function clearEffectsOnBallLoss(): void {
    for (const p of paddles) p.w = PADDLE_W;
  }

  // Initial serve: shared model → player 0; perPlayer → each player a ball.
  if (ballModel === "shared") {
    attachBall(0);
  } else {
    for (let i = 0; i < playerCount; i++) attachBall(i);
  }

  const sim: SharedFieldSim = {
    get currentTick() {
      return tick;
    },
    step(inputs) {
      if (phase === "roundClear" || phase === "gameOver" || paused) return;
      const byPlayer = new Map<number, InputFrame>();
      for (const f of inputs) byPlayer.set(f.player, f);

      if (placement === "C") {
        // Shared paddle: summed inputs, clamp ±1.
        let sum = 0;
        for (const f of inputs) sum += Math.max(-1, Math.min(1, f.axisX));
        const p = paddles[0];
        if (p) {
          p.x += Math.max(-1, Math.min(1, sum)) * PADDLE_VMAX * TICK_DT;
          p.x = Math.max(p.minX, Math.min(p.maxX, p.x));
        }
      } else {
        for (let i = 0; i < paddles.length; i++) {
          const p = paddles[i];
          if (!p) continue;
          const f = byPlayer.get(i);
          if (!f) continue;
          if (p.edge === "bottom" || p.edge === "top") {
            const axis = Math.max(-1, Math.min(1, f.axisX));
            p.x += axis * PADDLE_VMAX * TICK_DT;
            p.x = Math.max(p.minX, Math.min(p.maxX, p.x));
          } else {
            // Side paddles move vertically.
            const axis = Math.max(-1, Math.min(1, f.axisY));
            p.y += axis * PADDLE_VMAX * TICK_DT;
            p.y = Math.max(p.minY, Math.min(p.maxY, p.y));
          }
        }
      }

      // Launch: any attached ball's owner (or any player in C / shared).
      for (const f of inputs) {
        if (!f.launch) continue;
        for (const b of balls) {
          if (b.attachedTo === null) continue;
          if (placement === "C" || ballModel === "shared" || b.attachedTo === f.player) {
            const speed = speedFor();
            const p = paddles[b.attachedTo];
            if (p?.edge === "left") {
              b.vx = speed;
              b.vy = 0;
            } else if (p?.edge === "right") {
              b.vx = -speed;
              b.vy = 0;
            } else if (p?.edge === "top") {
              b.vx = 0;
              b.vy = speed;
            } else {
              b.vx = 0;
              b.vy = -speed;
            }
            b.attachedTo = null;
            phase = "play";
            pushEvent("ballLaunch", f.player, -1);
            break;
          }
        }
      }

      for (const b of [...balls]) stepBall(b);
      stepCapsules();

      // Ball loss: life lost when ball count hits zero (multiball = buffer).
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
          if (ballModel === "shared") attachBall(0);
          else for (let i = 0; i < playerCount; i++) attachBall(i);
        }
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
          skinIndex: i,
          paddle: { x: p.x, y: p.y, w: p.w, h: p.h, edge: p.edge },
          lives,
          score,
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
        inputAcks: new Array<number>(playerCount).fill(tick),
      };
    },
    getTeamState() {
      return { lives, score, round: level.round };
    },
    isPaused() {
      return paused;
    },
    requestPause() {
      paused = true;
      pushEvent("pause", 0, -1);
    },
    requestResume() {
      paused = false;
      pushEvent("resume", 0, -1);
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
