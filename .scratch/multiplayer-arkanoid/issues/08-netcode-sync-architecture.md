# Netcode sync architecture

Type: grilling
Status: resolved
Blocked by: 02, 06, 14

## Question

How is game state synchronized across devices?

Decide: host-authoritative state broadcast vs input relay; tick rate; prediction/interpolation for remote paddles and the ball; how the host's second local player is handled; message protocol shape; latency handling for competitive fairness; packet-loss behavior. Informed by Research: free WebRTC infra validation and Session & lobby flow design.

HITL. Invoke /grilling and /domain-modeling; record the outcome as an ADR (hard to reverse, real trade-offs).

## Answer

Resolved over three grilling rounds; ticket 14 (Research: input sync & fairness techniques) pre-decided the sync model, tick rates, prediction/interpolation, input delay, and paddle-speed normalization — this ticket locked the remaining protocol decisions. Recorded as ADR: [docs/adr/0002-host-authoritative-netcode.md](../../../docs/adr/0002-host-authoritative-netcode.md).

- **Sync model (from ticket 14):** host-authoritative input relay + state broadcast — guests send 60 Hz input frames (unreliable+redundant game channel), host simulates fixed 60 Hz, broadcasts 30 Hz snapshots (60 Hz for Duel). Lockstep/rollback rejected.
- **Host-local players (Q1):** input frames enter the same tick-D delay queue as guest frames — uniform pipeline for every player; host device skips only the network hop.
- **Channels (Q2):** two per guest — game channel (unreliable, unordered: input frames guest→host, snapshots host→guest) + control channel (reliable, ordered: lobby, rejoin, pause, version handshake).
- **Wire format (Q3):** binary (ArrayBuffer + DataView) on game channel; JSON on control channel. Full binary snapshot ≈ 600 B ≈ 18 KB/s/guest at 30 Hz — fits the ~45 KB/s budget.
- **Snapshot content (Q4):** full snapshot every broadcast tick, no deltas — tick number, phase, per-player input acks, kinematics (paddles, balls, falling capsules), snapped state (brick grid, scores, meters, effect timers), event ring buffer (last 8 events: type, source, target, tick) for one-shot visuals.
- **Snapshot loss (Q5):** no redundancy — sequence numbers + adaptive interpolation buffer (latest − ~2.5 intervals) absorbs gaps.
- **Disconnect detection (Q6):** DataChannel close OR app heartbeat (guest ping every 5 s, drop at ~10–15 s silence), whichever first → opens 90 s rejoin window.
- **Input redundancy window (Q7):** guest bundles all unacked frames from last ~10 ticks into every packet; host dedupes by (player, tick). **Validate after prototype.**
- **Input stall decay (Q8):** host holds last axis ≤ 10 missing ticks, then decays axis to 0 — stalled paddle stops, never runs away.
- **Guest blind period (Q9):** local prediction continues, remote entities freeze, reconnect banner after ~1 s snapshot silence; session-over at control-channel close or ~10–15 s silence.
- **Rejoin (Q10):** join-with-original-player-id on control channel → host validates held slot → rejoin-ack + full snapshot → guest rebuilds scene, wipes prediction history.
- **Version handshake (Q11):** protocol version int in join handshake; mismatch → join refused, "refresh your browser".
- **Interpolated vs snapped (Q12):** interpolate kinematics only; snap grid/scores/meters/timers/phase to latest snapshot.
- **Host overload (Q13):** catch-up cap 5 sim ticks/render frame; sustained overload → slow-motion degradation, snapshots keep flowing at 30 Hz wall-clock. **Warn player when throttling detected — validate in prototype.**
- **All-local sessions (Q15):** D = 0 when zero remote players; frames enter sim directly. Mixed sessions: uniform D for all.
- **Discrete events (Q14):** event ring buffer in snapshot (see Q4) — state-diff derivation rejected as fragile, loses attribution.

### Prototype amendments (Game-feel prototype, ticket 16)

- **Q7 input redundancy window ~10 ticks: validated** — no disruption at 5% loss / 1-tick jitter; playable at 30% loss.
- **Q13 overload policy: validated** — cap 5 + slow-motion + banner engages and recovers cleanly; banner reads as warning.
- **Prediction (from ticket 14) sharpened:** reconcile = direct per-tick compare, snap-to-authoritative, error folded into a display offset decaying ~0.5 s. Prediction must respect every sim constraint (walls, shared-field slice, duel other-paddle) or the display settles short of the authoritative position.
- **Host renders authoritative state; interpolation is guest-view only** — host-side interpolated drawing is stale by construction; do not use it on the host device.
