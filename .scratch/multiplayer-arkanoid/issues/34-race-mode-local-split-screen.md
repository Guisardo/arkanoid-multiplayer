# 34 — Race mode, local split-screen

**What to build:** The core competitive variant with local split-screen: 2–4 players on identical parallel fields, first to clear wins the round/match. Match structure lobby-configurable: best-of-N rounds / continuous episode race / one-off single level. Level selection lobby-configurable: host-pick per round / fixed episode order / random. Round time cap configurable (finite or infinite); timeout resolution per structure: round-based → most bricks that round; continuous → furthest along (levels cleared, then bricks in current); one-off → most bricks; exact tie → draw, no round point, next level. Lives 5; 0 lives → current level resets (fresh layout, lives restored). Full capsule roster active. Desktop N-across equal-width field regions with 8 px gutters; single centered field at N = 1. Per-field HUD strips. Competitive quit: Esc or HUD menu button → quit-confirm overlay ("Quit match? You forfeit"), sim never pauses behind it. This ticket also extracts the multi-field session composition reused by Attack and Parallel assist.

**Blocked by:** 24 — Capsule system + capsule scripts; 31 — Content pipeline + rounds 1–16.

**Status:** ready-for-agent

- [ ] 2–4 local players race on identical fields; first clear wins round per match structure
- [ ] All three match structures work; all three level-selection modes work; time cap finite/infinite works
- [ ] Timeout resolution correct per structure incl. exact-tie draw (unit-tested)
- [ ] 0 lives → level resets with fresh layout and restored lives
- [ ] Split-screen: N-across equal columns, 8 px gutters, per-field HUD strips, letterboxed fields
- [ ] Quit-confirm overlay works; sim never pauses behind it; quit = removal scored as loss
- [ ] Multi-field session composition extracted as a reusable seam for Attack/Parallel assist
