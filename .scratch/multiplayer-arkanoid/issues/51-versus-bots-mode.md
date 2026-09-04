# 51 — Versus bots mode

**What to build:** Every multiplayer variant playable solo against or alongside bots: Race/Attack (1–3 bots), Duel (1 bot), Shared field / Parallel assist (1–3 bot teammates) — exactly 1 human + N bots, never bots alongside >1 human. Trimmed lobby config (no room code, no ready check): variant picker with player-count validation, match structure, difficulty selector (session-wide, default Normal). Same host-authoritative pipeline: bot = host-local input source through the standard delay queue, D = 0, net module idle — one code path (from 25). Pause freely (coop semantics).

**Blocked by:** 25 — Bots; 32 — Duel mode; 33 — Shared field coop; 34 — Race mode, local split-screen; 39 — Attack mode; 40 — Parallel assist coop.

**Status:** ready-for-agent

- [ ] Every variant playable 1 human + N bots with correct bot counts (Race/Attack 1–3, Duel 1, coop 1–3)
- [ ] Bots never appear alongside >1 human (enforced)
- [ ] Trimmed config: variant picker + match structure + difficulty selector; no room code, no ready check
- [ ] Difficulty selector session-wide, default Normal; all three sets behave per spec table
- [ ] Bots use attacks/assists (meters, targeting) in the variants that have them
- [ ] Pause freely works (coop semantics) in every versus-bots variant


