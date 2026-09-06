# 48 — Remote pause/quit coordination

**What to build:** Pause and quit semantics across devices. Coop remote: any player requests → host pauses the sim for all ("Paused by P3"); requester cancels, any player resumes; downed players may pause. Competitive remote: no pause — Esc/Start/touch pause icon opens quit-confirm overlay only; sim never pauses behind it; quit = removal, scored as loss. Local split-screen pause always pauses the whole device view (from mode tickets — kept green remotely).

**Blocked by:** 45 — Remote play.

**Status:** resolved

- [x] Coop: any remote player's pause request pauses the sim for all, with "Paused by [name]" header
- [x] Requester can cancel; any player can resume; downed players can pause
- [x] Competitive remote: pause inputs open quit-confirm only; sim provably never pauses
- [x] Quit from overlay = removal scored as loss (competitive) / slot gone (coop)
- [x] Local split-screen pause still pauses the whole device view (regression-checked)

## Answer

Shipped as PR #33 (squash-merged 2026-09-06).

**Coop remote pause:** `app/pauseCoord.ts` (pure reducer + coop-only mode gate). Any player (downed included) requests → host applies authoritatively → `paused {by}` broadcast → both sides render the "Paused by [name]" overlay (`ui/pauseOverlay.ts`). The pauser cancels; any player resumes (overlay Resume routes through the same resume path). `hostGame.setPaused` freezes the sim (no step, no queue drain, no stall decay, guest input dropped) while snapshots keep broadcasting at cadence — ticket 47's guest silence monitors never trip on a legit pause.

**Competitive remote:** pause inputs (Esc / rebindable menu key / gamepad Start, polled at 100 ms in main.ts) open the quit-confirm overlay ONLY (`ui/quitConfirm.ts`) — the mode gate makes the pause path unreachable and the wiring test proves snapshot ticks keep advancing behind the overlay. Quit = removal scored as loss via `removePlayers`, **no rejoin hold** (deliberate quitter's rejoin refused).

**Coop quit:** same removal path — slot gone, not revivable.

**Local split-screen pause regression:** solo Esc still freezes the whole device view (overlay → loop stopped → resume continues cleanly) — explicit regression test.

**Wire:** `pause-request`/`pause-cancel`/`resume` (guest→host), `paused {by}`/`resumed` (host→all), `quit-match` (guest→host); player index structurally validated 0–3 (ADR 0003).

Deviations: Settings-from-pause deferred (not in checklist); touch pause icon mp-wiring deferred to 53 (routes through the same `localPausePressed()` seam).

823 unit tests (23 new), 4 e2e, lint, typecheck, build, codecov project+patch, CodeFactor — all green.



