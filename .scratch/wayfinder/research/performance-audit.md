# Performance Audit: Ticket #78 — Split-Screen, Pooling, Mobile 60 FPS Profile

**Research Date:** 2026-09-30  
**Scope:** Primary source code review of Arkanoid Multiplayer codebase  
**Files Analyzed:** `src/render/splitScreen.ts`, `src/sim/*.ts`, `src/app/mobileLayout.ts`, `src/app/perfLadder.ts`, `src/app/frameStats.ts`, `src/app/loop.ts`, `src/app/soloSession.ts`, `src/app/versusBotsSession.ts`, `src/app/mpFlow.ts`, `vite.config.ts`, `src/render/fieldView.ts`, `src/render/brickCracks.ts`, `src/render/gameFont.ts`, `src/sim/boss.ts`, `src/sim/capsules.ts`, `src/sim/roundSim.ts`, `src/sim/sharedField.ts`, `src/sim/attackSession.ts`, `src/sim/multiField.ts`

---

## 1. Split-Screen Rendering Architecture

### 1.1 N-Across Viewports (`src/render/splitScreen.ts`, `src/render/layout.ts`)

**Implementation:**
- `SplitScreenView` creates one `FieldView` per player in `rebuild()` (lines 34-58)
- `splitRegions()` computes N equal-width columns with 8px gutters (`src/render/layout.ts:33-51`)
- Single player (N=1) gets full viewport centered (layout.ts:36-38)
- Regions recomputed on `resize()` but **never collapse fields** (splitScreen.ts:61-64, test at splitScreen.test.ts:144-154)

**Per-Field Composition:**
- Each `FieldView` is a full `Container` with: fieldContainer (clipped/scaled), HUD strip (BitmapText), paddle/ball/boss/capsule Graphics layers, optional TilingSprite background
- `sync(snapshots: readonly Snapshot[])` iterates index-aligned and calls `view.sync(snap)` per field (splitScreen.ts:67-73)

**Reduced-Effects Propagation:**
- `reducedEffects` option flows from `SplitScreenOptions` → each `FieldView` constructor (splitScreen.ts:20-21, 53)
- Live toggle via `setReducedEffects(reduced)` calls `invalidate()` on every field (splitScreen.ts:97-99)

**No Culling / RenderGroup:**
- **No frustum culling** implemented — all fields render every frame regardless of visibility
- **No `RenderGroup` usage** found in codebase (grep negative)
- Fields are `Container` children of `SplitScreenView.container`; Pixi renders all by default
- Test confirms degradation never collapses fields (splitScreen.test.ts:144-154)

**Performance Implication:**
- 4-player split-screen = 4 full `FieldView` trees rendered every frame
- Each `FieldView` maintains separate `Graphics` objects (brickGfx, paddleGfx, ballGfx, capsuleGfx, bossGfx) + optional Sprites
- No viewport-based culling → GPU submits all draw calls for all fields

---

## 2. Object Pooling Analysis

### 2.1 Simulation Side — No Object Pooling

**Balls / Capsules / Projectiles / Bricks:**
- `roundSim.ts`: `balls: BallState[]`, `capsules: CapsuleState[]` — arrays with `push()`/`splice()` (lines 117-118, 151-161, 416-435)
- `sharedField.ts`: `balls: BallState[]`, `capsules: CapsuleState[]` — same pattern (lines 134-135, 439-457)
- `boss.ts`: `projectiles: BossProjectile[]` — `push()` in `spawnProjectiles()` (line 63), `splice()` in `stepBoss()` (lines 110-112, 120-121)
- **No pooling** — objects allocated on creation, deallocated via array splice
- Multiball (M capsule) pushes 2 new `BallState` per existing ball (roundSim.ts:366-384)

**Events Ring Buffer:**
- `events: SimEvent[]` capped at `EVENT_RING_SIZE = 8` (roundSim.ts:42, 146-149; sharedField.ts:39, 194-197)
- Fixed-size circular buffer via `shift()` when over capacity — **this IS a form of pooling for events only**

**Destroyed Bricks History (Attack Mode):**
- `destroyedBricks: number[]` in `roundSim.ts:144` — LIFO stack for brick rain resurrection (lines 481-502)
- Grows unbounded during session; cleared only on field reset

### 2.2 Render Side — Static Crack Segment Pools Only

**Brick Cracks (`src/render/brickCracks.ts:28-54`):**
- **Per-style static pools** defined as module-level constants (`hairline`, `shatter`, `chip`)
- `crackSegments(cell, style)` reads from pool, returns new array of copied segments (line 51: `{ ...s }`)
- **Not a runtime object pool** — pools are compile-time data; segments allocated per-call

**BitmapFont Atlas (`src/render/gameFont.ts`):**
- Single runtime-generated atlas at resolution 2 (lines 18-28)
- Installed once via `installGameFont()` guard (lines 12-16)

**Sprite Textures:**
- `spriteTexture()` (from `spriteSheet.ts`) — loads/shares textures, no pooling mechanism visible

### 2.3 Pooling Verdict

| Object Type | Pooling? | Mechanism |
|-------------|----------|-----------|
| Balls | ❌ | Array push/splice |
| Capsules | ❌ | Array push/splice |
| Boss Projectiles | ❌ | Array push/splice |
| Sim Events | ✅ | Fixed ring buffer (size 8) |
| Crack Segments | ⚠️ | Static data pools only (no runtime reuse) |
| BitmapFont | ✅ | Single atlas |
| Sprites/Textures | ⚠️ | Shared via `spriteTexture()` cache |

**Conclusion:** No general-purpose object pooling for high-frequency sim objects (balls, capsules, projectiles). Only events use a ring buffer. Brick cracks use static data pools. This may cause GC pressure in long sessions with heavy multiball/attack mode.

---

## 3. Mobile 60 FPS Profile — Reduced-Effects Mode & Perf Ladder

### 3.1 Reduced-Effects Mode (`src/render/fieldView.ts`, `src/app/mobileLayout.ts`, `src/persistence/storage.ts`)

**What It Skips (fieldView.ts):**
- Background TilingSprite entirely (lines 112-120: `bgSprite` only created when `!reducedEffects`)
- Owner glow ring on balls (lines 198-199: `if (owner !== null && !this.reducedEffects)`)
- Silver brick crack overlays (lines 263-272: `if (cellSilverHits(cell) !== null && !this.reducedEffects)`)

**What It Keeps (Readability Gates Preserved):**
- Ball body tint (owner color) — line 214
- Paddle owner bar (2px strip) — lines 165-168, 180-184
- Silver brick tint (hit state readable through tint) — line 263 comment

**Settings Integration:**
- `settings.display.reducedEffects` persisted in `Storage` (storage.ts:25, 30, 53, 137)
- Settings UI toggle (settingsScreen.ts:210-215)
- Applied at session start: soloSession.ts:168, versusBotsSession.ts:167, mpFlow.ts:1005, 1014
- Live toggle: `FieldView.setReducedEffects()` → `invalidate()` → `bgSprite.visible = !reduced` (fieldView.ts:296-300)

**Mobile Detection (`src/app/mobileLayout.ts`):**
- `detectDeviceClass(coarsePointer, userAgent)` → `{ touch: boolean, mobile: boolean }` (lines 16-24)
- `maxLocalPlayers(device)` → mobile: 2, desktop: 4 (line 28)
- Layout plans: 1-local = portrait, 2-local = landscape with fullscreen+orientation lock attempt (lines 38-46)
- Regions: mobile 2-local = side-by-side halves (never stacked) regardless of orientation (lines 49-60)

### 3.2 Perf Ladder — Render-Only Degradation (`src/app/perfLadder.ts`, `src/app/loop.ts`, `src/app/frameStats.ts`)

**Rungs (perfLadder.ts:15-20):**
| Rung | DPR | renderEvery | degraded |
|------|-----|-------------|----------|
| 0 | 2.0 | 1 (60 fps) | false |
| 1 | 1.5 | 1 (60 fps) | false |
| 2 | 1.0 | 1 (60 fps) | false |
| 3 | 1.0 | 2 (30 fps) | **true** |

**Thresholds (perfLadder.ts:22-30):**
- Slow frame: ≥ 20 ms (≤ 50 fps sustained) — `SLOW_FRAME_MS = 1000/50`
- Fast frame: ≤ ~15.4 ms (≥ 65 fps) — `FAST_FRAME_MS = 1000/65`
- Step down: 45 consecutive slow frames (~0.75s at 60 fps) — `STEP_DOWN_FRAMES = 45`
- Step up: 240 consecutive fast frames (~4s) — `STEP_UP_FRAMES = 240` (lazy recovery)

**Integration (loop.ts, soloSession.ts:437-445, versusBotsSession.ts:464-470):**
- `AccumulatorLoop` measures `simMs`, `renderMs`, `frameMs` (loop.ts:4-11)
- `onFrameStats` hook feeds `FrameStats` + `PerfLadder.observe(appWork)` where `appWork = simMs + syncMs + renderMs`
- On rung change: `shell.setResolution(Math.min(rung.dpr, effectiveDpr(...)))`, `loop.setRenderEvery(rung.renderEvery)`, show/hide degraded banner

**Budgets (frameStats.ts:6-18):**
- sim ≤ 2 ms, sync ≤ 3 ms, render ≤ 5 ms, total ≤ 10 ms app work
- Headroom target: sustained ≤ 8 ms/frame
- Draw calls: hard < 20, expected ≤ 10
- Texture memory: 64 MB ceiling (enforced in soloSession.ts:494-504)

**Sim Rate Invariant:**
- **Sim stays fixed 60 Hz** regardless of rung (perfLadder.ts:2-3, loop.ts:13-16)
- Only render cadence and DPR degrade

### 3.3 Asset Downscaling / Mipmaps
- **No dynamic asset downscaling** — sprites loaded at native resolution
- `effectiveDpr()` caps DPR at 2 (layout.ts:29, ui/settings.ts:14-15)
- Sprite sheet: Tiny Break-em paddles/balls (64×16), Pixel Space background (64×64) — tiny by design
- No mipmap generation or LOD switching visible

---

## 4. Memory Pressure in Long Sessions

### 4.1 Episode Mode (Solo) — `src/app/soloEpisode.ts` (referenced in soloSession.ts:96)

- Episode tracks rounds 1–33, lives, score, high score, highest round
- `SoloSession` creates new `RoundSim` per round via `multiField.makeSims()` (multiField.ts:112-121, 249-257)
- Field reset on 0 lives: `resetField()` creates fresh `RoundSim` (multiField.ts:249-258) — **old sim GC'd**
- `destroyedBricks` history accumulates per field across rounds (roundSim.ts:144) — cleared only on `resetField()`

### 4.2 Multiplayer (mpFlow.ts)

- Host: `MultiFieldSession` with N `RoundSim` instances (multiField.ts:110)
- Guest: `GuestGameSession` with interpolator + prediction (net/guestGame.ts — not fully read)
- Rejoin window: 90s hold slots (mpFlow.ts:1282-1285) — keeps player state in `RejoinRegistry`
- **No explicit GC / memory cleanup hooks** beyond standard teardown

### 4.3 Identified Pressure Points

1. **`destroyedBricks` array** grows per brick break, never shrinks except on field reset (roundSim.ts:321, 481-502). In Attack mode with brick rain, this grows continuously.

2. **Sim Event Arrays** — ring buffer capped at 8, safe.

3. **Capsule/Ball Arrays** — allocated per spawn, spliced on removal. Multiball can create many balls (M capsule splits each ball → 3 total).

4. **Boss Projectiles** — phase 2 fires 3 projectiles every 120 ticks (boss.ts:97-100). Culled when off-screen (lines 110-112).

5. **No Object Pooling** — frequent allocation/deallocation in hot path (60 Hz tick).

6. **Texture Memory** — static 7 tiny PNGs (~few KB each), well under 64 MB budget (soloSession.ts:494-504).

---

## 5. Bundle Size & Code Splitting (Vite Config)

### 5.1 Vite Config (`vite.config.ts`)

```typescript
// No manualChunks, no rollupOptions.output.manualChunks
// No dynamic import() except 2 instances:
```

**Dynamic Imports Found (2 total):**
- `soloSession.ts:66` — `const { createAppShell } = await import("render/appShell")`
- `versusBotsSession.ts:78` — same

**No Code Splitting Config:**
- No `build.rollupOptions.output.manualChunks`
- No `build.lib` entry points for separate chunks
- All source aliased via `resolve.alias` (lines 21-35) but bundled together
- Single entry point implied (no multi-page config)

**Codecov Plugin:**
- Bundle analysis enabled only when `CODECOV_TOKEN` present (lines 15-19)

### 5.2 Bundle Implications

- Entire app (sim, render, net, signaling, ui, audio, content) bundles into single chunk
- `render/appShell` (Pixi initialization) lazy-loaded only in session starters
- No separate chunks for: multiplayer (mpFlow, net), versus-bots, solo, content (levels/skins/themes)
- No dynamic import for heavy features (e.g., `qrcode-generator` used in lobbyScreens.ts:26 — likely bundled)

---

## 6. Summary of Findings

| Area | Status | Key Evidence |
|------|--------|--------------|
| **Split-Screen N-Across** | ✅ Implemented | splitScreen.ts:34-58, layout.ts:33-51 |
| **Frustum Culling** | ❌ Absent | No RenderGroup, no visibility checks |
| **RenderGroup Usage** | ❌ Absent | grep negative |
| **Object Pooling (sim)** | ❌ Absent | Arrays with push/splice only |
| **Object Pooling (render)** | ⚠️ Partial | Static crack data pools only |
| **Events Ring Buffer** | ✅ Present | EVENT_RING_SIZE=8 (roundSim.ts:42) |
| **Reduced-Effects Mode** | ✅ Implemented | fieldView.ts:112-120, 198-199, 263-272 |
| **Mobile Detection** | ✅ Implemented | mobileLayout.ts:16-24 |
| **Mobile Local Cap** | ✅ 2 players | mobileLayout.ts:28 |
| **Mobile Layout** | ✅ Side-by-side | mobileLayout.ts:49-60 |
| **Perf Ladder (4 rungs)** | ✅ Implemented | perfLadder.ts:15-20 |
| **Sim Rate Invariant** | ✅ 60 Hz fixed | perfLadder.ts:2-3, loop.ts:13-16 |
| **Asset Downscaling** | ❌ Absent | No dynamic LOD/mipmaps |
| **Code Splitting** | ❌ Absent | vite.config.ts: no manualChunks |
| **Dynamic Imports** | ⚠️ Minimal | 2× appShell only |
| **Texture Budget** | ✅ Enforced | frameStats.ts:128-130, soloSession.ts:494-504 |
| **Draw Call Budget** | ✅ Tracked | frameStats.ts:13-15, 137-186 |

---

## 7. Recommendations (Per Ticket #78)

1. **Add frustum culling** for split-screen: skip `FieldView.sync()` when region off-screen (requires viewport intersection test)

2. **Implement object pools** for `BallState`, `CapsuleState`, `BossProjectile` — pre-allocate arrays, reuse via free-list indices

3. **Add dynamic imports** for heavy features: `qrcode-generator`, multiplayer signaling, versus-bots variants

4. **Configure Vite `manualChunks`** to split: `vendor` (pixi.js), `sim`, `net/signaling`, `content`

5. **Add texture downscaling** on degraded rung: generate lower-res sprite variants or use Pixi `BASE_TEXTURE.scaleMode`

6. **Cap `destroyedBricks` history** in Attack mode (e.g., keep last 200 entries)

7. **Add memory telemetry** in `FrameStats` — track JS heap via `performance.memory` (Chrome) or GC timing