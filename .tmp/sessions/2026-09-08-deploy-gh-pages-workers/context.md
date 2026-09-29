# Task Context: Deploy GH Pages + Workers + free-tier checks

Session ID: 2026-09-08-deploy-gh-pages-workers
Created: 2026-09-08
Status: in_progress
Ticket: .scratch/multiplayer-arkanoid/issues/55-deploy-gh-pages-workers-checks.md (claimed)

## Current Request

Work wayfinder ticket 55: free-tier deployment end-to-end — GitHub Pages hosting (git-push deploys, auto-HTTPS), Cloudflare Worker + DO signaling deployed (from 37), TURN credential Worker deployed (from 38), Metered free-quota verification, DO hibernation billing check, deploy-disconnect behavior verified, QR share URL uses production host, Cloudflare Pages fallback + itch.io mirror documented runbook-level.

## Context Files (Standards to Follow)

- D:/Users/Lucas/.config/opencode/context/core/standards/code-quality.md

## Reference Files (Source Material)

- .scratch/multiplayer-arkanoid/map.md — wayfinder map
- .scratch/multiplayer-arkanoid/issues/55-deploy-gh-pages-workers-checks.md — ticket + checklist
- .scratch/multiplayer-arkanoid/spec.md — §10 (ICE/signaling), §18 (deploy checklist)
- workers/signaling/wrangler.toml, workers/turn/wrangler.toml
- workers/signaling/src/{worker.ts,room.ts,relayLogic.ts,code.ts}
- workers/turn/src/{worker.ts,credentialLogic.ts}, workers/turn/README.md
- src/signaling/{client.ts,rtc.ts,iceConfig.ts}
- src/ui/lobbyScreens.ts (qrPayloadFor, codeFromUrl)
- src/app/main.ts (startHostFlow/startGuestFlow wiring)
- vite.config.ts, playwright.config.ts, .github/workflows/{coverage.yml,e2e.yml}
- package.json

## Discovered State (2026-09-08)

- Wrangler authed: account aa3e19504af5453d2cde7f413ad26dab, workers+pages write scope.
- TURN Worker deployed 2026-09-03, METERED_SECRET_KEY secret live, METERED_DOMAIN=breakout_together.metered.live.
- Signaling Worker NEVER deployed (wrangler deployments list → "does not exist").
- GH Pages enabled, build_type=workflow, URL https://guisardo.github.io/arkanoid-multiplayer/ (subpath!), https_enforced, source main/.
- .env committed (CODECOV_TOKEN only) — no VITE_* vars exist yet.

## Gaps to Close (implementation)

1. Vite `base` unset → prod assets break under /arkanoid-multiplayer/ subpath. Fix: base from VITE_BASE env, default "/" (dev/e2e unchanged).
2. qrPayloadFor builds https://<host>/?code= — drops subpath. Fix: include location.pathname.
3. defaultSignalingUrl same-origin → static GH Pages can't serve WS. Fix: VITE_SIGNALING_BASE override, fallback same-origin (dev unchanged).
4. fetchIceConfig never wired into app. Fix: wire via VITE_TURN_URL into openHostRoom/connectViaSignalingGuest iceConfig; absent → STUN-only (current behavior).
5. ALLOWED_ORIGINS both workers missing https://guisardo.github.io.
6. No deploy workflow. Add .github/workflows/deploy.yml (Pages only; Workers manual/rare — DO socket disconnects).

## Constraints

- Free tier only. No paid services.
- Workers deploy rarely (disconnects DO sockets); clients auto-reconnect (verified in 47).
- Dev/e2e must stay green: localhost:5173 same-origin signaling, no TURN fetch (STUN-only), base "/".
- Pure functions, DI, small modules (code-quality.md). Env access at app boundary (main.ts), not deep modules.
- QR payload must work from any deployed origin (GH Pages subpath, pages.dev, itch.io frame) — derive from location, not hardcoded host.

## Exit Criteria (ticket checklist)

- [ ] Production deploy live on GitHub Pages over HTTPS; game fully playable from deployed URL
- [ ] Signaling Worker + DO deployed and hibernation billing verified against free tier
- [ ] TURN credential Worker deployed; quota verified and documented
- [ ] Deploy-disconnect behavior verified: clients auto-reconnect after Worker redeploy
- [ ] QR share encodes the production URL; ?code= prefill works in production
- [ ] Cloudflare Pages fallback + itch.io mirror documented (runbook-level)
