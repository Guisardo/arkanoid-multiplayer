# Sim epoch in snapshots: replaced sims are told apart explicitly, not inferred from ticks

Every snapshot carries a u16 **Sim epoch** (CONTEXT.md), and the composer bumps it for each field whose sim is replaced: round advance, field reset, Continue, Restart. Ticks restart at 0 with every new sim, so "newest tick" stops being a usable order across the replacement. Before this, render effects and audio went silent on Round 2, and guests froze on the previous round's last frame (#151, #155). Consumers now order by epoch first and tick second: the event watermark resets on a newer epoch, and the interpolator flushes on one. This required a wire protocol bump (v5) and can't be undone without another.

## Considered Options

- **Infer a rebuild from the tick going backwards (or the round changing).** Rejected. When the guest interpolator is starved it grows its delay, so it can return an older snapshot, which also makes the tick go backwards. Each such false reset replays up to 8 events of FX and SFX. A reordered packet and a rebuilt sim look the same if all you have is the tick. Round alone misses Continue and field resets, where the round doesn't change.
- **Keep one tick counter running across rebuilds.** Rejected. Ticks belong to each sim and drive deterministic behaviour (capsule scripts, heartbeats). Sharing one across sims would couple every sim to its composer.

## Consequences

- The step that triggers a rebuild carries its events into the new epoch's ring, restamped to tick 0 (`sim/fieldEpoch.ts`). Without that, the CLEAR is swapped out before any consumer reads a snapshot. The carry is applied to the snapshot, not stored in the sim's own ring, so composer bookkeeping that reads the raw ring (Assist and Attack meter income) never counts an event twice.
- The carried events and the new sim's first-step events can share tick 0, so the watermark counts how many events it has already taken at that tick, not just the newest tick.
- Epochs wrap at 2^16 and are compared with serial-number arithmetic, so a late packet from an older epoch is dropped rather than read as new.
- Input is ordered by **Match tick** (CONTEXT.md), never by a sim's tick (#155). Input frames, the host delay queue and each snapshot's `inputAcks` all count match ticks, which run across every epoch. The guest predictor reconciles against the acked match tick, because comparing it with `snapshot.tick − D` stops lining up the moment a sim is replaced. On a newer epoch the predictor also re-seeds from the new sim's paddle, so the new round starts with a clean cut.
- An interpolator flush on a newer epoch isn't network starvation, so it resets the buffer delay to nominal and doesn't grow it while the new epoch's buffer fills.
