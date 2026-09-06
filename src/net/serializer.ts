// Binary Snapshot serializer (spec §9): full state every broadcast tick, no
// deltas, ~600 B target for a representative 4-player state. ArrayBuffer +
// DataView; little-endian fixed layout.
//
// Layout:
//   u32 tick | u8 phase | u16 round | u8 playerCount | u8 ballCount |
//   u8 capsuleCount | u8 eventCount (≤8) | u8 ackCount | u16 brickCount
//   per player: u8 player, u8 skinIndex, u8 state, u8 target, u8 lives,
//               u32 score, u8 meter, u8 chain, f32 x, f32 y, f32 w, f32 h,
//               u8 edge, u16 nameLen
//   names: ASCII bytes per player
//   per ball: f32 x, f32 y, f32 vx, f32 vy, i8 attachedTo, i8 owner
//   per capsule: f32 x, f32 y, u8 type
//   per event: u8 type, u8 source, u8 target, u32 tick
//   per ack: u32
//   bricks: u8[brickCount]
import type {
  BallSnapshot,
  CapsuleSnapshot,
  CapsuleTypeId,
  PaddleEdge,
  PlayerSnapshot,
  PlayerSlotState,
  SimEvent,
  SimEventType,
  SimPhase,
  Snapshot,
} from "shared/protocol";
import { BRICK_COLS, BRICK_ROWS } from "shared/gridConstants";

const PHASES: readonly SimPhase[] = ["serve", "play", "roundClear", "gameOver"];
const EVENT_TYPES: readonly SimEventType[] = [
  "ballLaunch", "ballLoss", "brickBreak", "brickSilverHit", "capsuleCatch",
  "roundClear", "gameOver", "attack", "assist", "pause", "resume", "paddleBounce",
  "bossHit", "bossDead",
];
const EDGES: readonly PaddleEdge[] = ["bottom", "left", "right", "top"];
const STATES: readonly PlayerSlotState[] = ["playing", "downed", "removed"];
const CAPSULES: readonly CapsuleTypeId[] = ["B", "C", "D", "E", "L", "M", "P", "S", "R", "?"];

class Writer {
  private view: DataView;
  private offset = 0;

  constructor(readonly buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  u8(v: number): void {
    this.view.setUint8(this.offset, v & 0xff);
    this.offset += 1;
  }
  i8(v: number): void {
    this.view.setInt8(this.offset, Math.max(-128, Math.min(127, Math.trunc(v))));
    this.offset += 1;
  }
  u16(v: number): void {
    this.view.setUint16(this.offset, v & 0xffff, true);
    this.offset += 2;
  }
  u32(v: number): void {
    this.view.setUint32(this.offset, v >>> 0, true);
    this.offset += 4;
  }
  f32(v: number): void {
    this.view.setFloat32(this.offset, v, true);
    this.offset += 4;
  }
  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }
  get pos(): number {
    return this.offset;
  }
}

class Reader {
  private view: DataView;
  private offset = 0;

  constructor(readonly buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  private need(n: number): void {
    if (this.offset + n > this.buffer.byteLength) {
      throw new Error("malformed snapshot: truncated payload");
    }
  }
  u8(): number {
    this.need(1);
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }
  i8(): number {
    this.need(1);
    const v = this.view.getInt8(this.offset);
    this.offset += 1;
    return v;
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }
  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }
  ascii(len: number): string {
    this.need(len);
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.u8());
    return s;
  }
}

function indexOfOrThrow<T>(list: readonly T[], v: T, what: string): number {
  const i = list.indexOf(v);
  if (i < 0) throw new Error(`malformed snapshot: unknown ${what}`);
  return i;
}

export function serializeSnapshot(snap: Snapshot): ArrayBuffer {
  const players = snap.players;
  const balls = snap.balls;
  const capsules = snap.capsules;
  const events = snap.events.slice(-8);
  const bricks = snap.bricks.slice(0, BRICK_COLS * BRICK_ROWS);

  const nameBytes = players.reduce((n, p) => n + p.name.length, 0);
  // Fixed player fields: u8×5 + u32 score + u8 meter + u8 chain + f32×4 + u8 edge + u16 nameLen = 30
  // Boss tail (ticket 49): u8 present + (f32 x, f32 y, u8 hp, u8 phase, u8 dead) + u8 projCount + projCount × f32×4
  const boss = snap.boss ?? null;
  const bossProjectiles = snap.bossProjectiles ?? [];
  // Boss tail (ticket 49): u8 present-flag always written (absent = u8(0)).
  const bossTail = 1 + (boss !== null ? 5 + 15 + bossProjectiles.length * 16 : 0);
  const size =
    14 +
    players.length * 30 +
    nameBytes +
    balls.length * 20 +
    capsules.length * 9 +
    events.length * 7 +
    snap.inputAcks.length * 4 +
    bricks.length +
    bossTail;
  const w = new Writer(new ArrayBuffer(size));

  w.u32(snap.tick);
  w.u8(indexOfOrThrow(PHASES, snap.phase, "phase"));
  w.u16(snap.round);
  w.u8(players.length);
  w.u8(balls.length);
  w.u8(capsules.length);
  w.u8(events.length);
  w.u8(snap.inputAcks.length);
  w.u16(bricks.length);

  for (const p of players) {
    w.u8(p.player);
    w.u8(p.skinIndex & 0xff);
    w.u8(indexOfOrThrow(STATES, p.state, "player state"));
    // Target: -1 (none) encodes as 0; player index i encodes as i+1.
    w.u8((p.target + 1) & 0xff);
    w.u8(p.lives & 0xff);
    w.u32(p.score);
    w.u8(p.meter & 0xff);
    w.u8(p.chain & 0xff);
    w.f32(p.paddle.x);
    w.f32(p.paddle.y);
    w.f32(p.paddle.w);
    w.f32(p.paddle.h);
    w.u8(indexOfOrThrow(EDGES, p.paddle.edge, "paddle edge"));
    w.u16(p.name.length);
  }
  for (const p of players) w.ascii(p.name);

  for (const b of balls) {
    w.f32(b.x);
    w.f32(b.y);
    w.f32(b.vx);
    w.f32(b.vy);
    w.i8(b.attachedTo ?? -1);
    w.i8(b.owner ?? -1);
  }
  for (const c of capsules) {
    w.f32(c.x);
    w.f32(c.y);
    w.u8(indexOfOrThrow(CAPSULES, c.type, "capsule type"));
  }
  for (const e of events) {
    w.u8(indexOfOrThrow(EVENT_TYPES, e.type, "event type"));
    w.u8(e.source & 0xff);
    w.u8((e.target + 1) & 0xff); // -1 (none) encodes as 0
    w.u32(e.tick);
  }
  for (const a of snap.inputAcks) w.u32(a);
  for (const cell of bricks) w.u8(cell & 0xff);

  // Boss tail (ticket 49): absent boss = u8(0), nothing more.
  if (boss !== null) {
    w.u8(1);
    w.f32(boss.x);
    w.f32(boss.y);
    w.u8(boss.hp & 0xff);
    w.u8(boss.phase);
    w.u8(boss.dead ? 1 : 0);
    w.u8(bossProjectiles.length & 0xff);
    for (const p of bossProjectiles) {
      w.f32(p.x);
      w.f32(p.y);
      w.f32(p.vx);
      w.f32(p.vy);
    }
  } else {
    w.u8(0);
  }

  return w.buffer.slice(0, w.pos);
}

export function deserializeSnapshot(buffer: ArrayBuffer): Snapshot {
  const r = new Reader(buffer);
  const tick = r.u32();
  const phaseIdx = r.u8();
  const phase = PHASES[phaseIdx];
  if (phase === undefined) throw new Error("malformed snapshot: unknown phase");
  const round = r.u16();
  const playerCount = r.u8();
  const ballCount = r.u8();
  const capsuleCount = r.u8();
  const eventCount = r.u8();
  const ackCount = r.u8();
  const brickCount = r.u16();
  if (
    playerCount > 4 || ballCount > 64 || capsuleCount > 64 ||
    eventCount > 8 || brickCount > BRICK_COLS * BRICK_ROWS
  ) {
    throw new Error("malformed snapshot: counts out of bounds");
  }

  const nameLens: number[] = [];
  const players: PlayerSnapshot[] = [];
  for (let i = 0; i < playerCount; i++) {
    const player = r.u8();
    const skinIndex = r.u8();
    const stateIdx = r.u8();
    const state = STATES[stateIdx];
    if (state === undefined) throw new Error("malformed snapshot: unknown player state");
    const target = r.u8() - 1; // 0 = none → -1
    const lives = r.u8();
    const score = r.u32();
    const meter = r.u8();
    const chain = r.u8();
    const px = r.f32();
    const py = r.f32();
    const pw = r.f32();
    const ph = r.f32();
    const edgeIdx = r.u8();
    const edge = EDGES[edgeIdx];
    if (edge === undefined) throw new Error("malformed snapshot: unknown paddle edge");
    const nameLen = r.u16();
    if (nameLen > 12) throw new Error("malformed snapshot: name too long");
    nameLens.push(nameLen);
    players.push({
      player,
      skinIndex,
      state,
      target,
      lives,
      score,
      meter,
      chain,
      paddle: { x: px, y: py, w: pw, h: ph, edge },
      name: "",
      effects: {},
    });
  }
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p) p.name = r.ascii(nameLens[i] ?? 0);
  }

  const balls: BallSnapshot[] = [];
  for (let i = 0; i < ballCount; i++) {
    const x = r.f32();
    const y = r.f32();
    const vx = r.f32();
    const vy = r.f32();
    const attachedTo = r.i8();
    const owner = r.i8();
    balls.push({
      x, y, vx, vy,
      attachedTo: attachedTo < 0 ? null : attachedTo,
      owner: owner < 0 ? null : owner,
    });
  }

  const capsules: CapsuleSnapshot[] = [];
  for (let i = 0; i < capsuleCount; i++) {
    const x = r.f32();
    const y = r.f32();
    const typeIdx = r.u8();
    const type = CAPSULES[typeIdx];
    if (type === undefined) throw new Error("malformed snapshot: unknown capsule type");
    capsules.push({ x, y, type });
  }

  const events: SimEvent[] = [];
  for (let i = 0; i < eventCount; i++) {
    const typeIdx = r.u8();
    const type = EVENT_TYPES[typeIdx];
    if (type === undefined) throw new Error("malformed snapshot: unknown event type");
    const source = r.u8();
    const target = r.u8() - 1; // 0 = none → -1
    const tick = r.u32();
    events.push({ type, source, target, tick });
  }

  const inputAcks: number[] = [];
  for (let i = 0; i < ackCount; i++) inputAcks.push(r.u32());

  const bricks: number[] = [];
  for (let i = 0; i < brickCount; i++) bricks.push(r.u8());

  // Boss tail (ticket 49): u8 present; 0 = absent.
  const bossPresent = r.u8();
  let boss: Snapshot["boss"];
  let bossProjectiles: Snapshot["bossProjectiles"];
  if (bossPresent === 1) {
    const bx = r.f32();
    const by = r.f32();
    const hp = r.u8();
    const phase = r.u8() === 2 ? 2 : 1;
    const dead = r.u8() === 1;
    const projCount = r.u8();
    if (projCount > 32) throw new Error("malformed snapshot: boss projectile count out of bounds");
    boss = { x: bx, y: by, hp, phase, dead };
    bossProjectiles = [];
    for (let i = 0; i < projCount; i++) {
      const px = r.f32();
      const py = r.f32();
      const pvx = r.f32();
      const pvy = r.f32();
      bossProjectiles.push({ x: px, y: py, vx: pvx, vy: pvy });
    }
  }

  const result: Snapshot = {
    tick, phase, round, players, balls, capsules, events, inputAcks, bricks,
  };
  if (boss !== undefined && bossProjectiles !== undefined) {
    result.boss = boss;
    result.bossProjectiles = bossProjectiles;
  }
  return result;
}
