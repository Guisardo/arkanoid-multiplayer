// ADR 0006: a minimal object pool for simulation objects. The sims used to
// `push({...})` / `splice(...)` balls, capsules and boss projectiles, which
// churns the GC in long sessions (33-round episodes, long matches). A pool
// keeps a free list so steady-state play allocates nothing.
//
// Contract (the ADR's known trade-off): the `resetFn` MUST clear every field
// of `T`. A missed field silently leaks the previous occupant's state, so
// `tests/sim/pool.test.ts` pins the reset functions exported by
// `sim/simState` and `sim/boss` against their field lists.
//
// Release exactly once per acquire — the pool does not track identity, so a
// double release would hand the same object out twice.
export class Pool<T> {
  private readonly free: T[] = [];
  private readonly createFn: () => T;
  private readonly resetFn: (obj: T) => void;
  /** Objects handed out and not yet released (never negative). */
  private live = 0;

  constructor(createFn: () => T, resetFn: (obj: T) => void) {
    this.createFn = createFn;
    this.resetFn = resetFn;
  }

  /**
   * Take an object. Exhaustion is a **grow**, not a failure: when the free
   * list is empty a new object is created, so a mis-sized prewarm costs an
   * allocation but never a lost ball. Prewarming is therefore a warm-up
   * optimisation, not a capacity limit.
   *
   * The returned object is always fully reset (freshly created ones come
   * zeroed, reused ones go through `resetFn` on release).
   */
  acquire(): T {
    this.live++;
    const reused = this.free.pop();
    return reused ?? this.createFn();
  }

  /** Return an object to the free list, resetting it first. */
  release(obj: T): void {
    this.resetFn(obj);
    this.free.push(obj);
    // `liveCount` is observability, not an integrity check: a double release
    // would hand the same object out twice, and no counter here can prevent
    // that. Clamping at zero keeps the reported number meaningful instead of
    // letting a double release read as "more live than exist", which is the
    // symptom you would actually look for.
    if (this.live > 0) this.live--;
  }

  /** Seed the free list with `count` fresh objects (no-op for count <= 0). */
  prewarm(count: number): void {
    for (let i = 0; i < count; i++) this.free.push(this.createFn());
  }

  /** Objects ready to hand out without allocating. */
  get available(): number {
    return this.free.length;
  }

  /** Objects currently handed out. */
  get liveCount(): number {
    return this.live;
  }
}
