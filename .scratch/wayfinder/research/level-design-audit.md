# Level Design Audit — Arkanoid Multiplayer

**Ticket:** #77 — "Level Design: Capsule Scripts, Round Progression, Competitive/Coop Constraints"
**Date:** 2026-09-30
**Sources:** Primary source code only (files cited with line numbers)

---

## 1. Capsule Scripts

### 1.1 Capsule Types (10 letters + Mystery)

Defined in `src/content/capsulePills.ts` (lines 14–33) and `src/shared/protocol.ts` (lines 114–115):

| Letter | Name | Color | Classic Role |
|--------|------|-------|--------------|
| **B** | Break | 0x3cbcfc | Instant round clear (fly through exit) |
| **C** | Catch | 0x58d858 | Hold ball on paddle |
| **D** | Disruption | 0xf878f8 | Duel-only: disrupt opponent |
| **E** | Expand | 0xf84828 | Paddle width ×1.5 |
| **L** | Laser | 0xf8b838 | Fire lasers from paddle |
| **M** | Multiball | 0x00fcfc | Split balls (×3) |
| **P** | Player | 0xe8b04a | Extra life |
| **S** | Slow | 0x8878f8 | Reset ball speed to base |
| **R** | Reduce | 0x883828 | Paddle width ×0.65 (negative) |
| **?** | Mystery | 0xd8d8e8 | Resolves to next undropped scripted capsule |

### 1.2 Capsule Effect Parameters (Data-Only, Authoring)

From `src/sim/capsules.ts` (lines 57–75):

```typescript
export const CAPSULE_EFFECTS = {
  expandFactor: 1.5,       // E: paddle ×1.5
  reduceFactor: 0.65,      // R: paddle ×0.65
  laserCooldownMs: 350,    // L: fire cooldown
  catchMaxMs: 10_000,      // C: hold max ~10s
  multiballCount: 3,       // M: split into 3
  capsuleCatchBonus: 100,  // all: +100 score on catch
} as const;
```

**Effects that clear on ball loss** (`src/sim/capsules.ts:73–75`):
```typescript
export const EFFECTS_CLEAR_ON_BALL_LOSS = new Set<CapsuleTypeId>([
  "E", "R", "C", "L", "S",
]);
```
*Notes:* P (extra life), M (multiball), B (break) persist or are instant. D (disrupt) is Duel-only.

### 1.3 Capsule Script Runner (Deterministic, Zero RNG)

From `src/sim/capsules.ts` (lines 11–53):

```typescript
export class CapsuleScriptRunner {
  private readonly script: readonly CapsuleScriptEntry[];
  private cursor = 0;

  onBrickBreak(cumulativeBreaks: number): CapsuleTypeId | null {
    // Fires ALL entries whose brickBreakCount <= cumulativeBreaks
    // Returns resolved capsule type
  }

  private resolve(type: CapsuleTypeId): CapsuleTypeId {
    if (type !== "?") return type;
    // "?" → next undropped scripted capsule (by script order)
    // Does NOT consume it — that entry still fires at its own break count
    // Fallback: "E" when script exhausted
  }
}
```

**Key behaviors:**
- **Cumulative brick-break triggers**: Entry fires when `brickBreakCount <= cumulativeBreaks`
- **Multiple entries can fire on same break** (while loop advances cursor past all matching)
- **Mystery (`?`) resolution**: Looks ahead in script for next non-`?` entry; does not consume it
- **E fallback**: When script exhausted (no more non-`?` entries), `?` resolves to `E`
- **Zero RNG**: Fully deterministic; identical break sequences → identical drops

### 1.4 Level Format: Capsule Script Validation

From `src/content/levelFormat.ts` (lines 4–9, 31–85):

```typescript
export interface CapsuleScriptEntry {
  brickBreakCount: number;  // cumulative, 1-based, strictly increasing
  capsule: CapsuleTypeId;   // one of B C D E L M P S R ?
}
```

**Validation rules** (`validateLevel`, lines 55–84):
- Script length: **6–10 entries** (line 58)
- `brickBreakCount`: strictly increasing (line 73)
- `capsule`: must match `/^[BCDELMPSR?]$/` (line 77)
- No entry's `brickBreakCount` may exceed **destructible brick count** (lines 80–82)
  - Destructible = all non-`.` and non-`G` cells (line 68)

---

## 2. Round Progression

### 2.1 Level Registry (33 Rounds)

From `src/content/levels.ts` (lines 1–71): 33 JSON level files imported (`round-001.json` through `round-033.json`).

**Accessors:**
- `getLevel(round: number): LevelData` — throws if round not found (lines 73–77)
- `availableRounds(): number[]` — returns `[1..33]` sorted (lines 79–81)

### 2.2 Level Data Structure

From `src/content/levelFormat.ts` (lines 11–22):

```typescript
export interface LevelData {
  version: number;                    // currently 1
  round: number;                      // 1–33
  grid: string[];                     // 18 rows × 13 cols
  baseBallSpeed: number;              // positive
  silverHitOverride: number | null;   // null = formula min(1+floor(round/8), 4)
  capsuleScript: CapsuleScriptEntry[]; // 6–10 entries, validated
  scoreOverrides: Partial<Record<string, number>>; // optional per-brick overrides
}
```

**Grid legend** (line 15): `.` empty, `A–F` colored tiers 1–6, `S` silver, `G` gold.

### 2.3 Difficulty Curve — Base Ball Speed

Sample progression from level files:

| Round | Base Speed | Notes |
|-------|------------|-------|
| 1 | 110 | `round-001.json:24` |
| 10 | 128 | `round-010.json:24` |
| 20 | 148 | `round-020.json:24` |
| 33 | 174 | `round-033.json:24` (boss) |

**Speed scaling during play** (`src/sim/roundSim.ts:187–192`, `src/sim/duel.ts:146–152`, `src/sim/sharedField.ts:217–223`):
```typescript
function speedFor(bricksLeft: number): number {
  let s = baseSpeed;
  if (bricksLeft <= 15) s *= 1.08;  // +8%
  if (bricksLeft <= 8)  s *= 1.08;  // +8% more (total +16.64%)
  return s * attackSpeedFactor;     // Attack mode only
}
```

### 2.4 Silver Brick Hits Formula

From `src/sim/roundSim.ts:669–672` (shared by all sims):
```typescript
function silverHits(override: number | null | undefined, round: number): number {
  if (typeof override === "number") return Math.max(1, Math.min(4, override));
  return Math.min(1 + Math.floor(round / 8), 4);
}
```
**Progression:** Rounds 1–7: 1 hit; 8–15: 2 hits; 16–23: 3 hits; 24–33: 4 hits.

### 2.5 Boss Round (Round 33 — Doh)

From `src/sim/roundSim.ts:43–44, 103–109, 137–138` and `src/sim/sharedField.ts:42–43, 117–123`:

- **Round 33 = Doh boss finale** (ticket 49)
- **Grid**: Gold frame remains; all destructible bricks stripped so ball reaches boss
- **Boss state**: HP, phase (1=opening, 2=final), projectiles
- **Clear condition**: Only boss death clears round; clearing all bricks while Doh lives does nothing
- **Capsule B (Break) disabled** on boss round (`roundSim.ts:387–394`, `sharedField.ts:428–433`)

### 2.6 Level Selection Modes (Multi-Field Session)

From `src/sim/multiField.ts` (lines 11–25, 123–146):

```typescript
export type MatchStructure = "bestOf" | "continuous" | "oneOff";
export type LevelSelection = "hostPick" | "fixedOrder" | "random";

export interface MatchConfig {
  structure: MatchStructure;
  bestOf: number;           // 1–7 odd (rounds to win)
  levelSelection: LevelSelection;
  timeCapTicks: number | null;
  hostPickRound?: number;   // for hostPick
  maxRound?: number;        // ceiling (e.g., Attack=32, Duel=32)
}
```

**Pick logic** (`pickRound`, lines 123–146):
- `hostPick`: Uses `hostPickRound` (validated ≤ `maxRound`)
- `fixedOrder`: Sequential `roundIndex`, clamped to `maxRound`
- `random`: Deterministic LCG in `1..maxRound` (seeded)

---

## 3. Competitive Mode Constraints

### 3.1 Mode Overview

| Mode | Players | Fields | Structure | Round Cap | Key Constraints |
|------|---------|--------|-----------|-----------|-----------------|
| **Race** | 2–4 | Parallel (1 each) | bestOf/continuous/oneOff | 33 | First to clear wins round |
| **Attack** | 2–4 | Parallel (1 each) | continuous only | 32 (no Doh) | Interference economy (meter, triggers) |
| **Duel** | 2 exactly | Shared (1 field) | bestOf/continuous/oneOff | 32 (no Doh) | Shared field, wall-constrained separation |

### 3.2 Race Mode (Pure Speed)

From `src/sim/multiField.ts` (lines 179–199):
- **Round clear**: First player to clear wins the round (`snap.phase === "roundClear"`)
- **0 lives**: Level resets with fresh layout, lives restored to 5, score preserved
- **Timeout resolution** (`resolveTimeout`, lines 63–84):
  - `bestOf` / `oneOff`: Most bricks broken this round
  - `continuous`: Furthest along (levelsCleared × 10000 + bricksThisLevel)
  - Exact tie → draw, no round point, advance to next level

**Symmetry**: Identical level per player, independent sims, identical capsule scripts.

### 3.3 Attack Mode (Race + Interference)

From `src/sim/attackSession.ts` and `src/sim/attack.ts`:

**Economy** (`AttackTuning`, `attack.ts:31–43`):
```typescript
DEFAULT_ATTACK_TUNING = {
  chainTiers: { small: 4, medium: 7, large: 10 },  // consecutive bricks
  costs: { rain: 30, shrink: 25, speed: 20, mangle: 40 }, // of meterMax 100
  rainBricks: { small: 3, medium: 6, large: 12 },
  shrinkFactor: 0.6,   // paddle width ×0.6
  speedFactor: 1.3,    // ball speed ×1.3
  shrinkMs: 10_000,    // 10s
  speedMs: 8_000,      // 8s
  mangleMs: 6_000,     // 6s
  fillPerBrick: 2,
  fillPerCapsule: 10,
  meterMax: 100,
};
```

**Triggers** (`AttackTriggerToggles`, `attack.ts:46–58` — all on by default):
- **Chains**: Auto-fire rain at chain tier thresholds (4/7/10 bricks)
- **Capsule capture**: Auto-fire small rain (3 bricks) per capsule caught
- **Level clear** (continuous only): Auto-fire small rain on level clear
- **Charged manual**: 4 attack buttons (rain/shrink/speed/mangle) at picked target

**Anti-snowball / fairness mechanics:**
- **Target validation** (`attackSession.ts:120–123`): Cannot target self or mid-level-reset immune players
- **Immunity**: Players who lose all lives (0-lives reset) are immune until next round advance (`attackSession.ts:102–103, 195–202`)
- **Effect stacking** (`attack.ts:126–146`): Same-type refreshes duration; different types independent
- **Mangle corruption** (`attack.ts:166–177`): Applied sim-side (hits all input methods equally); seeded LCG, not `Math.random`
- **Rain resurrection** (`roundSim.ts:481–502`): Deterministic LIFO from destroyed-brick history; falls back to topmost empty cells

**Round cap**: `ATTACK_MAX_ROUND = 32` (`src/content/levels.ts:83–90`) — Doh (33) excluded because attack triggers on level clear conflict with boss round.

### 3.4 Duel Mode (Shared Field, Head-to-Head)

From `src/sim/duel.ts`:

**Field layout** (lines 116–120):
```typescript
const paddles: [PaddleState, PaddleState] = [
  { x: FIELD_W / 4, y: PADDLE_Y, w: PADDLE_W, h: PADDLE_H },      // P0 left half
  { x: (FIELD_W * 3) / 4, y: PADDLE_Y, w: PADDLE_W, h: PADDLE_H }, // P1 right half
];
```

**Wall-constrained separation** (lines 178–224): Paddles solid to each other; movement budget pushes other paddle until its wall; deterministic order (P0 first).

**Ball models** (line 49): `"shared"` (steal-on-touch) or `"owned"` (deflect-only).

**Scoring** (lines 317–354):
- Brick points → **ball owner** (not breaker)
- Ball drop → **opponent +500** (`DUEL_DROP_BONUS`, `scoring.ts:36`)
- Capsule P → **+500 points** (no lives in duel, line 369–372)
- Capsule B → instant round clear, winner by score
- **Winner**: Most points; exact tie → draw (-1)

**Timeout** (lines 479–484): At `timeCapTicks`, winner by score; exact tie → draw.

**Round cap**: `DUEL_MAX_ROUND = 32` (`duel.ts:40–47`) — same reason as Attack.

**Capsule differences vs solo:**
- E/R: Width change triggers `separateAfterWidthChange` (line 164–176) to maintain solid separation
- S: Resets **all balls** to base speed (line 373–381)
- M: Splits only **catcher's owned balls** (line 383–393)

---

## 4. Coop Mode Constraints

### 4.1 Mode Overview

| Mode | Players | Fields | Structure | Key Constraints |
|------|---------|--------|-----------|-----------------|
| **Shared Field** | 2–4 | 1 field | Fixed range (start→end) | Shared lives (3×players), placements A/B/C |
| **Parallel Assist** | 2–4 | Parallel (1 each) | Fixed range (start→end) | Shared score, per-player lives (5), revive mechanics |

### 4.2 Shared Field (Ticket 33, Spec §6.4)

From `src/sim/sharedField.ts`:

**Placements** (lines 45, 99–108, 145–192):
- **A (Horizontal slices)**: Field split into `playerCount` vertical slices; each paddle confined to slice
- **B (Edges)**: 2P=bottom+right, 3P=+left, 4P=+top; paddles on different edges
- **C (Shared paddle)**: One paddle driven by **summed inputs** (clamped ±1)

**Ball speed scaling** (lines 40–41, 124–127):
```typescript
export const SPEED_SCALE_PER_EXTRA_PLAYER = 1.065; // +6.5% per player beyond 2
// Placement C exempt — no scaling
baseSpeed = (placement === "C") 
  ? level.baseBallSpeed 
  : level.baseBallSpeed * Math.pow(1.065, Math.max(0, playerCount - 2));
```

**Ball models** (line 46): `"shared"` (one ball, player 0 serves) or `"perPlayer"` (each player has ball).

**Team lives**: `3 × playerCount` shared pool (line 131).

**Paddle edges**: Non-paddle edges are walls; bottom **always open** (lines 241–256).

**Capsules** (lines 389–437): Affect catcher's paddle only (C: shared paddle). P → +1 team life.

**Boss round** (lines 117–123, 142–143, 314–331): Round 33 strips destructibles; Doh boss spawns; ball bounces off boss; each contact = hit; boss death = round clear.

**Pause** (lines 82–83, 616–622): Any player can pause/resume; coop semantics (pause freely).

### 4.3 Parallel Assist (Ticket 40, Spec §6.4)

From `src/sim/assistSession.ts`:

**Core structure** (lines 87–94): N independent `RoundSim` instances, one shared team score. Range `startRound` → `endRound` (inclusive).

**Lives**: 5 per player (line 109). **Downed at 0 lives**: Field frozen, spectates, **no meter income** (lines 117, 187–190, 210–216).

**Assist meter** (lines 22–46, 188–207):
- Fill: 2/brick + 10/capsule (same as Attack, spec §6.5)
- Cap: 100
- **Downed players earn no meter** but **keep spend rights** (gift/clear, not self-life)

**Assist actions** (lines 22–26, 137–156, 169–185):
| Action | Cost | Effect |
|--------|------|--------|
| **gift** | 20 | Send last caught capsule to target |
| **clear** | 30 | Remove 8 lowest destructible bricks on target's field |
| **life** | 40 | Revive downed target (1 life, ball attached, owner launches) |

**Constraints on life gift** (lines 146–150): Cannot target self; only revives downed players.

**Early clearers** (lines 8–9, 218–242): Spectate with **full gift rights including life gift**. Team advances only when **all live fields clear** current round.

**Win/Loss** (lines 79–85, 220–228, 270–273):
- **Win**: Last player clears `endRound` → phase = `"won"`
- **Loss**: All players downed simultaneously → phase = `"lost"`

**No ball-speed scaling** (line 9).

---

## 5. Level Data Format Validation & Migration

### 5.1 Current Format (Version 1)

From `src/content/levelFormat.ts` (lines 11–22):
```typescript
export interface LevelData {
  version: 1;
  round: number;
  grid: string[18];           // each 13 chars
  baseBallSpeed: number;
  silverHitOverride: number | null;
  capsuleScript: CapsuleScriptEntry[6..10];
  scoreOverrides: Partial<Record<string, number>>;
}
```

### 5.2 Validation Rules (`validateLevel`, lines 31–85)

| Check | Rule | Error Path |
|-------|------|------------|
| Grid rows | Exactly 18 (`BRICK_ROWS`) | `grid must have exactly 18 rows` |
| Grid cols | Exactly 13 (`BRICK_COLS`) per row | `grid row X must have exactly 13 cols` |
| Grid chars | Only `.`, `A–Z`, `a–z` (letters), `S`, `G` | `grid row X has invalid char` |
| baseBallSpeed | Positive number | `baseBallSpeed must be a positive number` |
| capsuleScript length | 6–10 entries | `capsuleScript must have 6–10 entries` |
| brickBreakCount | Strictly increasing, > 0 | `capsuleScript[X] brickBreakCount must be strictly increasing` |
| capsule type | Matches `/^[BCDELMPSR?]$/` | `capsuleScript[X] invalid capsule type` |
| brickBreakCount ≤ destructible | Cannot exceed breakable bricks | `capsuleScript[X] brickBreakCount exceeds destructible brick count` |

**Destructible count** (lines 64–69): All non-`.` and non-`G` cells.

### 5.3 Migration Path

**Current state**: All 33 levels are version 1. No migration code exists in the codebase.

**Future-proofing considerations:**
- `version` field present but unused in validation (only checked implicitly via structure)
- `scoreOverrides` allows per-brick score customization without schema change
- `silverHitOverride` allows per-level silver tuning
- Capsule script validation is strict but data-driven — new capsule types would require:
  1. Add to `CapsuleTypeId` union (`protocol.ts:114–115`)
  2. Add pill descriptor (`capsulePills.ts`)
  3. Add effect handling in `applyCapsule` (roundSim.ts, duel.ts, sharedField.ts)
  4. Update `CAPSULE_RE` regex (`levelFormat.ts:29`)
  5. Update `EFFECTS_CLEAR_ON_BALL_LOSS` if needed (`capsules.ts:73–75`)

**No automated migration tooling** — levels are hand-authored JSON. Adding `version: 2` would require a migration script to transform existing files.

---

## 6. Cross-Mode Constraint Summary

| Constraint | Race | Attack | Duel | Shared Field | Parallel Assist |
|------------|------|--------|------|--------------|-----------------|
| **Fields** | Parallel | Parallel | Shared | Shared | Parallel |
| **Players** | 2–4 | 2–4 | 2 exactly | 2–4 | 2–4 |
| **Round cap** | 33 | 32 | 32 | 33 (boss) | Configurable range |
| **Structure** | Any | Continuous only | Any | Fixed range | Fixed range |
| **Lives** | 5/player | 5/player | None (score) | 3×players (shared) | 5/player |
| **Ball speed scaling** | No | No | No | +6.5%/player>2 (A/B) | No |
| **Capsule script** | Per-level | Per-level | Per-level | Per-level | Per-level |
| **Anti-snowball** | Timeout resolution | Immunity, target validation, effect stacking | Wall separation, drop bonus to opponent | Shared lives, team win | Downed freeze, revive-only life gift |
| **Pause** | No (competitive) | No (competitive) | No (competitive) | Yes (any player) | N/A (no pause in sim) |

---

## 7. Key Source Files Index

| File | Purpose |
|------|---------|
| `src/content/capsulePills.ts` | Visual pill descriptors (10 letters + ?) |
| `src/sim/capsules.ts` | `CapsuleScriptRunner`, effect constants, clear-on-loss set |
| `src/content/levelFormat.ts` | `LevelData` interface, `CapsuleScriptEntry`, validation |
| `src/content/levels.ts` | Registry of 33 rounds, `ATTACK_MAX_ROUND=32` |
| `src/sim/roundSim.ts` | Single-player sim (base for Race/Attack/Assist) |
| `src/sim/multiField.ts` | Multi-field session (Race/Attack/ParallelAssist seam) |
| `src/sim/attackSession.ts` | Attack mode economy (meter, triggers, interference) |
| `src/sim/attack.ts` | Attack tuning, triggers, meter math, targeting |
| `src/sim/duel.ts` | Duel mode (shared field, wall separation, scoring) |
| `src/sim/sharedField.ts` | Shared field coop (placements A/B/C, boss) |
| `src/sim/assistSession.ts` | Parallel assist (meter, gift/clear/life, revive) |
| `src/content/scoring.ts` | Score table, level clear bonus, duel drop bonus |
| `src/shared/protocol.ts` | Wire types: `CapsuleTypeId`, `Snapshot`, `SimEvent` |
| `src/shared/gridConstants.ts` | Grid dims (13×18), field size (208×256) |
| `src/sim/constants.ts` | Sim constants (paddle, ball, capsule, tick rate) |

---

## 8. Observations & Gaps

1. **No procedural level generation** — all 33 rounds are hand-authored JSON.
2. **Capsule scripts are per-level fixed** — no dynamic adaptation to player count or mode.
3. **Attack/Duel exclude round 33** — hardcoded maxRound=32; boss mechanics incompatible.
4. **Shared Field placement C (shared paddle)** has no ball-speed scaling — intentional exemption.
5. **Parallel Assist has no pause support in sim** — pause coordination lives in `pauseCoord.ts` (coop modes only).
6. **Migration path undefined** — version field exists but no migration logic; would need tooling for v2.
7. **Capsule D (Disruption)** only implemented in Duel; ignored in other modes (`roundSim.ts:398–399`).
8. **Silver hit formula** caps at 4 hits (rounds 24+); override allows per-level tuning.
9. **Timeout resolution differs by structure** — continuous uses levelsCleared×10000, others use bricks only.
10. **All randomness is seeded LCG** — `Math.random()` never used in sim; deterministic replay guaranteed.