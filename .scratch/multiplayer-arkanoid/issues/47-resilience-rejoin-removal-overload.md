# 47 — Resilience: rejoin, removal, host backgrounding, overload

**What to build:** Session survival under adverse conditions. Guest disconnect: DataChannel close OR heartbeat (guest ping 5 s, drop at ~10–15 s silence), whichever first → 90 s rejoin window — paddle freezes in place, play continues (ball lost = life lost as normal); guest blind period: prediction continues, remote entities freeze, reconnect banner after ~1 s snapshot silence; session-over at control close or ~10–15 s silence. Rejoin: join-with-original-player-id on control channel → host validates held slot → rejoin-ack + full snapshot → guest rebuilds, wipes prediction history. Expiry → removal: competitive = field eliminated (loss), coop = slot gone, not revivable; removed players can't return that match. Host tab backgrounding: wake lock + Worker/timer-driven host tick; WebRTC-in-use exempts intensive throttling, not freeze — pause-and-resync on visibility. Host overload: catch-up cap 5 sim ticks/render frame; sustained overload → slow-motion degradation, snapshots keep 30 Hz wall-clock, throttle warning banner.

**Blocked by:** 45 — Remote play.

**Status:** resolved

- [x] Disconnect detected via close OR heartbeat (~10–15 s), whichever first; 90 s window holds the slot
- [x] During window: paddle frozen, play continues, ball loss = life loss; blind-period UX per spec (banner ~1 s, frozen remotes)
- [x] Rejoin restores the held slot from a full snapshot; prediction history wiped; works within the window
- [x] Expiry removal: competitive loss / coop slot gone; removed player cannot return that match
- [x] Host backgrounding: wake lock + Worker tick keep the session alive; visibility return = pause-and-resync
- [x] Overload: 5-tick catch-up cap; sustained overload → slow-motion + 30 Hz wall-clock snapshots + throttle banner; clean recovery

## Answer

Shipped as PR #31 (squash-merged 2026-09-06, commit `dca6029`→`#31` on main).

**Disconnect detection:** `net/heartbeat.ts` — host watchdog drops a guest at 12 s input/snapshot silence (DataChannel close fires first when clean); guest pings every 5 s while in-game. `net/rejoin.ts` holds the dropped slot for 90 s (pure registry, wall-clock injectable).

**Blind period (guest):** `app/guestGame.ts` blind-state machine — live → blind (banner) at ~1 s snapshot silence → over (terminal) at ~12 s silence or control close. Prediction continues locally; remote entities freeze (interpolator holds newest snapshot); late snapshots never resurrect a terminal session.

**Rejoin:** control messages `rejoin`/`rejoin-ok`/`rejoin-refused` (`net/control.ts`). Guest re-joins with original player id → host validates against the held-slot registry → `rebindGuest(old, new, simPlayers)` rebinds routing to the fresh channel index → rejoin-ack + immediate full snapshot → guest `resyncFromSnapshot` wipes prediction history. Unknown/expired rejoin = refused (fatal on guest). One reconnect attempt per mid-match death.

**Expiry → removal:** `hostGame.removePlayers` — input cutoff + snapshot player state "removed" overlay, field-index aware (parallel-mode player remap). Competitive = field eliminated (loss via frozen-paddle ball-loss); coop = slot gone, not revivable.

**Host backgrounding:** `app/keepAlive.ts` — screen wake lock, 250 ms background tick (hidden-only, so it doesn't spam guest silence monitors), visibility pause-and-resync (full snapshot to every live guest on return).

**Overload:** `app/overload.ts` — 30 consecutive capped frames (catch-up cap 5 ticks/frame, pre-existing) engage 0.5× slow-motion via `loop.setTimeScale`; 60-frame headroom steps recover cleanly; throttle warning banner; `snapshotEveryTicks` keeps snapshots at 30 Hz wall-clock.

**Bugs the new tests caught (fixed):** mid-match drop removed lobby players (slot died with the channel); rebindGuest read routing deleted at drop time (now maps lobby ids → sim players via `simPlayersOfLobbyIds`); keepAlive background tick resynced unconditionally (defeated guest silence monitors); pre-existing serializer bug — boss-absent byte under-count overflowed exact-sized buffers.

800 unit tests (68 new), 4 e2e, lint, typecheck, build, codecov project+patch, CodeFactor — all green.

