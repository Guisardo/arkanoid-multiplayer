# 40 — Parallel assist coop

**What to build:** Coop on separate fields: 2–4 players, each on their own play field, shared score, per-player lives (5), continuous lobby-chosen level range. Downed at 0 lives: field frozen, spectates, no meter income; life gift is the only revival (revive = 1 life, ball attached, owner launches). Assist meter (same fill rules as attack meter: 2 per brick + 10 per capsule catch) spends: power-up gift (send captured capsule to teammate's field) — cost 20; brick clear (remove 8 lowest bricks in teammate's field) — cost 30; life gift — cost 40 (life created by spend, never transferred; no self life gift). Downed players keep spend rights (gift/clear, not self-life); early clearer spectates with full gift rights incl. life gift. Team wins when last player clears; loses when all downed simultaneously. No ball-speed scaling. 3 assist buttons + cycle targeting.

**Blocked by:** 34 — Race mode, local split-screen.

**Status:** resolved

- [x] 2–4 players on separate fields, shared score, per-player lives; episode range playable to team win
- [x] Downed state: field frozen, spectates, no meter income; life gift revives (1 life, ball attached, owner launches)
- [x] Meter spends: gift 20, brick clear 30 (8 lowest bricks), life gift 40; fill 2/brick + 10/capsule
- [x] Life gift creates the life (never transferred); self life gift impossible; downed keep gift/clear rights
- [x] Early clearer spectates with full gift rights incl. life gift
- [x] Team loses when all downed simultaneously; wins when last player clears
- [x] 3 assist buttons + cycle targeting on all input methods; HUD meter + target display

