# 33 — Shared field coop

**What to build:** Team coop on one field: 2–4 players, shared team life pool = 3 × player count, continuous episode play-through of a lobby-chosen level range. Three lobby-configured placements: A (bottom edge — paddles side-by-side, each owns a slice, movement confined to slice), B (multiple edges — 2P bottom+right, 3P +left, 4P +top; paddle edges open, non-paddle edges walls, bottom always open; side paddles move vertically; top paddle = normal bounce surface; ball hits bricks from any direction), C (shared paddle — one paddle, free-for-all summed inputs, axis sum clamped ±1; center drop serve, any player launches). Ball model lobby choice: shared or per-player color-coded; per-player model respawns toward owner's paddle. Life lost when ball count hits zero (by model); multiball is a buffer; multiball splits the capturing player's ball only; capsules affect capturer's paddle only (placement C: the shared paddle). Ball speed +5–8% per player beyond 2 (placements A/B; C exempt). Single HUD strip (shared pool, team score, round). Coop pause semantics: any player pauses all.

**Blocked by:** 24 — Capsule system + capsule scripts; 31 — Content pipeline + rounds 1–16.

**Status:** ready-for-agent

- [ ] 2P, 3P, 4P shared-field sessions playable on placements A, B, C (unit tests per placement)
- [ ] Shared pool = 3 × player count; life lost when ball count hits zero per ball model
- [ ] Placement B edge assignments correct per player count; side paddles vertical; top paddle bounces; ball hits bricks from any direction
- [ ] Placement C summed inputs clamp to ±1; center drop serve; any player launches
- [ ] Multiball splits only the capturing player's ball; capsules affect capturer's paddle only
- [ ] Speed scaling +5–8% per player beyond 2 on A/B, exempt on C (unit-tested)
- [ ] Single HUD strip: shared pool, team score, round
- [ ] Any local player's pause request pauses the whole session; any player resumes
