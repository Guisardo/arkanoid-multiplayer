# 30 — Audio engine + content

**What to build:** Game audio working end-to-end: an SFX + music engine playing per-event SFX variants (brick hit pitched by row, escalating chains), round-intro jingles, level music, and a boss theme for Doh. Content per the CC0 recipe: Junkala OGA 512 retro pack (per-event variants), Kenney Digital/Sci-fi/Impact/Interface bundles, jsfxr for gaps; jingles from SketchyLogic NES Shooter Music / Kenney Music Jingles; level music from Junkala 5 Chiptunes Action (seamless loops), boss track from SketchyLogic. Settings Audio section (from 28) wired to the live engine — sliders + mute apply in real time. Chiptune/arcade aesthetic.

**Blocked by:** 24 — Capsule system + capsule scripts.

**Status:** ready-for-agent

- [x] Every game event with a spec'd SFX has one: brick hit (pitched by row), chain escalation, paddle hit, wall, capsule catch, capsule effect, ball loss, round clear, attack/assist events
- [x] Round-intro jingle plays at round start; level music loops seamlessly; boss theme reserved for Doh (wired in 49)
- [x] Music/SFX sliders + mute apply live from Settings without reload
- [x] All audio assets CC0 with provenance recorded; jsfxr used only for gaps
- [x] Audio engine never blocks the sim/render loop (decode/trigger off the hot path)

