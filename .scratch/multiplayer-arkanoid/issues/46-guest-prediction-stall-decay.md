# 46 — Guest prediction + stall decay

**What to build:** Guest-side responsiveness: local paddle only — shadow sim + input history; reconcile = direct per-tick compare, snap to authoritative, fold difference into a display offset decaying ~0.5 s. Prediction must clamp to every sim constraint (walls, shared-field slice, Duel other-paddle-as-wall) or the display settles short. Input stall decay: host holds last axis ≤10 missing ticks, then decays to 0 — stalled paddle stops. Remote paddles/balls stay interpolation-only (from 45); host renders authoritative state.

**Blocked by:** 45 — Remote play.

**Status:** resolved

- [x] Guest's own paddle responds instantly under normal latency; display offset decays ~0.5 s after correction
- [x] Reconcile = per-tick compare + snap; prediction history wiped on rejoin (with 47)
- [x] Prediction clamps to walls, shared-field slice, Duel other-paddle-as-wall — display never settles short (unit-tested per constraint)
- [x] Host stall decay: ≤10 missing ticks hold last axis, then decay to 0; stalled paddle stops (unit-tested)
- [x] Prediction never applied to remote players or the ball

## Answer

Implemented on `chunk/guest-prediction` (PR pending), all gates green: 732 unit tests (19 new), 4 e2e, lint, typecheck, build.

**Guest prediction (`src/net/predict.ts`, new):** per-local-player `Predictor` — shadow advance from input history (`x += axis × PADDLE_VMAX × TICK_DT`), per-tick trail keyed by frame tick. Reconcile = direct per-tick compare at the acked tick (`snap.tick − D` — the delay queue consumes input t at t+D, so the trail entry at that instant is the prediction of exactly the authoritative state): error > 0.5 field units snaps the whole predicted trajectory (current x + every trail entry) to authoritative and folds the same difference into a display offset decaying at `0.0025^(1/60)`/tick (~95% gone in 0.5 s, prototype-validated). Comparing at the acked tick — not against the current shadow — is the load-bearing choice: comparing against "now" would fold the D+latency window's movement into the offset on every snapshot and smother the prediction.

**Clamps (per constraint, unit-tested):** `predictBounds` mirrors the sim's own movement constraints — walls (half-paddle margins), sharedField placement-A slice (`[i×N, (i+1)×N)`), duel other-paddle-as-wall (flush distance, side-edge paddles clamp on y). Bounds refresh from the LATEST snapshot before both tick-advance and reconcile — stale bounds would clamp the authoritative truth after the other paddle moves.

**Player identity split:** `framePlayer` (device-local index the codec carries) vs `snapPlayer` (parallel modes renumber each field's player to 0 via the multiField remap; duel/sharedField carry global ids). guestGame builds one predictor per local player with both ids.

**guestGame integration:** collect → predictor.push; sendTick (60 Hz) → predictor.tick + batch send; hostBinary → reconcile per snapshot batch; renderSnapshots → overlay `displayX()` onto the guest's OWN paddle only (parallel: `players[0]`; single-field: global id) + attached balls owned by that player. Remote players + ball untouched — interpolation-only (45). `resyncFromSnapshot` wipes history + reseeds (rejoin hook for 47).

**Host stall decay (hostGame):** synthetic frames through the delay queue collided with the guest's frame-tick timeline (guard dedupe dropped real input) — instead held/decayed axes inject directly beside due frames in `sim.step`: ≤10 missing ticks hold last axis, then ×0.7/tick decay, floored at 0.05 → 0. A due frame resets the miss counter. Idle players (never sent input) stay idle.

**Input wiring (production gap found):** MpFlow gained `sampleLocal(player, tick)` — called once per sim tick per local player by both host and guest loops; main.ts wires per-player KeyboardAdapters (single listener fans to all, edges never cross-consumed) + GamepadAdapter per player with Settings bindings. Mouse/touch wiring deferred (needs paddle-feedback loop / overlay regions — follow-up in 53 e2e polish).

**Tests:** `tests/net/predict.test.ts` (15: clamps per constraint incl. duel settle-short regression, acked-tick no-smother, offset decay, reset/reseed) + 4 loopback integration (predicted-ahead-of-ack, remote/ball untouched, parallel overlay, stall hold→decay→stop).


