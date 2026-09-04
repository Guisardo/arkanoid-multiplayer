# 47 — Resilience: rejoin, removal, host backgrounding, overload

**What to build:** Session survival under adverse conditions. Guest disconnect: DataChannel close OR heartbeat (guest ping 5 s, drop at ~10–15 s silence), whichever first → 90 s rejoin window — paddle freezes in place, play continues (ball lost = life lost as normal); guest blind period: prediction continues, remote entities freeze, reconnect banner after ~1 s snapshot silence; session-over at control close or ~10–15 s silence. Rejoin: join-with-original-player-id on control channel → host validates held slot → rejoin-ack + full snapshot → guest rebuilds, wipes prediction history. Expiry → removal: competitive = field eliminated (loss), coop = slot gone, not revivable; removed players can't return that match. Host tab backgrounding: wake lock + Worker/timer-driven host tick; WebRTC-in-use exempts intensive throttling, not freeze — pause-and-resync on visibility. Host overload: catch-up cap 5 sim ticks/render frame; sustained overload → slow-motion degradation, snapshots keep 30 Hz wall-clock, throttle warning banner.

**Blocked by:** 45 — Remote play.

**Status:** ready-for-agent

- [ ] Disconnect detected via close OR heartbeat (~10–15 s), whichever first; 90 s window holds the slot
- [ ] During window: paddle frozen, play continues, ball loss = life loss; blind-period UX per spec (banner ~1 s, frozen remotes)
- [ ] Rejoin restores the held slot from a full snapshot; prediction history wiped; works within the window
- [ ] Expiry removal: competitive loss / coop slot gone; removed player cannot return that match
- [ ] Host backgrounding: wake lock + Worker tick keep the session alive; visibility return = pause-and-resync
- [ ] Overload: 5-tick catch-up cap; sustained overload → slow-motion + 30 Hz wall-clock snapshots + throttle banner; clean recovery


