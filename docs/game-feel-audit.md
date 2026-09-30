# Game Feel / Juice Audit — Arkanoid Multiplayer

**Date:** 2026-09-29  
**Auditor:** AI Agent (game-feel skill)  
**Scope:** Visual feedback layer only — audio is ✅ complete

---

## 1. Executive Summary

| Layer | Status | Notes |
|-------|--------|-------|
| **Audio (SFX + Music)** | ✅ **Complete** | Procedural synthesis, event-driven, pitch-varied brick hits, chain escalation, music per phase |
| **Visual Feedback** | ❌ **Minimal** | Only: brick cracks (silver), owner glow rings (MP), owner color bars (MP), ball tint (MP) |
| **Screen Shake / Camera Trauma** | ❌ **Missing** | No camera offset, no trauma model |
| **Hit-Stop / Freeze Frames** | ❌ **Missing** | Sim runs fixed 60 Hz; no time-scale manipulation |
| **Squash & Stretch** | ❌ **Missing** | Ball/paddle sprites static scale |
| **Particles** | ❌ **Missing** | No `ParticleContainer`, no burst emitters |
| **Score/Event Pops** | ❌ **Missing** | HUD updates instantly, no animation |
| **Flash / Color Effects** | ❌ **Missing** | No white-flash, no impact tint |
| **Knockback Visualization** | ❌ **Missing** | Paddle/ball motion is pure sim; no visual exaggeration |

**Bottom line:** The game *sounds* like Arkanoid but *looks* like a debug render. Every impact event needs 3–5 visual feedback channels stacked within ~100 ms.

---

## 2. Current Visual Feedback Inventory

| Effect | Location | Trigger | Notes |
|--------|----------|---------|-------|
| Silver brick crack overlays | `brickCracks.ts` → `fieldView.ts:redrawBricks` | `brickSilverHit` (cell value change) | Procedural line segments, 3 styles. Skipped in `reducedEffects` mode. |
| Owner glow ring (2px) | `skinPainter.ts:paintOwnerGlow` → `fieldView.ts:sync` | Multiplayer, per-ball `owner` | Draws on `ballGfx` under sprite. Skipped in `reducedEffects`. |
| Owner color bar (2px) | `fieldView.ts:sync` (lines 165–168, 180–184) | Multiplayer, per-paddle | Under each paddle. Readability gate — only when ≥2 players on field. |
| Ball tint by owner | `fieldView.ts:sync` (lines 213–214) | Multiplayer, single-ball fields | White-base sprite tinted. No tint when solo. |
| Background tile sprite | `fieldView.ts` constructor (lines 112–120) | Theme background | Darkened with `0x808080` tint. Skipped in `reducedEffects`. |

**No event-driven visual effects exist.** The render pipeline (`FieldView.sync`) is purely state-driven — it reads the snapshot and draws the current frame. Events in `snap.events` are consumed **only by audio** (`sessionAudio.consume`).

---

## 3. Sim Events That Need Visual Feedback

From `shared/protocol.ts:SimEventType` and `roundSim.ts:pushEvent` calls:

| Event | Source | Importance | Current Audio | Current Visual | **Required Visual Channels** |
|-------|--------|------------|---------------|----------------|------------------------------|
| `ballLaunch` | Serve | **Medium** | `launch` SFX | None | Paddle flash, ball squash (launch), subtle screen shake (trauma 0.2) |
| `paddleBounce` | Paddle hit | **Medium** | ❌ (no SFX mapped!) | None | **Hit-stop 0.04s**, paddle squash, ball stretch, screen shake (trauma 0.25), particle spark |
| `brickBreak` | Brick destroyed | **Medium** | `brickHit` (pitched by row) | Cracks only (silver) | **Hit-stop 0.03s**, brick flash white, particle burst (6–12), score pop, screen shake (trauma 0.15–0.3 by row) |
| `brickSilverHit` | Silver hit (not broken) | **Small** | `brickHit` (pitch 0.8) | Crack overlay added | Brick flash (subtle), micro-particles (2–4), no shake |
| `ballLoss` | Ball below field | **Large** | `ballLoss` SFX | None | **Hit-stop 0.1s**, screen shake (trauma 0.7), ball death particles, life-lost flash, paddle shake |
| `capsuleCatch` | Paddle catches capsule | **Medium** | `capsuleCatch` SFX | None | Capsule burst particles, paddle flash, score pop, subtle shake (trauma 0.2) |
| `capsuleEffect` | Capsule activates (E/R/S/M/B/P/L/D/C/?) | **Medium** | `capsuleEffect` SFX | None | Paddle morph animation (E/R), screen flash (B), multiball spawn FX (M) |
| `roundClear` | All bricks cleared | **Large** | `roundClear` SFX | None | **Hit-stop 0.15s**, screen shake (trauma 0.8), celebration particles, round-clear flash, score tally pop |
| `attack` | Attack mode triggered | **Large** | `attack` SFX | None | Screen flash red, trauma 0.6, UI meter pulse |
| `assist` | Assist mode triggered | **Large** | `assist` SFX | None | Screen flash blue, trauma 0.5, UI meter pulse |
| `bossHit` | Doh boss hit | **Medium** | `brickHit` (pitch 0.6) | None | Boss flash white, hit-stop 0.05s, particles, shake (trauma 0.3) |
| `bossDead` | Doh boss defeated | **Large** | `roundClear` SFX | None | **Hit-stop 0.2s**, massive shake (trauma 1.0), explosion particles, victory flash |
| `chainEscalate` | Chain tier (4/7/10) | **Medium** | `chainEscalate` SFX | None | Chain counter pop, screen flash (escalating), trauma 0.3→0.5→0.7 |
| `gameOver` | No lives left | **Large** | `gameOver` music | None | Slow-motion fade, trauma 1.0, final score pop |

**Critical gap:** `paddleBounce` has **no SFX mapping** in `eventMap.ts` — only `brickHit`, `wallHit` (unused), etc. The paddle hit is the *core feel* of a brick-breaker and currently has zero audio or visual feedback.

---

## 4. Recommended Effect Implementations

### 4.1 Architecture: Event-Driven Visual Effects Layer

**Current pipeline:**  
`Sim → Snapshot (events ring) → Audio.consume() + FieldView.sync(state only)`

**Required pipeline:**  
```
Sim → Snapshot (events ring) 
     ├─→ Audio.consume(snap)        // unchanged
     ├─→ VisualEffects.consume(snap) // NEW: processes fresh events → spawns effects
     └─→ FieldView.sync(state)      // unchanged (state render only)
```

**New module:** `src/render/visualEffects.ts`  
- Consumes `Snapshot.events` (same ring buffer audio uses)  
- Spawns/updates: particles, screen shake trauma, hit-stop timers, flash overlays, pop animations  
- Runs in **render callback** (after `audio.consume`, before `FieldView.sync`)  
- Pure Pixi — no sim coupling  
- Respects `reducedEffects` setting (skip particles, reduce shake, disable flash)

### 4.2 Screen Shake — Trauma Model (Per `game-feel` Skill)

**File:** `src/render/cameraShake.ts` (new)

```typescript
// Trauma-based shake on the fieldContainer (visual only, never sim)
export class CameraShake {
  private trauma = 0;
  private readonly decay = 1.3;      // trauma/sec
  private readonly maxOffset = { x: 10, y: 6 }; // px at trauma=1
  private readonly maxRoll = 0.08;   // rad at trauma=1
  private t = 0;
  private readonly container: Container; // the fieldContainer to offset

  constructor(container: Container) { this.container = container; }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number): void {
    if (this.trauma <= 0) { this.container.position.set(0, 0); this.container.rotation = 0; return; }
    this.trauma = Math.max(0, this.trauma - this.decay * dt);
    const shake = this.trauma * this.trauma; // quadratic
    this.t += dt * 30;
    // Smooth pseudo-random via summed sines (NOT rand/frame)
    const nx = Math.sin(this.t * 1.7) * 0.6 + Math.sin(this.t * 2.3) * 0.4;
    const ny = Math.sin(this.t * 2.9) * 0.6 + Math.sin(this.t * 3.1) * 0.4;
    const nr = Math.sin(this.t * 1.1) * 0.6 + Math.sin(this.t * 1.9) * 0.4;
    this.container.position.set(this.maxOffset.x * shake * nx, this.maxOffset.y * shake * ny);
    this.container.rotation = this.maxRoll * shake * nr;
  }

  // Accessibility: multiply all addTrauma calls by settings.shakeScale (0–1)
}
```

**Integration:** One `CameraShake` per `FieldView` (split-screen safe). Updated in render loop with real `dt`.

### 4.3 Hit-Stop / Freeze Frames

**Constraint:** Sim runs fixed 60 Hz in accumulator loop (`loop.ts`). Hit-stop must be **visual-only** — cannot stall the sim.

**Approach:** Render-layer time scale + real-time timer.

```typescript
// src/render/hitStop.ts (new)
export class HitStop {
  private active = false;
  private remaining = 0;
  private readonly onEnd: () => void;

  constructor(onEnd: () => void) { this.onEnd = onEnd; }

  trigger(durationMs: number, timeScale = 0.05): void {
    if (this.active) return; // one at a time
    this.active = true;
    this.remaining = durationMs;
    // Drop render time scale — sim keeps ticking at 60 Hz
    // The loop's onFrameStats gets scaled delta; we need a separate path.
    // Simpler: set a global renderTimeScale read by the render callback.
    RenderTimeScale.set(timeScale);
    // Real-time timeout (unaffected by timeScale)
    setTimeout(() => this.release(), durationMs);
  }

  private release(): void {
    this.active = false;
    RenderTimeScale.set(1);
    this.onEnd?.();
  }

  isActive(): boolean { return this.active; }
}
```

**RenderTimeScale** (new global/module):  
- `set(scale)` — called by `HitStop`  
- `get()` — read by `AccumulatorLoop.render` callback to scale its *internal* delta for animations only  
- **Sim tick loop is untouched** — only visual tweens/particles/shake slow down

**Per-event durations (from feedback-recipes.md):**
- Small (brickBreak): 30–40 ms
- Medium (paddleBounce, capsuleCatch): 40–60 ms  
- Large (ballLoss, roundClear, bossDead): 100–150 ms

### 4.4 Squash & Stretch — Ball & Paddle

**File:** `src/render/squashStretch.ts` (new) — runs on `FieldView` sprites/gfx

```typescript
// Eased "pop" with overshoot (TRANS_BACK equivalent)
export function squashStretchBall(
  ballGfx: Graphics,      // or Sprite
  ballSprite: Sprite | null,
  scaleX: number, scaleY: number,
  duration = 0.15        // seconds
): Promise<void> {
  // Instant squash on impact
  const target = { x: scaleX, y: scaleY };
  const start = { x: ballGfx.scale.x, y: ballGfx.scale.y };
  // ... eased tween with overshoot (BACK ease-out)
  // Conserves volume: stretch X → squash Y, or vice versa
}
```

**Per-event parameters:**
| Event | Ball Squash | Paddle Squash | Duration |
|-------|-------------|---------------|----------|
| `paddleBounce` | X: 1.3, Y: 0.7 | X: 0.9, Y: 1.15 | 150 ms |
| `brickBreak` | X: 1.15, Y: 0.85 | — | 100 ms |
| `wallHit` (side) | X: 0.8, Y: 1.25 | — | 80 ms |
| `wallHit` (top) | X: 1.2, Y: 0.8 | — | 80 ms |
| `ballLaunch` | X: 0.7, Y: 1.4 | Paddle X: 1.1, Y: 0.9 | 180 ms |
| `ballLoss` | X: 1.5, Y: 0.5 (splat) | — | 300 ms + fade |

### 4.5 Particle System — PixiJS `ParticleContainer`

**File:** `src/render/particles.ts` (new)

```typescript
// Pooled ParticleContainer per field (split-screen: one per FieldView)
export class ParticleLayer {
  private container: ParticleContainer;
  private pool: Particle[] = [];
  private active: Particle[] = [];

  // Burst at (x, y) in field units
  burst(x: number, y: number, config: BurstConfig): void { ... }
  
  // Presets per event tier
  static presets = {
    brickBreak: { count: 10, color: 0xffee88, speed: 80, life: 0.4, gravity: 200 },
    brickSilverHit: { count: 4, color: 0xaaaaaa, speed: 50, life: 0.25 },
    paddleHit: { count: 6, color: 0x88ffff, speed: 60, life: 0.3 },
    ballLoss: { count: 20, color: 0xff4444, speed: 120, life: 0.6, gravity: 300 },
    capsuleCatch: { count: 12, color: 0x44ff88, speed: 100, life: 0.5 },
    roundClear: { count: 40, color: 0xffff44, speed: 150, life: 1.0, gravity: -50 }, // rise up
    bossHit: { count: 15, color: 0xff8844, speed: 100, life: 0.5 },
    chainEscalate: { count: 8, color: 0xff44ff, speed: 80, life: 0.4 },
  };
}
```

**Performance:**  
- `ParticleContainer` (WebGL) — batched, no Graphics overhead  
- Pool size: ~200 particles per field (split-screen: 2–4 fields → 400–800 total)  
- `reducedEffects` → halve counts, disable gravity, shorter life

### 4.6 Flash / Tint Effects

**White flash (hit):** Tint sprite/material to white for 1–3 frames, tween back.  
**Color flash (event-tier):** Screen-space overlay quad (full field) with additive blend, tween alpha 1→0.

```typescript
// src/render/flash.ts (new)
export class FlashLayer {
  private readonly gfx: Graphics; // full-field rect, additive blend
  private tween: Tween | null = null;

  flashWhite(intensity = 1, durationMs = 60): void { ... }
  flashColor(color: number, intensity = 1, durationMs = 80): void { ... }
}
```

**Per-event:**
- `brickBreak`: white flash 1 frame (0.016s)
- `paddleBounce`: white flash 2 frames
- `ballLoss`: red flash 100 ms
- `roundClear`: gold flash 150 ms
- `bossDead`: white flash 200 ms + zoom punch
- `chainEscalate`: magenta flash escalating (4→100ms, 7→120ms, 10→150ms)

### 4.7 Score / Event Pop Animations

**File:** `src/render/scorePop.ts` (new)

```typescript
// BitmapText that rises, fades, eases out (BACK ease)
export function spawnScorePop(
  container: Container,
  x: number, y: number,      // field units
  text: string,              // "+50", "×2 CHAIN", "EXTRA LIFE"
  color: number = 0xffff00,
  duration = 1.0
): void { ... }
```

**Triggers:**
- `brickBreak`: "+50" (or tier value) at brick position
- `brickSilverHit`: "+10" (per hit)
- `capsuleCatch`: capsule letter + bonus
- `chainEscalate`: "CHAIN ×2" / "×3" / "×4" at ball position
- `roundClear`: "ROUND CLEAR +5000" center-screen
- `ballLoss`: "-1 LIFE" at paddle
- `attack`/`assist`: mode name at top center

---

## 5. Per-Event Feedback Matrix (Tiered)

| Event | Tier | Trauma | Hit-Stop | Particles | Flash | Squash | Pop | Sound (existing) |
|-------|------|--------|----------|-----------|-------|--------|-----|------------------|
| `paddleBounce` | Medium | 0.25 | 40 ms | 6 sparks | White 2fr | Ball 1.3/0.7, Paddle 0.9/1.15 | — | **ADD: paddleHit SFX** |
| `brickBreak` (row 0–1) | Medium | 0.30 | 30 ms | 10 debris | White 1fr | Ball 1.15/0.85 | +score | `brickHit` (high pitch) |
| `brickBreak` (row 5–6) | Medium | 0.15 | 30 ms | 10 debris | White 1fr | Ball 1.15/0.85 | +score | `brickHit` (low pitch) |
| `brickSilverHit` | Small | 0.08 | — | 4 chips | White 1fr | Ball 1.1/0.9 | +10 | `brickHit` (pitch 0.8) |
| `ballLaunch` | Medium | 0.20 | — | 8 trail | — | Ball 0.7/1.4, Paddle 1.1/0.9 | — | `launch` |
| `ballLoss` | Large | 0.70 | 100 ms | 20 splat | Red 100ms | Ball 1.5/0.5 (splat) | -life | `ballLoss` |
| `capsuleCatch` | Medium | 0.20 | 40 ms | 12 burst | Color 80ms | Paddle 1.1/0.9 | +bonus | `capsuleCatch` |
| `roundClear` | Large | 0.80 | 150 ms | 40 rise | Gold 150ms | — | +bonus | `roundClear` |
| `attack` | Large | 0.60 | — | — | Red 200ms | — | "ATTACK" | `attack` |
| `assist` | Large | 0.50 | — | — | Blue 200ms | — | "ASSIST" | `assist` |
| `bossHit` | Medium | 0.30 | 50 ms | 15 | White 2fr | Ball 1.2/0.8 | — | `brickHit` (pitch 0.6) |
| `bossDead` | Large | 1.00 | 200 ms | 50 explode | White 200ms | — | "BOSS CLEAR" | `roundClear` |
| `chainEscalate` (4) | Medium | 0.30 | — | 8 | Magenta 100ms | — | "×2" | `chainEscalate` |
| `chainEscalate` (7) | Medium | 0.50 | — | 12 | Magenta 120ms | — | "×3" | `chainEscalate` |
| `chainEscalate` (10) | Large | 0.70 | — | 16 | Magenta 150ms | — | "×4" | `chainEscalate` |
| `gameOver` | Large | 1.00 | — | — | Slow fade | — | Final score | `gameOver` music |

---

## 6. Integration Points — Code Locations

### 6.1 Where to Inject Visual Effects

| Location | Current Role | Add Visual Effects Here |
|----------|--------------|-------------------------|
| `src/app/soloSession.ts:398` (render callback) | `audio.consume(latest); views.sync(latest)` | `visualEffects.consume(latest); visualEffects.update(dt); views.sync(latest)` |
| `src/app/mpFlow.ts:732` (host render) | `audio.consume(s); split.sync(local)` | `visualEffects.consume(s); visualEffects.update(dt); split.sync(local)` |
| `src/app/mpFlow.ts:1187` (guest render) | `audio.consume(s); split.sync(snaps)` | `visualEffects.consume(s); visualEffects.update(dt); split.sync(snaps)` |

**Each `FieldView` needs its own `VisualEffects` instance** (split-screen isolation).  
`VisualEffects` owns: `CameraShake`, `HitStop`, `ParticleLayer`, `FlashLayer`, `ScorePopLayer`.

### 6.2 New Files to Create

```
src/render/
├── visualEffects.ts      # Main orchestrator per field
├── cameraShake.ts        # Trauma model
├── hitStop.ts            # Render-layer time scale + real-time timer
├── squashStretch.ts      # Ball/paddle scale tweens
├── particles.ts          # ParticleContainer pools + presets
├── flash.ts              # Full-field additive flash overlay
├── scorePop.ts           # Rising/fading score/event text
└── index.ts              # Exports
```

### 6.3 `FieldView` Changes

- Add `visualEffects: VisualEffects` field (constructed in `FieldView` constructor)
- Expose `getFieldContainer(): Container` for `CameraShake` target
- Expose `getBallSprite(): Sprite | null`, `getBallGfx(): Graphics` for squash/stretch
- Expose `getPaddleSprite(): Sprite | null`, `getPaddleGfx(): Graphics`
- In `sync(snap)`: after state sync, call `this.visualEffects.update(renderDt)`  
  (renderDt from loop's `onFrameStats` or `performance.now()` diff)

### 6.4 `visualEffects.consume(snap)` Implementation

```typescript
consume(snap: Snapshot): void {
  const fresh = snap.events.filter(e => e.tick > this.lastEventTick);
  if (fresh.length) this.lastEventTick = fresh[fresh.length - 1].tick;
  
  for (const event of fresh) {
    switch (event.type) {
      case "paddleBounce": this.onPaddleBounce(event); break;
      case "brickBreak": this.onBrickBreak(event, snap); break;
      case "brickSilverHit": this.onSilverHit(event, snap); break;
      case "ballLaunch": this.onBallLaunch(event); break;
      case "ballLoss": this.onBallLoss(event); break;
      case "capsuleCatch": this.onCapsuleCatch(event, snap); break;
      case "roundClear": this.onRoundClear(event, snap); break;
      case "attack": this.onAttack(event); break;
      case "assist": this.onAssist(event); break;
      case "bossHit": this.onBossHit(event, snap); break;
      case "bossDead": this.onBossDead(event, snap); break;
      case "chainEscalate": this.onChainEscalate(event); break; // triggered via chain counter in sessionAudio
      case "gameOver": this.onGameOver(event); break;
    }
  }
}
```

**Event position data:** Use `event.target` (brick index → field coords) or `snap.balls[0]` / `snap.players[0].paddle` for position.

---

## 7. Multiplayer Considerations

| Concern | Resolution |
|---------|------------|
| **Host-authoritative effects?** | No — visual effects are **local, cosmetic, non-deterministic**. Each device runs its own `VisualEffects` from the same snapshot event ring. Identical snapshots → similar (not bit-identical) particles. |
| **Guest interpolation** | Guest `renderSnapshots` are interpolated; events come from host snapshots (authoritative). `visualEffects.consume` runs on each rendered snapshot — may double-fire if same event appears in consecutive interpolated frames. **Fix:** track `lastEventTick` per `VisualEffects` instance (same as audio). |
| **Split-screen** | One `VisualEffects` per `FieldView` (per local player). Each has own `CameraShake`, `ParticleContainer`. Shake on player 1's field doesn't affect player 2's. |
| **Spectator / remote strip** | `RemoteStrip` shows only numbers — no juice needed. |
| **Rejoin / resync** | On context restore / rejoin, `FieldView.invalidate()` → `VisualEffects.reset()` (clear trauma, particles, tweens). |

---

## 8. Reduced-Effects Mode (Ticket 54) Compatibility

`settings.display.reducedEffects` already exists and is passed to `FieldView`. Extend to `VisualEffects`:

| Effect | `reducedEffects = false` | `reducedEffects = true` |
|--------|--------------------------|-------------------------|
| Screen shake | Full trauma | Trauma × 0.3 (configurable) |
| Hit-stop | Full duration | Duration × 0.5 |
| Particles | Full counts | Counts × 0.3, no gravity, life × 0.5 |
| Flash | Full intensity | Alpha × 0.4, no color flash (white only) |
| Squash & stretch | Full | Disabled (scale = 1) |
| Score pops | Full | Instant (no rise/fade) |

**Accessibility settings to add (per `game-feel` skill):**
- `shakeIntensity: 0–100%` (multiplies all `addTrauma`)
- `flashIntensity: 0–100%` (multiplies flash alpha)
- `disableHitStop: boolean`
- `disableParticles: boolean`

---

## 9. Performance Budget (Split-Screen)

| Metric | Budget | Current | With Juice (est.) |
|--------|--------|---------|-------------------|
| Sim tick (60 Hz) | ≤ 2 ms | ~0.5 ms | ~0.5 ms (unchanged) |
| Render sync (per field) | ≤ 3 ms | ~1.5 ms | ~2.5 ms (+particle update, shake, tweens) |
| Particle update (4 fields × 200) | — | 0 | ~0.8 ms |
| GPU draw calls | — | ~15/field | ~16/field (+1 ParticleContainer) |
| Texture memory | 64 MB | ~2 MB | ~3 MB (particle atlas) |
| **Total frame (4-player split)** | 16.67 ms | ~8 ms | ~12 ms |

**Mitigations if over budget:**
- Reduce particle pool sizes in `reducedEffects`
- `renderEvery = 2` (30 fps render) already handled by perf ladder
- ParticleContainer is GPU-batched — minimal draw call overhead
- Squash/stretch tweens are CPU-cheap (few objects)

---

## 10. Priority Ranking

### Must-Have (Core Feel — 1–2 weeks)
1. **`paddleBounce` SFX + hit-stop + squash + shake + sparks** — the *heartbeat* of the game
2. **`brickBreak` hit-stop + flash + particles + score pop + shake (by row)** — primary action feedback
3. **`ballLoss` hit-stop + heavy shake + death particles + life pop** — failure feedback
4. **Screen shake trauma system** — infrastructure for all impacts
5. **Hit-stop infrastructure** — render-layer time scale + real-time timer

### High Value (Polish — 1 week)
6. **`ballLaunch` squash + subtle shake** — serve feel
7. **`capsuleCatch` burst + paddle flash + pop** — reward feel
8. **`roundClear` celebration (shake + particles + flash + tally pop)** — closure feel
9. **Chain escalation pops + escalating flash/shake** — mastery feedback

### Nice-to-Have (Juice — 1 week)
10. **`bossHit` / `bossDead` unique effects** — boss fight weight
11. **`attack` / `assist` screen flashes + UI pulses** — mode clarity
12. **Wall hit micro-feedback** (shake + squash) — currently no SFX either
13. **Paddle hit SFX** (missing in `eventMap.ts`) — **critical audio bug**

### Polish (Later)
14. **Anticipation wind-up** on ball launch (paddle glow before release)
15. **Trail renderer** for fast balls (after-image)
16. **Vignette/zoom punch** on boss death / round clear
17. **Sound-reactive visual sync** (beat-matched particles) — pairs with `audio-design`

---

## 11. Implementation Order (Suggested)

```
Week 1: Infrastructure
  1. cameraShake.ts + hitStop.ts + RenderTimeScale
  2. visualEffects.ts (orchestrator, consume loop, per-field instance)
  3. Integrate into soloSession.ts + mpFlow.ts render callbacks
  4. Wire reducedEffects + accessibility settings

Week 2: Core Impact Feedback
  5. paddleBounce: hit-stop + squash + shake + particles + ADD SFX mapping
  6. brickBreak: hit-stop + flash + particles + score pop + shake (by row)
  7. ballLoss: heavy hit-stop + shake + death particles + life pop

Week 3: Reward & Closure Feedback
  8. ballLaunch: squash + shake
  9. capsuleCatch: burst + flash + pop
  10. roundClear: celebration suite
  11. chainEscalate: escalating pops

Week 4: Boss & Mode Feedback
  12. bossHit / bossDead
  13. attack / assist flashes
  14. Wall hit micro-feedback (add SFX mapping too)

Ongoing: Tuning by playtest — adjust trauma, durations, particle counts per tier
```

---

## 12. Reference: Classic Arkanoid Feel Benchmarks

| Game | Paddle Hit Feel | Brick Break Feel | Ball Loss Feel |
|------|-----------------|------------------|----------------|
| **Arkanoid (1986)** | Sharp "thwok", 2-frame freeze, ball squash | Pitch by row, 1-frame flash, debris particles | Long freeze, screen shake, ball shatters |
| **Breakout (1976)** | Minimal — just beep | Beep pitch by row, brick vanishes | Life lost sound, pause |
| **Shatter (2009)** | Heavy impact, screenshake, particles | Explosive, physics debris, chain UI | Dramatic slow-mo, shockwave |
| **Ricochet (2001)** | Paddle glow, ball stretch | Brick glow + particles, score pop | Ball trails, life counter animation |

**Target:** Between Arkanoid (crisp) and Shatter (juicy) — **responsive, not noisy**.

---

## 13. Appendix: Missing Audio Mapping (Bug)

`eventMap.ts` maps these events → SFX:
- `brickBreak` → `brickHit` ✅
- `brickSilverHit` → `brickHit` (pitch 0.8) ✅
- `ballLaunch` → `launch` ✅
- `ballLoss` → `ballLoss` ✅
- `capsuleCatch` → `capsuleCatch` ✅
- `roundClear` → `roundClear` ✅
- `attack` → `attack` ✅
- `assist` → `assist` ✅
- `bossHit` → `brickHit` (pitch 0.6) ✅
- `bossDead` → `roundClear` ✅

**MISSING:** `paddleBounce` → **no SFX** (should map to `paddleHit`)

**UNUSED SFX:** `wallHit` (defined in engine/synth, never mapped) — map to top/side wall bounces.

**Fix in `eventMap.ts:sfxForEvent`:**
```typescript
case "paddleBounce":
  return { id: "paddleHit" };  // ADD THIS
case "wallHit": // need to emit this event from roundSim.ts
  return { id: "wallHit" };
```

---

*End of audit. Ready for implementation planning.*