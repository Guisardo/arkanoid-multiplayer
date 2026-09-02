# Coop mode design

Type: grilling
Status: resolved

## Question

What are the exact rules of each coop variant?

Design both, with win/lose conditions, player-count caps (2-4), and difficulty scaling with player count:

- **Shared field** — one play field, multiple paddles. Define paddle count vs player count (where do 3-4 players sit?), ball count and ownership, shared lives and life-loss rules.
- **Parallel assist** — separate fields, shared score. Define the help actions players can send each other.

HITL: play-style preferences decide. Invoke /grilling and /domain-modeling; add resolved terms to CONTEXT.md.

## Answer

**Both variants**

- Caps: 2-4 players, max 2 local per device (Destination ruling — split-screen supports 2 local per device, 4 players via 2 devices).
- Match shape: continuous play-through of lobby-chosen level range (episode). No rounds, no best-of, no time cap.
- Win = team clears range; lose = life failure.

**Shared field**

- One play field, shared team life pool (count scaled at spec assembly).
- Lobby-configures: paddle placement + ball model (shared / per-player color-coded).
- Placement A (bottom edge): paddles side-by-side, each owns a slice, movement confined to slice.
- Placement B (multiple edges): fixed order — 2P bottom+right, 3P +left, 4P +top. Paddle edges open (miss = ball lost), non-paddle edges walls, bottom always open. Side paddles move vertically. Top paddle = normal bounce surface, ball hits bricks from any direction.
- Placement C (shared paddle): one paddle, free-for-all summed inputs (axis sum, clamp ±1); center drop serve, any player launches.
- Ball: attach-and-launch serve; per-player model respawns toward owner's paddle (owner serves). Life lost when ball count hits zero (per player or field, by model) — multi-ball is a buffer, not a liability. Multi-ball power-up splits the capturing player's ball only. Power-ups affect capturer's paddle only.
- Scaling: ball speed +5-8% per player beyond 2 (placements A/B; C exempt — one paddle regardless of count). No brick scaling.
- No assist meter — cooperation is positional (covering slices/edges).

**Parallel assist**

- Separate fields, shared score, per-player lives.
- Downed at 0 lives: field frozen, spectates, no meter income; life gift is the only revival path. Revive = 1 life, ball attached to paddle, owner launches.
- Assist meter: same mechanic as attack meter (same fill rules — chains, power-up captures), coop spend menu: power-up gift (send captured power-up to teammate's field), brick clear (remove N lowest bricks in teammate's field), life gift (meter cost only — no life transfer between players).
- Early clearer spectates, can still gift assists; team wins when last player clears; loses when all players downed simultaneously.
- No ball-speed scaling — assist economy self-balances (more players = more meter income, more fields to save).

## Comments

### Downed-player action rights (from Input mapping design, 07)

Clarification recorded while resolving input mapping: a downed player keeps their action panel live — they can spend existing meter on teammates (power-up gift, brick clear), but cannot self life gift; revival is the teammates' act. Early clearer unchanged: full gift rights including life gift.
