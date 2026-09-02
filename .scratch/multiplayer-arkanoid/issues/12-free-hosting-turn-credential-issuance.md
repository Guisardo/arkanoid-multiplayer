# Research: free hosting & TURN credential issuance

Type: research
Status: resolved

## Question

Where is the game served for free, and how are TURN credentials issued without a paid backend?

The infra validation (Research: free WebRTC infra validation) flagged that Open Relay's TURN REST API key would be embedded client-side on a static host — quota-abuse exposure. Investigate: free static hosting options (GitHub Pages, Cloudflare Pages, Netlify free tier, itch.io) for a browser game; whether a free serverless edge function (Cloudflare Workers free tier, Netlify Functions, Deno Deploy) can issue ephemeral TURN credentials (HMAC-SHA1 timed credentials per RFC 8266 REST semantics) so the long-lived key never ships to the client; CORS and latency implications.

Deliver: hosting choice + credential-issuance recipe, or a documented acceptance of the embedded-key risk with mitigations. Informs Netcode sync architecture and the final spec.

## Answer

Host on **GitHub Pages** (git-push deploys, 100 GB/mo soft bandwidth, auto-HTTPS, free custom domain; public repo on free plan) with an optional **itch.io mirror** for discovery; Netlify's new credit model (~20 deploys/mo, ~15 GB) makes it the weakest free option. Issue TURN credentials via a **free Cloudflare Worker**: origin-allowlisted endpoint calls Metered's expiring-credential REST API server-side (Secret Key in a Worker secret, never shipped), returns the `iceServers` array with ~1 h TTL. Metered's credential-scoped API key is front-end-safe by design but quota-burnable — it is the stopgap if the Worker path is dropped. Trade-offs: two providers + one cross-origin fetch; Worker failure only degrades TURN fallback (STUN-direct still works); Metered's 20 GB vs 500 MB free-quota conflict persists and must be verified at signup; abuse mitigation is detection/response (labels, quota webhooks, instant credential disable), not prevention.

Findings: [../research/12-free-hosting-turn-credential-issuance.md](../research/12-free-hosting-turn-credential-issuance.md)
