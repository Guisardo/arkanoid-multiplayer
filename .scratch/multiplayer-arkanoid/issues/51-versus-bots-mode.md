# 51 — Versus bots mode

**What to build:** Every multiplayer variant playable solo against or alongside bots: Race/Attack (1–3 bots), Duel (1 bot), Shared field / Parallel assist (1–3 bot teammates) — exactly 1 human + N bots, never bots alongside >1 human. Trimmed lobby config (no room code, no ready check): variant picker with player-count validation, match structure, difficulty selector (session-wide, default Normal). Same host-authoritative pipeline: bot = host-local input source through the standard delay queue, D = 0, net module idle — one code path (from 25). Pause freely (coop semantics).

**Blocked by:** 25 — Bots; 32 — Duel mode; 33 — Shared field coop; 34 — Race mode, local split-screen; 39 — Attack mode; 40 — Parallel assist coop.

**Status:** resolved

- [x] Every variant playable 1 human + N bots with correct bot counts (Race/Attack 1–3, Duel 1, coop 1–3)
- [x] Bots never appear alongside >1 human (enforced)
- [x] Trimmed config: variant picker + match structure + difficulty selector; no room code, no ready check
- [x] Difficulty selector session-wide, default Normal; all three sets behave per spec table
- [x] Bots use attacks/assists (meters, targeting) in the variants that have them
- [x] Pause freely works (coop semantics) in every versus-bots variant

## Answer

Implemented on `chunk/versus-bots` (worktree arkanoid-wt-51):

- **`src/sim/versusBots.ts`** (new, pure composition): `createVersusBotsSession` — one session type wrapping every variant sim (race/attack via multiField seam, duel, sharedField, parallelAssist). Bots = host-local `createBot` input sources (D = 0, net idle, one code path from ticket 25); each bot samples frames from its own snapshot. `validateBotsSetup` enforces exactly 1 human + bot count per variant (Race/Attack/coop 1–3, Duel 1) — throws on violation. Pause freely (coop semantics) in every variant; sharedField pause routes through the sim's own pause events. Deterministic (seeded bots, verified).
- **`src/ui/versusBotsScreen.ts`** (new): trimmed config screen — variant picker (5 buttons), bot-count picker (disables out-of-range counts per variant, clamps on switch), difficulty selector (Easy/Normal/Hard, default Normal), Start/Back. No room code, no ready check. Tap targets ≥48 px.
- **`src/ui/strings.ts`**: 16 new keys × 2 locales (variant names, difficulty names, config labels).
- **Tests**: 15 new — bot counts per variant, 1-human enforcement, invalid-setup throws, session composition per variant (steps + snapshot shapes), pause-freeze-resume in all 5 variants, determinism (same seed + same human input → identical snapshots), config screen (Duel disables bots 2/3 + clamps, difficulty switch, no code/ready text, es-419). Full suite 474/474 green; typecheck/lint/build clean.

Judgment calls: bots sample from their own field's snapshot in parallel variants (per-field state, matches host-local pipeline); human always player 0; bot seeds derived deterministically from session seed (seed + i × 7919).


