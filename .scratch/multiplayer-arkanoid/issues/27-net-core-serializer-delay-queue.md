# 27 — Net core: snapshot serializer + delay queue

**What to build:** The net module's data plumbing, exercised loopback with no network: binary (ArrayBuffer/DataView) Snapshot serializer/deserializer round-trip — tick, phase, per-player input acks, kinematics (paddles, balls, falling capsules), snapped state (brick grid, scores, meters, effect timers), event ring buffer (last 8: type, source, target, tick) — full state every broadcast tick, no deltas, ≈600 B target. The uniform tick-D delay queue: host-local players' frames enter the same queue as guest frames, host skips only the network hop. Input redundancy window ~10 ticks; host dedupes by (player, tick). Driven by the sim in Vitest — no WebRTC yet.

**Blocked by:** 23 — Tracer bullet: Solo round playable.

**Status:** resolved

- [x] Snapshot serialize → deserialize round-trips losslessly (property/fuzz-tested across state shapes)
- [x] Serialized Snapshot ≈600 B for a representative 4-player state (budget-checked in test)
- [x] Event ring buffer carries last 8 events with type, source, target, tick
- [x] Delay queue applies tick-D uniformly; D configurable; host-local path skips only the network hop
- [x] Input redundancy window ~10 ticks; host dedupes by (player, tick) — duplicate and out-of-order frames handled
- [x] All net-core tests run headless in Vitest with the real sim, zero network dependencies

