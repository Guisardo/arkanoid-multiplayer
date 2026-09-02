# Research: free hosting & TURN credential issuance

Resolves: [12-free-hosting-turn-credential-issuance](../issues/12-free-hosting-turn-credential-issuance.md)
Date: 2026-08-30
Question: Where is the game served for free, and how are TURN credentials issued without a paid backend (no key embedded client-side)?

All provider facts below were fetched from the providers' own docs/pricing pages on 2026-08-30. Free-tier numbers change; re-verify at signup.

---

## 1. Hosting comparison facts (free tiers, no card)

| | GitHub Pages | Cloudflare Pages | Netlify Free | itch.io |
|---|---|---|---|---|
| Bandwidth | **100 GB/month soft limit** | **No published bandwidth cap** (limits page lists none for static assets) | **300 credits/month shared pool; 20 credits per GB → ~15 GB/mo** if all credits go to bandwidth | No published cap for free HTML5 games |
| Builds | Soft 10/hour (unlimited via custom Actions workflow); 10-min timeout | 500/month, 1 concurrent, 20-min timeout | **15 credits per production deploy → ~20 deploys/month** then credits exhausted | n/a (manual upload) |
| Size caps | Site ≤ 1 GB (repo soft 1 GB) | 20,000 files/site, 25 MiB per file | Credit-model page states no explicit caps; deploy size effectively bounded by the same credit pool | ZIP ≤ 1,000 files, single file ≤ 200 MB, total ≤ 500 MB extracted |
| HTTPS | Automatic on `*.github.io` (post-2016 sites), "Enforce HTTPS" toggle, Let's Encrypt certs for custom domains | Automatic, always on | Automatic, SSL included | **Forced — "itch.io is an HTTPS website with no exceptions"** |
| Custom domain | Yes, free (apex + subdomain, auto Let's Encrypt) | Yes, 100 per project free | Yes, free with SSL | **No** |
| Agent deploy | **`git push` to a branch** — zero extra tooling; agent already drives the repo | `wrangler pages deploy` CLI or Git integration | Netlify CLI or Git integration | **Web dashboard ZIP upload only** — no documented CLI/API path for HTML5 embeds |
| Constraints | Free plan requires **public repo** (private publishing needs GitHub Enterprise Cloud); not for "primarily commercial" sites | 100 projects/account; new-project creation rate-limited in first 48h | Credit pool is shared across deploys, bandwidth, requests, functions, AI | Game runs in a cross-origin **iframe**; **relative paths required**; case-sensitive file serving; payments = donations only |

Key observations:

- **Netlify's free tier moved to a credit model** (Free = 300 credits, production deploy = 15 credits, bandwidth = 20 credits/GB, web requests = 2 credits/10k). The old generous 100 GB free bandwidth is gone. For an iterative agent-driven deploy loop, ~20 production deploys/month is the tightest build budget of any option. Sources: https://www.netlify.com/pricing/ , https://docs.netlify.com/build/functions/usage-and-billing (fetched 2026-08-30).
- **GitHub Pages**: usage limits documented at https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits — soft 100 GB/month bandwidth, soft 10 builds/hour, 1 GB site, 10-min build timeout. HTTPS docs: https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https. Private (access-controlled) publishing requires Enterprise Cloud, so on a free plan the source repo is public — fine for an open-source game.
- **Cloudflare Pages**: https://developers.cloudflare.com/pages/platform/limits/ (updated 2026-07-16) — 500 builds/mo, 20k files, 25 MiB/file, 100 custom domains/project, unlimited preview deployments; no bandwidth line item for static assets. Deploy via `wrangler` CLI.
- **itch.io**: https://itch.io/docs/creators/html5 — ZIP upload (≤ 1,000 files / 200 MB per file / 500 MB total), mobile-friendly flag exists, HTTPS forced, external API calls must be HTTPS (fine for our STUN/TURN + fetch usage). It is a **distribution/discovery channel**, not an agent-friendly primary host: manual UI upload, no custom domain, iframe sandbox with relative-path requirement.
- **All four serve over HTTPS → secure context for WebRTC (RTCPeerConnection/RTCDataChannel) is satisfied everywhere.** No option fails the WebRTC requirement.

## 2. Credential-issuance options

### 2.1 What Metered/Open Relay actually offers (primary sources)

Metered has a **two-key model** (https://www.metered.ca/docs/turn-rest-api/, fetched 2026-08-30):

- **Secret Key** (Dashboard → Developers): "should never be exposed on the Front End" — used by the *Create TURN Credential* API to mint credentials.
- **Credential API Key**: unique per TURN credential, **explicitly front-end-safe** per docs ("you can use this API Key in the front-end as well as it is credential scoped"). Used with *Get TURN Credential* to fetch the `iceServers` array. Dies with its credential.

**Expiring TURN Credentials API** (https://www.metered.ca/docs/turnserver-guides/expiring-turn-credentials): `POST https://<appname>.metered.live/api/v1/turn/credential?secretKey=<SECRET>` with body `{ "expiryInSeconds": 14400, "label": "user-1" }` returns `{ username, password, apiKey, expiryInSeconds, label }`. Docs carry an explicit warning: "You should never call this API from the front-end." The documented pattern is a backend (for us: an edge function) minting credentials and handing only the short-lived username/password to clients.

- **This replaces the classic coturn HMAC-SHA1 REST scheme**: we do not compute `base64(HMAC-SHA1(secret, expiry-username))` ourselves; Metered's API mints the equivalent server-side. The only documented HMAC-style endpoint is the public Nextcloud/Matrix "static auth" (`staticauth.openrelay.metered.ca`, secret `openrelayprojectsecret`) — but that secret is published on their own page, so it isolates nothing; treat as the free-for-all community endpoint, not a controllable credential.
- **Quota note (unresolved from prior research):** Open Relay's own page still claims **20 GB/month free TURN**; Metered's pricing pages (both /pricing and /stun-turn, fetched 2026-08-30) list Free = **500 MB/month** ("trial"). Conflict persists. REST API access **is** included on the Free plan (listed as a Free feature on /stun-turn). Must be verified with a live account at signup.
- **Mitigation tools on the REST API (all on free tier):** Disable/Delete Credential (instant kill switch), Regenerate Project API Key, per-credential usage stats (`Get Current Usage by User`), **Projects** with per-project quotas + 80%/100% quota webhooks. Good fit for detecting/responding to quota abuse.
- The `pk_live_...` publishable key from the Realtime Messaging SDK is a **signalling** key — it does not grant TURN access.

**So: Open Relay/metered.ca does not offer a fully keyless free option.** The closest is the credential-scoped API key (safe to embed by design, but its quota is burnable by anyone who extracts it until it expires). Proper issuance requires the Secret Key server-side.

### 2.2 Free serverless edge runtimes for the issuer

| | Cloudflare Workers Free | Netlify Functions (credit plan) | Deno Deploy Free |
|---|---|---|---|
| Request quota | **100,000/day** (reset midnight UTC; Error 1027 when exceeded) | Credit pool: 2 credits per 10k web requests (~1.5M req/mo theoretical, but shares the 300 credits with deploys/bandwidth/compute) | **1M requests/month** |
| Compute | 10 ms CPU/invocation (avg Worker ≈ 2.2 ms) — one `fetch` + JSON passthrough fits easily | 10 credits per GB-hour, 1 GB default → ~0.0003 credits per 200 ms call; negligible per call, shares pool | 10 hr active CPU/month, 150 GiB-hr memory |
| Cold starts | **V8 isolates — effectively none**; startup budget 1 s enforced at deploy, no container boot | AWS Lambda-based → real cold starts (observable; Netlify publishes no number) | Isolates, but **idle apps scale to zero after ~20–30 s** (documented) → scale-from-zero on every quiet period |
| CORS | Full control — you set `Access-Control-Allow-Origin` allowlist manually | Manual headers; if function co-hosted with Netlify site, same origin → **no CORS needed** | Full control, manual headers |
| Secret handling | Env secrets (`wrangler secret put`) — never in bundle | Env vars | Env vars |
| Extra notes | 50 subrequests/invocation; subrequest to Metered = 1 of 50 | Immutable per-deploy; logs via Observability | 20 GiB egress/month (responses are tiny — irrelevant) |

Sources: https://developers.cloudflare.com/workers/platform/limits/ (2026-07-28), https://developers.cloudflare.com/workers/platform/pricing/ (2026-08-28), https://docs.netlify.com/build/functions/usage-and-billing , https://deno.com/pricing (all fetched 2026-08-30).

Quota math for our game: each session needs one credential issuance per client (4 per session) — or even one per session shared by all four peers via the host. 100k req/day on Workers ≈ 25k sessions/day (worst case) — orders of magnitude beyond need. CORS preflight avoided by issuing a plain GET with no custom headers.

### 2.3 Fallback: accepted embedded-key risk (if no edge function)

Embed the **credential-scoped API key** (never the Secret Key) client-side; client calls *Get TURN Credential* directly. Mitigations, all documented available: create the credential with a short `expiryInSeconds`; label it for attribution; monitor per-label usage via REST; delete/recreate the credential to rotate (manual dashboard chore without a server). Residual risk: anyone extracting the key relays traffic on your quota until expiry — and quota may be only 500 MB/mo (unverified). Acceptable only as a stopgap.

## 3. Recommendation

### Hosting: **GitHub Pages** (primary) + optional itch.io mirror

- `git push` deploy matches an agent-driven workflow exactly — the repo is the deploy artifact, no extra CLI, no account beyond GitHub.
- 100 GB/month soft bandwidth is ample for a small static bundle (e.g., 5 MB game → 20k plays/month; far above expected traffic).
- Automatic HTTPS on `github.io` → secure context for WebRTC satisfied.
- Repo must be public on the free plan — fine for an open-source game; if that ever bothers us, **Cloudflare Pages is the drop-in alternative** (unmetered static bandwidth, `wrangler pages deploy`, 100 free custom domains) and we will hold a Cloudflare account anyway for the Worker.
- **itch.io as a mirror** for player discovery (manual ZIP upload, mobile-friendly flag, forced HTTPS, no custom domain, relative paths).
- **Netlify deprioritized**: the 2026 credit model (≈20 production deploys/month, ≈15 GB bandwidth ceiling) is the weakest free offering for an iterative agent loop.

### Credential issuance: **Cloudflare Worker edge function + Metered expiring-credential API**

1. Free Metered account (no card) → note `<appname>.metered.live` domain and **Secret Key**; verify actual free quota (20 GB vs 500 MB conflict) at signup.
2. Cloudflare Workers free plan: one tiny Worker, `wrangler secret put METERED_SECRET_KEY`.
3. Client (at lobby join) calls `GET https://<worker>.workers.dev/api/turn-credentials`.
4. Worker:
   - checks `Origin` against an allowlist (`https://<owner>.github.io`), returns CORS headers for that origin only;
   - `POST https://<appname>.metered.live/api/v1/turn/credential?secretKey=$SECRET` with `{ "expiryInSeconds": 3600, "label": "<ip-or-day-hash>" }`;
   - takes the returned `apiKey` → `GET .../api/v1/turn/credentials?apiKey=...` → passes the resulting `iceServers` array back verbatim (correct TURN URLs per account, geo-routed).
5. Client configures `RTCPeerConnection` with returned `iceServers`; credential lives ≤ 1 hour; all four peers in a session may share one issuance.
6. Optional hardening (all free): cache the credential in Workers KV (100k reads/day free) until near-expiry so each session needs zero Metered calls; per-IP rate limit via KV; Metered **Projects** quota + 80% webhook as abuse alarm; Disable Credential API as instant kill switch; monthly Secret Key rotation via dashboard.

The long-lived Metered Secret Key never ships to the client — the prior research's HIGH risk is closed at $0. Latency cost: one extra hop (client → Worker → Metered) at session start, on isolate-fast Workers — negligible vs. ICE gathering itself.

## 4. Trade-offs

1. **Two providers instead of one** (GitHub Pages + Cloudflare Worker): one extra free account and one cross-origin fetch (CORS, trivial). Alternative: consolidate on Cloudflare (Pages + Worker, same dashboard, no CORS if same zone) at the cost of losing plain `git push` deploys. Either is defensible; consolidation is the fallback if the split ever hurts.
2. **Workers quota is a new runtime dependency**: if the Worker exceeds 100k req/day or is down, TURN fallback is unavailable — but the game itself still works, because most pairs connect STUN-direct. Spec requirement: client treats issuer failure as "no TURN this session," never as a fatal error.
3. **CORS is browser-enforced, not attacker-proof**: curl can mint credentials through the Worker regardless of the allowlist. Mitigations: short TTL (1 h), per-IP rate limit, labels for usage attribution, quota webhooks, instant credential disable. Residual: a determined abuser can still burn TURN quota until detected — detection/response, not prevention.
4. **Metered quota ambiguity persists** (20 GB vs 500 MB on their own pages, re-confirmed 2026-08-30). The Worker protects the key, not the gigabytes. If the effective quota is ~500 MB/mo, worst-case fully-relayed sessions (~300–350 MB/hour) make TURN genuinely scarce → verify at signup, prefer STUN-only paths (ICE does this automatically), keep Xirsys dev tier as stacked secondary.
5. **Single small-vendor TURN dependency** (unchanged from prior research): Open Relay is one company's freebie, no SLA. The Worker recipe makes swapping providers cheap — one endpoint to change.
6. **Cold starts**: Workers = isolates (effectively none) — the deciding factor vs. Netlify (Lambda cold starts) and Deno Deploy (scales to zero after ~20–30 s idle; fine for a hobby game but real).
7. **itch.io mirror means maintaining relative paths and case-sensitive filenames** — cheap if done from day one, annoying to retrofit.
