# 55 — Deploy: GitHub Pages + Workers + free-tier checks

**What to build:** Free-tier deployment end-to-end: GitHub Pages hosting (git-push deploys, auto-HTTPS) with Cloudflare Pages fallback documented; Cloudflare Worker + Durable Object signaling deployed (from 37) and TURN credential Worker deployed (from 38); Metered free-quota verification at signup (20 GB vs 500 MB conflict resolved and documented); DO hibernation billing check at first deploy (~10k sessions/day inside free tier confirmed); optional itch.io mirror documented. Deploy rarely — deploys disconnect DO sockets; clients auto-reconnect (verified). Room-code QR share URL uses the production host.

**Blocked by:** 38 — TURN credential worker; 53 — E2E Playwright suite.

**Status:** ready-for-agent

- [ ] Production deploy live on GitHub Pages over HTTPS; game fully playable from the deployed URL
- [ ] Signaling Worker + DO deployed and hibernation billing verified against free tier
- [ ] TURN credential Worker deployed; quota verified and documented
- [ ] Deploy-disconnect behavior verified: clients auto-reconnect after Worker redeploy
- [ ] QR share encodes the production URL; `?code=` prefill works in production
- [ ] Cloudflare Pages fallback + itch.io mirror documented (runbook-level)


