# 48 — Remote pause/quit coordination

**What to build:** Pause and quit semantics across devices. Coop remote: any player requests → host pauses the sim for all ("Paused by P3"); requester cancels, any player resumes; downed players may pause. Competitive remote: no pause — Esc/Start/touch pause icon opens quit-confirm overlay only; sim never pauses behind it; quit = removal, scored as loss. Local split-screen pause always pauses the whole device view (from mode tickets — kept green remotely).

**Blocked by:** 45 — Remote play.

**Status:** ready-for-agent

- [ ] Coop: any remote player's pause request pauses the sim for all, with "Paused by [name]" header
- [ ] Requester can cancel; any player can resume; downed players can pause
- [ ] Competitive remote: pause inputs open quit-confirm only; sim provably never pauses
- [ ] Quit from overlay = removal scored as loss (competitive) / slot gone (coop)
- [ ] Local split-screen pause still pauses the whole device view (regression-checked)
