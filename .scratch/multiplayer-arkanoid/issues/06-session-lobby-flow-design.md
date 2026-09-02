# Session & lobby flow design

Type: grilling
Status: resolved

## Question

How does a session flow from lobby to game and back?

Design: room-code create/join UX; mixing split-screen + remote players in one session (e.g. 2 local on host device + 2 remote); lobby state (mode select, level select, ready checks, player slots); late-join policy; disconnect/reconnect handling under host-authoritative P2P (does the session die when the host drops? rejoin windows?); flow between rounds (rematch, return to lobby).

HITL. Invoke /grilling and /domain-modeling. Consult Research: free WebRTC infra validation if resolved.

## Answer

Resolved 2026-08-31 via grilling (12 questions, all recommendations accepted).

**Landing & room code**: First screen = Create room / Join room. Room code = 5 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no lookalikes). Create shows code large; Join = 5 auto-advancing entry boxes. No accounts, no persistence — code is the only entry.

**Local players**: Devices add a second local player in the lobby via "Add local player" (max 2/device, session cap 4). Local pair = one device slot, two player entries. Addable any time before start.

**Configuration**: Host-only. Guests see live read-only config panel. Config change resets all ready checks.

**Ready & start**: Every player (incl. host's locals) marks ready; host's Start enabled only when all ready. Start → synchronized 3-2-1 countdown → serve.

**Late-join**: None mid-game. Code entry during game → "Game in progress" message. Empty slots stay empty.

**Host disconnect**: Session dies for all — no host migration (see ADR 0001). Guests get "Host left — session ended" screen.

**Guest disconnect & rejoin**: 90s rejoin window. Re-enter same code → auto-rejoin held slot, resync from host snapshot. During window the paddle freezes in place while play continues (ball lost = life lost as normal). Expiry → player removed: competitive = field eliminated (loss), coop = slot gone, not revivable. Removed players can't return that match.

**Between rounds**: Competitive end-of-match screen (scores, winner) → Rematch (same config, all auto-ready) / Return to lobby / Quit. Coop: level clear → auto-transition to next level, no lobby stop; game over or range cleared → end screen → Return to lobby / Quit.

**Room lifetime**: Room lives until host closes it (Quit or tab close). Same code whole session. New devices may join the lobby between matches (lobby-join ≠ late-join); freed slots open.

**Pause**: Competitive = no pause. Coop = any player requests pause → host pauses sim for all ("paused by P3"); requester cancels, host unpauses. Local split-screen pause always pauses the whole device view.

**Mode validation**: Mode picker disables variants invalid for current player count (Duel greyed unless exactly 2; all need ≥2). Mode pick = config change → ready reset.

**Lobby joiner ready state**: New between-match joiner starts unready; existing players keep ready state; start gate requires all ready including joiner.

Constraints for Netcode sync architecture (ticket 08): 90s rejoin window with slot hold + snapshot resync; host death = session death; pause broadcast in coop; countdown sync at start.
