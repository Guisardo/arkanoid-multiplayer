# Single-player mode design

Type: grilling
Status: resolved
Blocked by: (none)

## Question

What are the exact rules of the single-player mode?

The destination was redrawn after the game-feel prototype validated the bot AI as good enough to drive single-player. Design: what the mode actually is (classic solo episode play-through vs bot-opposed competitive variants vs both); how the bot maps onto each multiplayer variant (Race vs bot? Attack vs bot? Duel vs bot?); bot difficulty (single fixed skill vs selectable levels — what varies: reaction, error rate, meter usage?); where the mode sits in the lobby/landing flow (no lobby needed? straight to game?); lives/scoring/round structure (reuse competitive rules or classic solo rules?); and whether bot-driven single-player sessions use the same host-authoritative pipeline with a bot input source (no network) or a simpler all-local path.

HITL: play-style preferences decide. Invoke /grilling and /domain-modeling; add resolved terms to CONTEXT.md.

## Answer

Resolved by grilling session (8 questions, all answered by human).

**Mode shape — both:**
- **Solo episode play-through**: pure classic Arkanoid — one player, one field, rounds 1–33, Doh finale. No bots, no lobby.
- **Versus bots**: every multiplayer variant playable against bots — Race/Attack (1–3 bots), Duel (1 bot, 2-only cap), shared-field and parallel-assist coop (1–3 bot teammates). Single-player sessions only: exactly 1 human + N bots. Bots alongside >1 human (split-screen + bots, remote + bot slot-fill) = out of scope, post-spec candidate.

**Pipeline — same host-authoritative pipeline, bot = host-local input source.** Bot input frames push through the same delay queue as any local player, D=0 (all-local rule already decided). Solo = same: single player's frames into the queue, net module idle. No separate all-local path — one code path to build and test.

**Bot difficulty — selectable, 3 levels (Easy/Normal/Hard), parameter knobs not separate logic.** Same bot code, different parameters. Knobs: aim noise (error added to target x), tracking engagement (how late bot locks onto descending ball), launch timing randomness, meter-spend threshold + target quality. Normal ≈ prototype behavior + small aim noise; Easy = high noise, late tracking, hoards meter; Hard = tight tracking, smart meter. One difficulty selector in versus-bots config, applies to all bots in session, default Normal. Solo unaffected (no bots).

**Flow placement — landing gets three entries:**
1. **Solo** — straight to game, zero friction, no lobby.
2. **Versus bots** — trimmed lobby config: variant picker with player-count validation, match structure, difficulty. Lobby components reused, no room code, no ready check.
3. **Multiplayer** — existing room-code flow untouched.

**Solo episode rules — classic + continue:** 3 lives (classic-accurate, matches classic-accurate scoring table), score accumulates across the run, round advances on clear, Doh at 33 = episode complete. Game over → "Continue from round N (fresh 3 lives)" or "Restart episode". localStorage stores highest round reached + high score. No difficulty select for solo — the 33-round curve IS the difficulty.

**Pause & quit — pause freely, coop semantics.** All-local, D=0, no remote humans → Esc/menu pauses sim, pause screen = coop layout (Resume/Settings/Quit), quit = quit-confirm overlay. Bot-opposed matches follow the same rule — "competitive no-pause" is about remote fairness, absent here.
