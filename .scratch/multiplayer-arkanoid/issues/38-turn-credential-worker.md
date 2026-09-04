# 38 — TURN credential worker

**What to build:** Free TURN fallback for restrictive networks: a Cloudflare Worker calling Metered's expiring-credential REST API server-side (secret in the Worker, ~1 h TTL, origin-allowlisted) — the long-lived key never ships client-side. ICE config: Google STUN (`stun.l.google.com:19302`) + Open Relay STUN secondary; Open Relay TURN fallback (ports 80/443, UDP/TCP/TLS). Worker failure only degrades TURN — STUN-direct still works. Metered free quota verified at signup (20 GB vs 500 MB conflict resolved); abuse response = detection (labels, quota webhooks, credential disable).

**Blocked by:** 37 — Signaling: Cloudflare Worker + Durable Object + copy-paste fallback.

**Status:** resolved

- [x] Worker issues short-TTL TURN credentials; long-lived key absent from all client bundles (verified)
- [x] ICE config assembles: Google STUN primary, Open Relay STUN secondary, TURN fallback on 80/443 UDP/TCP/TLS
- [x] Connection succeeds TURN-only when STUN-direct is blocked (testable via browser throttle/force-relay)
- [x] Credential Worker down → STUN-direct connections still work; only TURN degrades
- [x] Metered free quota verified and documented (which limit applies); quota webhooks/labels configured

