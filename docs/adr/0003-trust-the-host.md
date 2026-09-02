# Trust the host: no guest-side misbehavior enforcement

The host is a player's browser tab with full authoritative state (ADR 0002), and free-infra constraints rule out any trusted server — so guest-side enforcement of host misbehavior is impossible by construction. We decided to trust the host fully: no guest-side plausibility checks, no "host data inconsistent" warnings, no enforcement layer. The spec carries an explicit accepted-risks section so builders know the omissions are deliberate.

## Considered Options

- **Light guest-side detection** — plausibility checks (paddle delta > Vmax, impossible score jumps, lives up without event) with a warning badge. Rejected: legitimate mechanics make "impossible-looking" data routine — the 5-tick catch-up cap lets paddle deltas legitimately exceed Vmax×interval, 30 Hz snapshots over a 60 Hz sim make scores jump two breaks at once, and grid/state snapping looks like teleporting. Detection would generate false positives on honest hosts while stopping zero cheaters, eroding trust in working sessions.
- **Guest enforcement** (refuse bad snapshots, self-authoritate) — rejected: breaks the host-authoritative star (ADR 0002).

## Consequences

- **Structural validation is still mandatory, both directions** — not anti-cheat, robustness: host clamps guest input axes to `[-1..1]`, ignores unknown action types, dedupes by (player, tick), and caps input-frame processing rate; guests treat malformed binary snapshots or control-channel JSON as protocol errors ending the session cleanly ("Connection corrupted — session ended"), never a crash.
- **Accepted host misbehaviors** (documented in the spec's accepted-risks section): state tampering, score alteration, fabricating/altering guest inputs, snapshot withholding/delaying (bounded only by UX: ~1 s blind banner, ~10–15 s session-over), arbitrary kick, modded host client (perfect play).
- **Guest misbehaviors bounded by protocol, not trust:** input flooding (rate cap + dedupe), input withholding (stall decay to 0 axis), rejoin spam (valid only for held slot within the 90 s rejoin window), modded client perfect play (accepted — humanness is unverifiable), client-side display tampering (self-harm only, zero authority).
- **Strangers guessing room codes** (31⁵ ≈ 28.6 M combinations, no public listing) are handled socially: lobby join is auto-accept, and the host can kick — lobby kick removes before start; mid-session kick follows the existing removal semantics (competitive = field eliminated/loss, coop = slot gone, not revivable). Kick is host-only, never a guest power.
