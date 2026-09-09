# 55 — Deploy: GitHub Pages + Workers + free-tier checks

**What to build:** Free-tier deployment end-to-end: GitHub Pages hosting (git-push deploys, auto-HTTPS) with Cloudflare Pages fallback documented; Cloudflare Worker + Durable Object signaling deployed (from 37) and TURN credential Worker deployed (from 38); Metered free-quota verification at signup (20 GB vs 500 MB conflict resolved and documented); DO hibernation billing check at first deploy (~10k sessions/day inside free tier confirmed); optional itch.io mirror documented. Deploy rarely — deploys disconnect DO sockets; clients auto-reconnect (verified). Room-code QR share URL uses the production host.

**Blocked by:** 38 — TURN credential worker; 53 — E2E Playwright suite.

**Status:** claimed

- [ ] Production deploy live on GitHub Pages over HTTPS; game fully playable from the deployed URL
- [ ] Signaling Worker + DO deployed and hibernation billing verified against free tier
- [ ] TURN credential Worker deployed; quota verified and documented
- [ ] Deploy-disconnect behavior verified: clients auto-reconnect after Worker redeploy
- [ ] QR share encodes the production URL; `?code=` prefill works in production
- [ ] Cloudflare Pages fallback + itch.io mirror documented (runbook-level)

## Comments

**2026-09-08 (PR #40 + #41/#42 + #43):** Implementation shipped. Prod live at https://guisardo.github.io/arkanoid-multiplayer/ (deploy workflow green, assets + QR subpath verified). Signaling Worker + DO deployed; TURN redeployed (healthz 200). Prod verification surfaced two real bugs, both fixed + deployed: dpr>1 canvas overflow (autoDensity, PR #41) and missing audio (ticket 30 false resolution — wired for real in PR #43, prod-verified). Runbook at docs/deploy.md.

**2026-09-09 (PR #45):** Versus bots app session layer shipped (PR #45). Real versus matches now boot from the config screen: split-screen for race/attack/parallelAssist (N fields), single field for duel/sharedField; input merge (keyboard/mouse/gamepad/touch), session audio, perf ladder, pause menu (coop semantics), end screens per ticket 50 shapes, Rematch / back-to-config / Quit. **Real bug found + fixed**: parallel-variant bots never launched — bots sampled field-local snapshots (player 0) but were constructed with session indices 1..N, so the 'me' lookup failed and every bot idled in serve forever. Ticket 51's tests only asserted no-crash + tick advance, never bot movement. Fix: parallel bots created player 0 (field-local view), frames remapped to session index for multiField routing; single-field variants keep real indices end to end. 10 unit tests + 3 e2e specs (race 3 bots = 4 fields + bot movement, duel single field + pause, config screen).

**Remaining HITL (blocks resolution):**
1. Metered secret re-check — credential mint 502s (`curl -H "Origin: https://guisardo.github.io" https://arkanoid-turn.ropitas.workers.dev/turn/credentials`); stored secret rejected on first live call. Fix: dashboard.metered.ca → copy current Secret Key → `npx wrangler secret put METERED_SECRET_KEY --config workers/turn/wrangler.toml` → re-curl, expect 200. Confirm 20 GB Open Relay quota while there.
2. DO hibernation billing check — Cloudflare dashboard → Workers → arkanoid-signaling → Metrics after a real session.
3. QR scan test on a phone (encodes prod URL w/ subpath + ?code=).
4. Deploy-disconnect test — two devices in lobby → redeploy signaling Worker → clients auto-reconnect.


