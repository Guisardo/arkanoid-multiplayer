import { createAttackSession } from "../src/sim/attackSession";
import { isDestructibleCell } from "../src/shared/protocol";
import { BRICK_COLS } from "../src/sim/constants";

const session = createAttackSession({
  playerCount: 2,
  config: { structure: "bestOf", bestOf: 3, levelSelection: "fixedOrder", timeCapTicks: null },
  seed: 7,
});

function destructibleCount(bricks) {
  let n = 0;
  for (const c of bricks) if (isDestructibleCell(c)) n++;
  return n;
}

const snap = session.snapshots()[0];
let target = -1;
for (let i = 0; i < snap.bricks.length; i++) {
  if (isDestructibleCell(snap.bricks[i])) { target = i; break; }
}
console.log("first destructible index:", target, "col", target % BRICK_COLS, "row", Math.floor(target / BRICK_COLS));
const col = target % BRICK_COLS;
const row = Math.floor(target / BRICK_COLS);
session.debugSetBall(0, col * 16 + 8 + 2, 20 + (row + 1) * 8 + 6, 0, -200);
const before = destructibleCount(session.snapshots()[0].bricks);
console.log("before:", before);
for (let s = 0; s < 40; s++) {
  session.step([{ player: 0, tick: s, axisX: 0, axisY: 0, launch: false, actions: { cycleForward: false, cycleBack: false, fire: [false, false, false, false] } }]);
  const now = destructibleCount(session.snapshots()[0].bricks);
  if (now < before) { console.log("broke at step", s); break; }
  if (s === 39) console.log("NOT BROKEN. ball:", JSON.stringify(session.snapshots()[0].balls[0]));
}
