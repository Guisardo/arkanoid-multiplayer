# ADR 0009: Visual Effects Orchestrator

**Status**: Accepted  
**Date**: 2026-09-30  
**Related**: #67, #93, #94, #95, #96, #108, #109

## Context

Game feel audit (`docs/game-feel-audit.md`):
- **Audio complete**, visual minimal (only brick cracks + owner cues)
- **14 events need layered visual feedback**
- Critical: `paddleBounce` has **no SFX mapping** in `eventMap.ts`
- No centralized visual effects system — effects would be scattered across render code

Required effects (from audit §4):
| Effect | Type | Implementation |
|--------|------|----------------|
| Screen shake | Trauma-based | `CameraShake` offsets `fieldContainer` |
| Hit-stop | Frame freeze | Single-frame `timeScale = 0` |
| Particles | `ParticleContainer` | 7 event presets, ~200 particles/field |
| Squash & stretch | Sprite scale | `Sprite.scale` on ball/paddle |
| Flash | Additive overlay | Full-field quad (Graphics or texture) |
| Score pops | `BitmapText` | Rising text with fade |

Particle atlas (8 variants, grayscale, tinted at runtime) and MSDF font atlas needed (ADR 0004).

## Decision

Introduce a **`VisualEffects` orchestrator** as a **single authoritative source** for all visual feedback, decoupled from simulation and render.

### Architecture

```
Simulation (src/sim/)
    │ emits SimEvent (type, position, magnitude, owner, ...)
    ▼
VisualEffects (src/render/visualEffects.ts)
    ├─ CameraShake (trauma accumulator, per-field)
    ├─ HitStop (frame freeze coordinator)
    ├─ ParticleSystem (ParticleContainer + atlas)
    ├─ FlashLayer (additive full-field quad)
    ├─ SquashStretch (sprite scale animator)
    └─ ScorePopManager (BitmapText pool)
    ▼
Render (FieldView.sync()) — reads effect state, applies to scene
```

### API

```typescript
// src/render/visualEffects.ts
class VisualEffects {
  constructor(private fieldView: FieldView) {}

  // Called by sim on each event
  onSimEvent(event: SimEvent): void {
    switch (event.type) {
      case 'brickBreak':
        this.particles.emit('brickBreak', event.pos, event.color);
        this.squashStretch.hit(event.owner);
        this.flash.flash(0.05); // 50ms white flash
        this.scorePop.spawn(event.pos, event.points);
        break;
      case 'paddleHit':
        this.hitStop.freeze(1); // 1 frame
        this.squashStretch.paddleHit(event.owner);
        this.particles.emit('paddleHit', event.pos);
        break;
      case 'ballLoss':
        this.cameraShake.addTrauma(0.3);
        this.particles.emit('ballLoss', event.pos);
        break;
      case 'capsuleCatch':
        this.particles.emit('capsuleCatch', event.pos, event.capsuleColor);
        this.scorePop.spawn(event.pos, 100, 'capsule');
        break;
      case 'roundClear':
        this.cameraShake.addTrauma(0.6);
        this.particles.emit('roundClear', { x: FIELD_W/2, y: FIELD_H/2 });
        break;
      // ... 7 more events
    }
  }

  // Called each frame by FieldView.sync()
  update(dt: number): void {
    this.cameraShake.update(dt);
    this.hitStop.update(dt);
    this.particles.update(dt);
    this.flash.update(dt);
    this.squashStretch.update(dt);
    this.scorePop.update(dt);
  }

  // Called by FieldView.sync() to apply to Pixi scene
  applyToScene(): void {
    this.cameraShake.apply(this.fieldView.fieldContainer);
    this.flash.apply(this.fieldView.flashLayer);
    this.squashStretch.apply(this.fieldView.paddleSprite, this.fieldView.ballSprite);
    this.scorePop.apply(this.fieldView.uiContainer);
  }
}
```

### Particle System

- Single `ParticleContainer` per field (or shared across split-screen)
- Atlas: 16×16 grayscale variants (circle, square, triangle, star, streak, debris, splat, ring)
- 7 presets from audit (brickBreak, brickSilverHit, paddleHit, ballLoss, capsuleCatch, roundClear, bossHit, chainEscalate)
- Pool: ~200 particles/field (split-screen: 400-800 total)

### Integration Points

1. **Sim** emits `SimEvent` (already exists: `duel.ts:39-40`, `sharedField.ts:39-40`, `roundSim.ts:42-43`)
2. **Session** passes events to `VisualEffects.onSimEvent()` (in `loop.ts` after sim step)
3. **FieldView.sync()** calls `visualEffects.update(dt)` + `visualEffects.applyToScene()`
4. **Reduced-effects mode** → `VisualEffects` skips particles/flash/shake (keeps hit-stop, squash)

## Consequences

**Positive:**
- **Single source of truth** for all visual feedback
- **Decoupled** from sim (events in, pixels out) and render (applyToScene)
- **Testable** — can verify events produce correct effect calls without Pixi
- **Configurable** — intensity sliders, reduced-effects mode, accessibility
- **Extensible** — new events = one `case` in `onSimEvent`

**Negative:**
- New module (`src/render/visualEffects.ts` ~300 lines)
- Must wire into all 6 session types (solo, versusBots, duel, race, attack, sharedField, assist)
- Particle atlas + MSDF font required first (ADR 0004)

## Alternatives Considered

- **Scatter effects in `FieldView`** — rejected: duplicates logic, hard to tune, not testable
- **Event-driven in sim** — rejected: sim should not know about visuals
- **Separate class per effect** — rejected: orchestrator coordinates cross-effect timing (shake + flash + particles together)

## Validation

Game feel audit (#67): "New VisualEffects orchestrator recommended with trauma-based shake, hit-stop, particles, squash/stretch, flashes, score pops. Infrastructure + 4-week implementation plan." This ADR defines the infrastructure.