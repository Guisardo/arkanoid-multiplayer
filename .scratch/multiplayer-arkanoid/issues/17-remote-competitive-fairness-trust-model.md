# Remote competitive fairness: trust model

Type: grilling
Status: resolved
Blocked by: 04, 08

## Question

What is the trust model for competitive remote play — which host misbehaviors are accepted, detected, or prevented?

The host is a player's browser tab with full authoritative state (ADR 0002): it can tamper with state, fabricate other players' inputs, withhold or delay snapshots, and alter scores. Free-infra constraints rule out a trusted server. Decide: what guest-side sanity validation (if any) is worth building; what cheating is accepted as unavoidable in a P2P host-authoritative game; whether any misbehavior warrants kick/refusal UX.

HITL. Invoke /grilling and /domain-modeling.

## Answer

Resolved 2026-09-01 via grilling (8 questions, all recommendations accepted). Recorded as ADR: [docs/adr/0003-trust-the-host.md](../../../docs/adr/0003-trust-the-host.md).

- **Trust stance (Q1):** trust the host fully — no guest-side plausibility checks, no warnings, no enforcement. Enforcement impossible (free infra, no trusted server); detection rejected for false-positive noise on honest hosts (catch-up cap makes paddle deltas legitimately exceed Vmax×interval; 30 Hz snapshots over 60 Hz sim make score jumps routine; snapping looks like teleporting). Spec carries an explicit accepted-risks section.
- **Structural validation, both directions (Q2):** mandatory protocol behavior, not anti-cheat. Host: clamp guest axes to `[-1..1]`, ignore unknown action types, dedupe by (player, tick), cap input-frame processing rate. Guest: malformed binary snapshot or control-channel JSON = protocol error → clean session-end screen ("Connection corrupted — session ended"), never a crash.
- **Kick (Q3):** host-only, both moments. Lobby kick removes before start; mid-session kick reuses removal semantics (competitive = field eliminated/loss, coop = slot gone, not revivable). Social feature, not anti-cheat.
- **Join acceptance (Q4):** auto-accept into lobby; unwanted joiner handled by host kick. Approval prompt rejected — "Player N" default names make strangers indistinguishable from friends, and friction costs every legit join. Mid-game join already refused (ticket 06).
- **Accepted risks (Q6):** spec section, three subsections — host: state tampering, score alteration, input fabrication, snapshot withholding/delaying (bounded by UX only), arbitrary kick, modded host; guest: modded client perfect play (accepted), input flooding (rate cap + dedupe), input withholding (stall decay), rejoin spam (held-slot + 90 s window only), display tampering (self-harm); stranger: room-code guessing (31⁵ entropy, no listing, kick on landing).
- **ADR 0003 (Q7):** trust stance recorded — hard to reverse (no guest validation layer ever built), surprising without context, real trade-off (detection rejected).
- **Glossary (Q8):** Kick (Session section) and Signaling (Netcode section) added to CONTEXT.md.

**Gap surfaced:** signaling — how a room code finds the host and exchanges SDP/ICE on free infra — was uncovered by any ticket or fog entry. New research ticket created: [Free signaling for room-code join](18-free-signaling-room-code-join.md).
