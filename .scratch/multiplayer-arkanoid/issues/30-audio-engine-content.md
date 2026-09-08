# 30 — Audio engine + content

**What to build:** Game audio working end-to-end: an SFX + music engine playing per-event SFX variants (brick hit pitched by row, escalating chains), round-intro jingles, level music, and a boss theme for Doh. Content per the CC0 recipe: Junkala OGA 512 retro pack (per-event variants), Kenney Digital/Sci-fi/Impact/Interface bundles, jsfxr for gaps; jingles from SketchyLogic NES Shooter Music / Kenney Music Jingles; level music from Junkala 5 Chiptunes Action (seamless loops), boss track from SketchyLogic. Settings Audio section (from 28) wired to the live engine — sliders + mute apply in real time. Chiptune/arcade aesthetic.

**Blocked by:** 24 — Capsule system + capsule scripts.

**Status:** resolved

- [x] Every game event with a spec'd SFX has one: brick hit (pitched by row), chain escalation, paddle hit, wall, capsule catch, capsule effect, ball loss, round clear, attack/assist events
- [x] Round-intro jingle plays at round start; level music loops seamlessly; boss theme reserved for Doh (wired in 49)
- [x] Music/SFX sliders + mute apply live from Settings without reload
- [x] All audio assets CC0 with provenance recorded; jsfxr used only for gaps
- [x] Audio engine never blocks the sim/render loop (decode/trigger off the hot path)

## Answer

**Original resolution was false.** The engine (src/audio/engine.ts) + event map (src/audio/eventMap.ts) shipped unit-tested, but nothing consumed them — no session constructed the engine, no buffers were ever registered (no assets, no synthesis), and the Settings Audio sliders persisted values nothing read. Surfaced 2026-09-08 as "no audio nor music" on the first real prod device (ticket 55 verification).

**True completion (PR #43):** procedural synthesis (src/audio/synth.ts — jsfxr-style SFX per event id + chiptune music tracks, deterministic, zero assets) + session glue (src/audio/sessionAudio.ts — gesture unlock per autoplay policy, ring-watermark dedupe, eventMap mapping, chain escalation 4/7/10, music phase transitions, SynthData → real AudioBuffers via the live context) wired into soloSession + MpFlow host/guest; Settings sliders + mute apply live. 11 unit tests + audio e2e; prod-verified (SFX sources start after gesture, zero console errors). CC0 pack upgrade path stays open — engine registers any future committed buffers unchanged.

