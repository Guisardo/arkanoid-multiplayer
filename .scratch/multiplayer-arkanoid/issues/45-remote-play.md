# 45 — Remote play

**What to build:** Real remote multiplayer over WebRTC using the net core (27) and signaling (37): host-authoritative input relay + state broadcast. Two channels per guest: game (unreliable, unordered — input frames ↑ at 60 Hz, snapshots ↓ at 30 Hz; 60 Hz snapshots for Duel) + control (reliable, ordered — lobby, version handshake). Guests send 60 Hz Input frames with ~10-tick redundancy; host simulates fixed 60 Hz, dedupes by (player, tick), clamps axes to [-1..1], ignores unknown action types, caps input-frame rate. Host broadcasts full binary Snapshots. Guest interpolation of remote paddles/balls only (buffer latest − ~2.5 intervals, adaptive; never extrapolate the ball); host renders authoritative state. Version handshake: protocol version int in join; mismatch → join refused, "refresh your browser". Malformed binary snapshot or control JSON on the guest = protocol error → clean session-end ("Connection corrupted — session ended"), never a crash. Remote progress strip: top edge, one row per remote player — name + color, score, R12/33, lives (competitive) / downed flag (parallel assist); mobile landscape compresses to name + score; numbers only; remote fields never rendered. Competitive remote input delay D = 3–5 ticks (default 4, lobby-configurable); D = 0 coop remote. Demoable: two devices play a Race remotely.

**Blocked by:** 27 — Net core: snapshot serializer + delay queue; 43 — Lobby + landing + session flow.

**Status:** ready-for-agent

- [ ] Two devices (or two browser contexts) join via room code and play a full Race remotely
- [ ] Game channel unreliable/unordered; control channel reliable/ordered; binary on game, JSON on control
- [ ] 60 Hz guest input with redundancy; host dedupe + clamp + rate cap + unknown-action rejection (unit-tested)
- [ ] 30 Hz snapshots (60 Hz Duel); guest interpolation buffer adaptive, ball never extrapolated
- [ ] Version mismatch → refused join with "refresh your browser"
- [ ] Malformed frames → clean protocol-error session end on guest, never a crash (fuzz-tested)
- [ ] Remote progress strip correct per mode; remote fields never rendered
- [ ] D configurable 3–5 competitive (default 4), 0 coop; uniform delay queue holds for host-local players


