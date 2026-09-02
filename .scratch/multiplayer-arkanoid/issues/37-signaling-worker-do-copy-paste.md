# 37 — Signaling: Cloudflare Worker + Durable Object + copy-paste fallback

**What to build:** Room-code signaling without game logic. Primary: Cloudflare Worker + Durable Object per room — `idFromName(<code>)`, SQLite-backed, WebSocket Hibernation (idle host socket free); front door validates code charset `^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$` + Origin allowlist before WS upgrade; host holds the signaling WS all session; guest closes WS once the DataChannel opens — the DO never sees game data. Fallback: manual copy-paste — non-trickle SDP (ICE bundled), gzip via `CompressionStream` + base64 ≈ one chat message each way; auto-offered on WS failure + "Advanced: manual join" always available; doubles as the dev-mode connector. Failure UX fail-closed: "Room not found" / "Server unavailable" → offer copy-paste. Signaling failure never fatal to in-progress sessions.

**Blocked by:** 22 — Repo scaffold + seam enforcement.

**Status:** ready-for-agent

- [ ] Worker + DO deployed (or wrangler dev-verified): create room → host WS held; join room → guest WS accepted; code charset + Origin validation reject bad input
- [ ] Two browser tabs exchange SDP/ICE via the room code and open a DataChannel (echo test sufficient — no game traffic)
- [ ] Guest WS closes after DataChannel opens; DO sees no game data
- [ ] Copy-paste fallback: full SDP+ICE exchange via compressed base64 string both directions, connectable with the Worker unreachable
- [ ] WS failure auto-offers copy-paste; "Advanced: manual join" always present
- [ ] Unknown code → "Room not found"; Worker down → "Server unavailable" — both offer copy-paste, never a dead end
- [ ] Hibernation works: idle host socket accrues no active-request charges (dev-verified; billing check at 55)
