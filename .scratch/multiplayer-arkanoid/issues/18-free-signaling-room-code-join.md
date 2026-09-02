# Research: free signaling for room-code join

Type: research
Status: resolved
Blocked by: (none)

## Question

How does a guest's room code find the host and exchange SDP/ICE candidates on free infrastructure only?

Establish: free signaling options for a static-hosted WebRTC game — Cloudflare Workers/Durable Objects free tier (already in use for TURN credential issuance, ticket 12); public-broker strategies (BitTorrent trackers, NoStr, MQTT brokers — the Trystero approach); manual copy-paste fallback; any other zero-cost option. For each: capacity, reliability, latency to first connection, abuse/quota exposure, and what happens when it fails. Room code = 5 chars (ticket 06); host-authoritative star, max 3 guest connections (ticket 02).

Deliver: recommended signaling recipe (primary + fallback) for the spec. Informs Assemble implementation-ready spec.

## Answer

Full findings with evidence: [`../research/18-free-signaling-room-code-join.md`](../research/18-free-signaling-room-code-join.md)

- **Primary: Cloudflare Worker + Durable Object signaling room.** Room code → DO via `idFromName(<5-char code>)`, SQLite-backed class (free plan), WebSocket Hibernation API — idle host socket costs nothing (pings auto-answered without waking). Free-tier math: ≈ 10 billed DO requests/session worst case → ~10,000 sessions/day inside 100k/day; duration ≈ 6,400 GB-s at 10k joins/day vs 13,000 allowance. Same account/precedent as the TURN-credential Worker (research 12).
- **Worker front door:** server-side room-code format validation (`^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$`) + Origin allowlist (GitHub Pages host) before proxying the WS upgrade — invalid codes never reach a DO; no embedded keys, closing the quota-burn class research 12 flagged for TURN.
- **Flows:** host opens signaling WS at create-room and holds it open all session (discoverable for lobby-joins between matches + rejoin handshake); guest enters code → DO relays SDP/ICE → guest closes signaling WS once the DataChannel opens — DO never sees game data. TURN creds fetched from the existing credential Worker at join.
- **Fallback: manual copy-paste** — non-trickle SDP (ICE bundled), gzip via `CompressionStream` + base64 ≈ one chat message each way; auto-offered when the signaling WS fails, also behind "Advanced: manual join". Zero infra dependency; doubles as offline/dev-mode connector.
- **Failure UX:** fail-closed — "Room not found" / "Server unavailable" → client offers copy-paste fallback. Signaling-Worker failure never fatal to an in-progress session (game traffic is P2P).
- **Rejected:** Trystero public brokers (mosquitto's own page: "do not rely upon it"; EMQX: prototyping sandbox; capacity unpublished — room resolution must not be probabilistic); PeerJS cloud (room code = peer ID, first-come squatting, no SLA); Ably/Supabase/Firebase/PartyKit (embedded burnable key, Supabase idle-pause, Firebase 100-conn cap, PartyKit wraps the DOs we'd build directly).
- **Caveats:** deploys disconnect all DO WebSockets → deploy rarely, clients auto-reconnect signaling; DO hibernation GB-s savings documented but verify on the free dashboard at first real deploy; Error 1027 (quota exceeded) → fail-closed + fallback.
