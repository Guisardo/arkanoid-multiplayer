# ADR 0006: Object Pooling for Simulation Objects

**Status**: Accepted  
**Date**: 2026-09-30  
**Related**: #78, #102

## Context

Current allocation patterns (`src/sim/duel.ts`, `src/sim/sharedField.ts`, `src/sim/roundSim.ts`, `src/sim/boss.ts`):

| Object Type | Allocation Pattern | Pooling |
|-------------|-------------------|---------|
| Balls | `balls.push({...})` on multiball; `splice` on loss | **None** |
| Capsules | `capsules.push({...})` on script trigger; `splice` on catch/expire | **None** |
| Boss Projectiles | `projectiles.push({...})` on fire; `splice` on cull/contact | **None** |
| Sim Events | Ring buffer of 8 (manual `push` + `shift`) | Manual ring buffer |
| Bricks | Flat `number[]` (208 cells), mutated in place | Implicit (fixed array) |
| Particles | **No particle system exists** | N/A |

Typical max concurrent: ≤9 balls, ≤20 capsules, ≤3 boss projectiles. Low allocation pressure but **GC churn in long sessions** (episode 33 rounds, multiplayer matches).

No pooling infrastructure exists.

## Decision

Implement **lightweight object pools** for `BallState`, `CapsuleState`, `BossProjectile` using a reusable `Pool<T>` pattern.

### Implementation

```typescript
// src/sim/pool.ts
export class Pool<T> {
  private free: T[] = [];
  private createFn: () => T;
  private resetFn: (obj: T) => void;

  constructor(createFn: () => T, resetFn: (obj: T) => void) {
    this.createFn = createFn;
    this.resetFn = resetFn;
  }

  get(): T {
    return this.free.pop() ?? this.createFn();
  }

  release(obj: T): void {
    this.resetFn(obj);
    this.free.push(obj);
  }

  prewarm(count: number): void {
    for (let i = 0; i < count; i++) this.free.push(this.createFn());
  }
}
```

**Usage in sims:**
```typescript
// In RoundSim/Duel/SharedField constructor:
this.ballPool = new Pool(
  () => ({ x: 0, y: 0, vx: 0, vy: 0, radius: 3, owner: -1, ... }),
  (b) => { b.x = b.y = b.vx = b.vy = 0; b.owner = -1; /* reset all fields */ }
);
this.ballPool.prewarm(12); // 3 players × 3 multiball + buffer

// Spawn:
const ball = this.ballPool.get();
ball.x = ...; ball.vx = ...;
// Despawn:
this.ballPool.release(ball);
```

Apply same pattern to `CapsuleState` (prewarm 24) and `BossProjectile` (prewarm 8).

**Do NOT pool:**
- Bricks (already fixed array)
- Events (ring buffer is fine)
- Particles (future: `ParticleContainer` manages its own pool)

## Consequences

**Positive:**
- Zero GC allocations for sim objects after warmup
- Predictable memory profile in long sessions
- Simple, testable pattern (no external deps)
- Works with existing array-based iteration (`balls` array holds pooled objects)

**Negative:**
- Manual `resetFn` must reset all fields (bug risk if missed)
- Slightly more verbose spawn/despawn code
- Pool size tuning needed (prewarm too small = allocations anyway)

## Alternatives Considered

- **No pooling** — rejected: GC churn visible in 30+ min sessions (perf audit)
- **Generic `object-pool` npm package** — rejected: extra dep, no benefit over 30-line impl
- **Pool all objects** — rejected: bricks/events don't need it; particles handled by `ParticleContainer`

## Validation

Perf audit (#78): "Low allocation pressure but no pooling infrastructure; GC churn in long sessions." Pooling eliminates this.