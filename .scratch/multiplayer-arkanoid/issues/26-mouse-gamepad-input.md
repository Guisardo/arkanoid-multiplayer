# 26 — Mouse + gamepad input

**What to build:** Mouse and gamepad as full input methods alongside keyboard. Mouse: paddle chases the pointer at full speed beyond a small dead band (binary ±1/0, max-speed parity with keyboard), click = launch, HUD panel clickable, wheel unmapped. Gamepad: left stick (0.2 radial deadzone) and d-pad both always live — stick beyond deadzone wins, no summing; A/Cross launch, LB/RB cycle target, X/Y/B/RT fire (4 slots), Start pause/menu; mid-game gamepad disconnect → input idle, player stays in session. Solo mode: both keyboard keysets drive P1 (from 23, kept green).

**Blocked by:** 23 — Tracer bullet: Solo round playable.

**Status:** ready-for-agent

- [ ] Mouse-chase reaches the same max paddle speed as keyboard (parity unit-testable at the Input frame seam)
- [ ] Mouse click launches; HUD panel clickable; wheel does nothing
- [ ] Gamepad stick proportional with 0.2 radial deadzone; d-pad live simultaneously, stick beyond deadzone wins, never summed
- [ ] All gamepad buttons per spec mapped: launch, cycle, 4 fire slots, Start
- [ ] Gamepad disconnect mid-game → paddle input idle, session continues, reconnect resumes control
- [ ] All methods emit identical Input frame shape — sim cannot tell which device produced a frame
