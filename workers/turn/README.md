# arkanoid-turn — TURN credential Worker

Free TURN fallback for restrictive networks (spec §10, ticket 38). A Cloudflare
Worker that mints short-TTL (~1 h) TURN credentials by calling Metered's
expiring-credential REST API **server-side**. The long-lived Metered Secret Key
lives only in the Worker's environment (wrangler secret) — it never ships in
any client bundle.

## Endpoint

`GET /turn/credentials` → `200 { iceServers, username, password, ttlSeconds }`

- Origin-allowlisted (`ALLOWED_ORIGINS` var): only the game's origins may call.
- `GET /healthz` → `200 ok` (liveness probe).
- Any Metered-side failure → `502 { error }`. The client treats non-200 as
  "no TURN this session" and proceeds STUN-direct — Worker failure only
  degrades TURN, never the connection attempt itself.

## Metered API used (verified 2026-09-03)

1. Mint credential (server-side only, Secret Key in query):
   `POST https://<appname>.metered.live/api/v1/turn/credential?secretKey=<SECRET>`
   body `{ "expiryInSeconds": 3600, "label": "<day-bucket>" }`
   → `{ username, password, apiKey, expiryInSeconds, label }`
2. Resolve ICE servers (credential-scoped apiKey, dies with the credential):
   `GET https://<appname>.metered.live/api/v1/turn/credentials?apiKey=<KEY>`
   → `[{ urls, username, credential }, ...]`

Metered's docs explicitly warn: "You should never call this API from the
front-end" — hence this Worker.

## Metered free quota — which limit applies

Metered's own pages conflict on the free TURN quota, and the conflict resolves
by **which signup flow you used**:

| Signup path | Free quota | Notes |
|---|---|---|
| **Open Relay Project** (`dashboard.metered.ca/signup?tool=turnserver`) | **20 GB/month** TURN usage | The path this project uses. Open Relay page (metered.ca/tools/openrelay/) states "20 GB of free TURN Usage every month"; runs on ports 80/443, UDP/TCP/TLS, geo-routed. |
| Premium TURN trial (`/stun-turn` pricing page, `tool=stunturn`) | **500 MB/month** ("trial") | Different product tier — does NOT apply to an Open Relay signup. |

**Resolution: sign up via the Open Relay Project flow → 20 GB/month applies.**
Worst-case fully-relayed play burns ~300–350 MB/hour (3 guests, both relayed
directions), so 20 GB ≈ 60 fully-relayed play-hours/month; real burn is far
lower because ICE prefers STUN-direct whenever it works. Re-verify the number
in the Metered dashboard at signup (spec §18 item 7).

### Abuse response (detection, not prevention)

- CORS/origin allowlist is browser-enforced only — curl can mint credentials
  regardless. Accepted residual risk.
- Credentials carry a per-day `label` (`turn-YYYY-MM-DD`) for usage attribution
  in the Metered dashboard.
- Response: quota webhooks (Metered Projects 80%/100% alerts), label-based
  monitoring, instant credential disable via the Disable Credential API,
  monthly Secret Key rotation.

## Deploy

```sh
# 1. Set the secret (never commit it):
npx wrangler secret put METERED_SECRET_KEY --config workers/turn/wrangler.toml

# 2. Set your Metered domain in wrangler.toml [vars] (Dashboard -> Developers):
#    METERED_DOMAIN = "<appname>.metered.live"

# 3. Deploy:
npx wrangler deploy --config workers/turn/wrangler.toml
```

Local dev: `npx wrangler dev --config workers/turn/wrangler.toml` (needs a
`.dev.vars` file with `METERED_SECRET_KEY` for real calls — tests use fake
fetch, never live Metered).

## Client integration

`src/signaling/iceConfig.ts` fetches this endpoint and assembles the ICE
config: Google STUN primary (`stun:stun.l.google.com:19302`), Open Relay STUN
secondary (`stun:openrelay.metered.ca:80`), Open Relay TURN fallback on ports
80/443 over UDP/TCP/TLS. On any fetch failure it degrades to STUN-only —
unit-tested in `tests/signaling/iceConfig.test.ts`.

## Key-leak verification

The Secret Key exists only in `workers/turn/` (excluded from the Vite client
build — `src/` is the sole client source root) and as a wrangler secret at
runtime. Grep-verify after any bundling change:

```sh
# from repo root, after `npm run build`:
grep -ri "METERED_SECRET_KEY\|secretKey" dist/ && echo "LEAK" || echo "clean"
```

Expected: `clean` — no client bundle contains the secret key name or value.
