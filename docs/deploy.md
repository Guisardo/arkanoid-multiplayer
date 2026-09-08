# Deploy runbook

Production topology (ticket 55, spec §18):

| Piece | Where | How it deploys |
|---|---|---|
| Game (static) | https://guisardo.github.io/arkanoid-multiplayer/ | GitHub Actions on push to `main` (`.github/workflows/deploy.yml`) |
| Signaling Worker + Room DO | https://arkanoid-signaling.ropitas.workers.dev | Manual `wrangler deploy` — rare |
| TURN credential Worker | https://arkanoid-turn.ropitas.workers.dev/turn/credentials | Manual `wrangler deploy` — rare |
| TURN relay (Metered Open Relay) | breakout_together.metered.live | Managed by Metered — nothing to deploy |

## Game: GitHub Pages

Deploys are automatic: every push to `main` runs the Deploy workflow (build
with `VITE_BASE=/arkanoid-multiplayer/`, `VITE_SIGNALING_BASE`,
`VITE_TURN_URL`, then `actions/deploy-pages`). No manual steps.

Verify after a deploy:

1. Open https://guisardo.github.io/arkanoid-multiplayer/ — landing renders,
   no console errors.
2. Multiplayer → create: room code + QR appear. Scan the QR with a phone —
   it must open the deployed URL with `?code=` prefilled (subpath included).
3. Solo round playable (keyboard moves paddle, launch serves).

### Cloudflare Pages fallback

If GitHub Pages is unavailable (or for previewing `main` before Pages picks
it up):

```sh
npm run build   # with the same three VITE_* vars as the workflow
npx wrangler pages deploy dist --project-name arkanoid-multiplayer
```

The Workers' `ALLOWED_ORIGINS` already includes
`https://arkanoid-multiplayer.pages.dev`, so signaling + TURN work there
without further changes. The QR payload derives from `location`, so it is
correct on any origin.

### itch.io mirror

1. `npm run build` with the same `VITE_*` vars (any base — itch serves from
   a frame, `location` resolves inside it).
2. Zip `dist/` contents (not the folder itself).
3. itch.io → new project → "HTML" kind → upload zip → check
   "This file will be played in the browser".
4. Enable **Mobile friendly** + **Fullscreen button**; the game handles
   touch input and orientation itself.
5. Caveat: itch frames the page; `?code=` QR links still point at the
   GitHub Pages URL (the QR encodes the page that generated it — on itch
   that is the itch URL, which works too since the code rides the query).

## Workers (deploy rarely)

A Worker redeploy disconnects every live Durable Object socket. Clients
auto-reconnect (ticket 47: guest ping 5 s → blind state → rejoin window),
but mid-session redeploy is still disruptive — deploy in idle periods.

```sh
# Signaling Worker + Room DO:
npx wrangler deploy --config workers/signaling/wrangler.toml

# TURN credential Worker (secret already set — never commit it):
npx wrangler deploy --config workers/turn/wrangler.toml
```

After deploying either Worker, verify:

```sh
curl https://arkanoid-turn.ropitas.workers.dev/healthz          # → ok
curl -H "Origin: https://guisardo.github.io" \
  https://arkanoid-turn.ropitas.workers.dev/turn/credentials     # → 200 JSON
curl "https://arkanoid-signaling.ropitas.workers.dev/room/ABCDE/ws?role=guest" \
  -H "Origin: https://guisardo.github.io"                        # → 426 (WS expected)
```

Origin changes: edit `ALLOWED_ORIGINS` in both `workers/*/wrangler.toml`
and redeploy.

### Deploy-disconnect verification

To verify clients survive a Worker redeploy (ticket 55 checklist):

1. Two devices in a lobby/match (one host, one guest).
2. `npx wrangler deploy --config workers/signaling/wrangler.toml`.
3. Expected: guest WS drops → client shows reconnecting state → rejoin
   succeeds (90 s window) or the session ends cleanly. No hang, no crash.

## Free-tier checks

### Metered TURN quota (20 GB/month, Open Relay signup)

Metered's pages conflict (20 GB vs 500 MB); the Open Relay signup flow
grants **20 GB/month** — see `workers/turn/README.md` for the resolution.
Worst case ~300–350 MB/h fully relayed → 20 GB ≈ 60 relayed play-hours.

Check monthly in the Metered dashboard (dashboard.metered.ca):

1. Usage → TURN: confirm the quota shown for the Open Relay tier.
2. Credentials are labeled `turn-YYYY-MM-DD` — usage attribution per day.
3. Set quota webhooks (Projects → 80%/100% alerts) if offered.

### Cloudflare Workers + DO free tier

- Workers free: 100k requests/day. Signaling front door sees ~2 requests
  per player per session (WS upgrade + join) — negligible.
- Durable Objects with WebSocket **Hibernation**: idle host socket costs
  nothing while hibernated; ~10k sessions/day fits the free tier (spec
  §18). Verify in Cloudflare dashboard → Workers → arkanoid-signaling →
  Metrics after first real use: check "Durable Objects requests" and
  "WebSocket concurrent connections" stay inside free limits.
- TURN Worker: one request per session start (credential mint) — negligible.

### GitHub Pages

Free for public repos; soft bandwidth limit ~100 GB/month — static assets
(~170 KB gzipped total) make this a non-issue.
