# 46 — Guest prediction + stall decay

**What to build:** Guest-side responsiveness: local paddle only — shadow sim + input history; reconcile = direct per-tick compare, snap to authoritative, fold difference into a display offset decaying ~0.5 s. Prediction must clamp to every sim constraint (walls, shared-field slice, Duel other-paddle-as-wall) or the display settles short. Input stall decay: host holds last axis ≤10 missing ticks, then decays to 0 — stalled paddle stops. Remote paddles/balls stay interpolation-only (from 45); host renders authoritative state.

**Blocked by:** 45 — Remote play.

**Status:** ready-for-agent

- [ ] Guest's own paddle responds instantly under normal latency; display offset decays ~0.5 s after correction
- [ ] Reconcile = per-tick compare + snap; prediction history wiped on rejoin (with 47)
- [ ] Prediction clamps to walls, shared-field slice, Duel other-paddle-as-wall — display never settles short (unit-tested per constraint)
- [ ] Host stall decay: ≤10 missing ticks hold last axis, then decay to 0; stalled paddle stops (unit-tested)
- [ ] Prediction never applied to remote players or the ball
