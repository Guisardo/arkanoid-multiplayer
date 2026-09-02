# Research: free signaling & room-code join

Resolves: [18-free-signaling-room-code-join](../issues/18-free-signaling-room-code-join.md)
Date: 2026-09-01
Question: How does a guest's room code find the host and exchange SDP/ICE candidates on free infrastructure only?

All provider facts below were fetched from the providers' own docs/pricing pages, protocol specs, or source code on 2026-09-01. Free-tier numbers change; re-verify at signup.

---

## 1. Cloudflare Workers / Durable Objects free tier

**Durable Objects are available on the Workers Free plan** — SQLite-storage-backed classes only (the key-value backend is restricted to accounts that already had one). Exceeding any free limit makes further operations of that type fail with an error (no billing); daily limits reset at 00:00 UTC.
- Source: https://developers.cloudflare.com/workers/platform/pricing/#durable-objects (2026-08-28), https://developers.cloudflare.com/durable-objects/platform/pricing/ (2026-08-25)

**Exact free limits (Workers Free plan):**

| Dimension | Free limit | Notes |
|---|---|---|
| Worker requests | 100,000/day | Error 1027 when exceeded; resets midnight UTC |
| Worker CPU | 10 ms/invocation | Avg Worker ≈ 2.2 ms — one WS proxy fits easily |
| DO requests | 100,000/day | Includes HTTP requests, RPC sessions, **WebSocket connection creations, and alarm invocations** |
| DO duration | 13,000 GB-s/day | Billed at 128 MB allocated per active object; **hibernating objects accrue none** |
| DO rows read / written | 5M / 100,000 per day | SQLite backend; each `setAlarm()` = 1 row written |
| DO storage | 5 GB total | ≈ 12 KB minimum per empty object — room records are bytes |
| DO classes / objects | 100 classes/account, objects unlimited | Room = one object via `idFromName(roomCode)` |
| Per-object throughput | ~1,000 req/s soft limit | Then "overloaded" error to caller |
| WebSocket message size | 32 MiB (received) | SDP/ICE payloads are ~1–2 KB |
| Workers KV (alt path) | 100k reads/day, **1,000 writes/day**, 1 GB | KV-only room registry caps at ~1k room-create writes/day — tight; DO avoids this |

- Sources: https://developers.cloudflare.com/workers/platform/limits/ (2026-07-28), https://developers.cloudflare.com/durable-objects/platform/limits/ (2026-06-01), https://developers.cloudflare.com/durable-objects/platform/pricing/ (2026-08-25)

**WebSocket billing mechanics (decisive for us):**

- Creating a WebSocket connection to a DO costs 1 request; **incoming WebSocket messages are billed at a 20:1 ratio** (100 messages = 5 billed requests); outgoing messages and protocol-level pings are free; auto-response messages via `setWebSocketAutoResponse()` incur no wall-clock time. Source: https://developers.cloudflare.com/durable-objects/platform/pricing/ (2026-08-25)
- **WebSocket Hibernation API** (recommended by Cloudflare): clients stay connected while the object sleeps; GB-s charges do not accrue while idle; runtime auto-answers ping frames without waking the object; state restored per-socket via `serializeAttachment` (max 16,384 bytes). Source: https://developers.cloudflare.com/durable-objects/best-practices/websockets/ (2026-06-19)
- Caveat: "Code updates disconnect all WebSockets. Deploying a new version restarts every Durable Object, which disconnects any existing connections." Source: same page. → Deploy rarely; clients must auto-reconnect signaling.
- Cloudflare's own Durable Objects product page names this exact use case: "Power multiplayer games and interactive experiences — One object per game session manages player state… Each game room scales independently" and chat rooms ("one object per chat room… global consistency"). Source: https://www.cloudflare.com/developer-platform/durable-objects/ (fetched 2026-09-01)

**Quota math for our game (host-authoritative star, ≤3 guests, 5-char room code):**

- One session = 4 WebSocket upgrades (host + 3 guests) + signaling traffic. One join ≈ 20–40 small messages (offer/answer + trickle ICE, or ~10 messages if ICE bundled); at 20:1 billing ≈ 1–2 billed requests per join. Say **≈ 10 billed DO requests per session** worst case → 100,000/day ≈ 10,000 sessions/day — four orders of magnitude beyond a friends-and-family audience.
- Duration: with hibernation, the object is active only while handling messages. Even 10,000 joins/day × 5 s active × 128 MB ≈ 6,400 GB-s — under half the 13,000 GB-s daily allowance; a host holding its signaling socket open all session costs nothing while idle (pings are auto-answered without waking).
- Rows written: room create + per-join bookkeeping + alarms ≈ tens per session → far under 100,000/day.
- **Verdict: room-code → host lookup + full SDP/ICE relay fits comfortably inside the free tier, with hibernation as the load-bearing trick.** The existing TURN-credential Worker already establishes the Cloudflare account/precedent.

## 2. Public-broker strategies (the Trystero approach)

Trystero is the primary source for this technique: "no server required… Peers can connect via BitTorrent, Nostr, MQTT, Supabase, Firebase, IPFS, or a self-hosted WebSocket relay." Peers hash `appId`+`roomId` into a topic on a public pub/sub network, announce presence, and exchange SDP through it; "Beyond peer discovery, your app's data never touches the strategy medium." SDP is AES-GCM-encrypted with a key derived from app ID + room ID (or a shared `password`) so relays don't see plaintext session descriptions. Source: https://github.com/dmotz/trystero README (fetched 2026-09-01).

### 2.1 BitTorrent (WebSocket) trackers

- Mechanism: WebTorrent WebSocket tracker protocol (bittorrent-tracker client & server; "WebTorrent trackers (BEP forthcoming)" — i.e. not a finalized BEP). Topic → 20-hex-char info_hash = `sha1(topic).slice(0,20)`; clients announce with `peer_id`, exchange JSON `offer`/`answer` records; tracker dictates re-announce `interval`. Trystero defaults: announce every 10 s (tracker-adjustable), offer pool size 3, dormant 120 s, **non-trickle ICE by default** (SDP bundled), default redundancy 3 trackers. Sources: https://github.com/webtorrent/bittorrent-tracker README, Trystero source `packages/torrent/src/index.ts` (both fetched 2026-09-01).
- Trystero's default tracker list (from source): `wss://open.ftorrent.com`, `wss://tracker.webtorrent.dev`, `wss://tracker.openwebtorrent.com`, `wss://tracker.btorrent.xyz`, `wss://tracker.files.fm:7073/announce`. None of these publish capacity, rate limits, or SLAs — community infrastructure. Trackers can send `failure reason`/`warning message` at any time (handled and warned by Trystero source).
- Abuse exposure: anyone announcing on the same topic can collect SDPs of everyone in the "room" (mitigated by Trystero's SDP encryption, but the app ID + room ID are derivable by anyone reading the public wire with the public client code); a public tracker can rate-limit or vanish without notice.

### 2.2 NoStr relays (Trystero's default)

- Mechanism: NIP-01 protocol — signed events (`["EVENT", …]`) published to relay WebSockets, subscriptions via `["REQ", subId, {kinds, "#x": [topic], since}]`; kinds 20000–29999 are **ephemeral** ("not expected to be stored by relays") — Trystero maps each topic to `kind = strToNum(topic, 10000) + 20000`. Relays answer `["OK", id, false, "rate-limited: …"]` or `["CLOSED", …]` on rejection; Trystero backs off and retires misbehaving relays. Sources: NIP-01 spec https://github.com/nostr-protocol/nips/blob/master/01.md, Trystero source `packages/nostr/src/index.ts` (fetched 2026-09-01).
- Trystero ships 29 default relays with default redundancy 5; announcement cadence: immediate on join, then every 60 s steady; relay-ack timeout 5.3 s; backoff capped at 15 min. (Source: same file.)
- Trystero's own guidance: default NoStr "highly decentralized with hundreds of active relays… good choice if you're interested in decentralization and high redundancy. The other decentralized strategies are recommended in the order of MQTT, BitTorrent, and IPFS, based on robustness." (README, "Which strategy should I choose?")
- Latency to first connection: newcomer announces immediately on join; incumbents hear the announcement within relay propagation time (typically sub-second to a few seconds). No primary source publishes a figure; treat as observed-behavior, not guaranteed.
- Abuse exposure: same as trackers — public infrastructure you don't own, readable by anyone; relays may rate-limit ("rate-limited:" is a standardized NIP-01 rejection).

### 2.3 Public MQTT brokers

- Trystero defaults (from source): `wss://test.mosquitto.org:8081/mqtt`, `wss://broker.emqx.io:8084/mqtt`, `wss://public:public@public.cloud.shiftr.io`, `wss://broker-cn.emqx.io:8084/mqtt`, `wss://broker.hivemq.com:8884/mqtt`; default redundancy 4; announcements retained per-topic while active.
- **test.mosquitto.org's own page explicitly disclaims reliability**: "You are free to use it for any application, but please do not abuse or rely upon it for anything of importance… it will often be running unreleased or experimental code and may not be as stable as you might hope. It may also be slow — the broker often runs under valgrind or perf… In particular, **websockets and TLS support are the most likely to be unavailable**." Plus: "Please don't publish anything sensitive, anybody could be listening." Source: https://test.mosquitto.org/ (fetched 2026-09-01).
- EMQX's public broker page confirms `broker.emqx.io` WSS on port 8084 path `/mqtt`, purpose "for developers to prototype, learn, and test MQTT — with zero setup", and warns: "This is a public broker. All messages are visible to other users. Do not send sensitive data." Source: https://www.emqx.com/en/mqtt/public-mqtt5-broker (fetched 2026-09-01).
- **Verdict on public brokers: zero-cost and zero-account, but you inherit other people's experimental infrastructure with no SLA, no published capacity numbers, and plaintext visibility (mitigated only by Trystero's SDP encryption). Acceptable as a hobby discovery layer; unacceptable as the only path to a room.**

## 3. Manual copy-paste fallback

- Feasibility: a DataChannel-only SDP offer is ~1–2 KB of text. Non-trickle ICE (bundle all candidates into the SDP before showing it — exactly what Trystero does for its tracker strategy, `trickleIce: false` default there) collapses signaling to **one offer + one answer**, two copy operations.
- Compression: `CompressionStream("gzip")` is Baseline "widely available" since May 2023 — works in all target browsers (Chrome, Firefox, Safari, Android Chrome). gzip+base64 of a 1–2 KB offer lands around 400–900 characters — one paste into any chat app. Source: https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream (fetched 2026-09-01).
- QR option: QR byte-mode capacity at error-correction L is 271 bytes (Version 10, 57×57 modules) and 748 bytes (Version 20) per DENSO Wave's capacity table — a compressed offer may fit a mid-size QR, but the answer must still travel back by text. Source: https://www.qrcode.com/en/about/version.html (fetched 2026-09-01). For our 5-char room code in a join URL, QR is trivial (alphanumeric mode, tiny symbol).
- UX cost: host and guest must exchange two text blobs over some out-of-band channel (chat, phone call). For a friends-and-family audience this is a 60-second chore — fine as a failure fallback, poor as the primary flow.
- Failure behavior: none beyond human error and the usual ICE failure; there is no server to be down. This is the only option with **zero infra dependency**.

## 4. Other zero-cost options (developer-registered key, no player accounts)

| Service | Free tier (published) | Key model | Catch |
|---|---|---|---|
| **PeerJS cloud server** | No published limits; docs say "Use our free cloud server or host your own PeerServer" | **No account at all** — shared community server, first-come ID squatting | No SLA, no published capacity, anyone can claim your room-code-as-ID before you do |
| **Ably Free** | 200 concurrent connections, 500 msg/s, 6M msgs/mo, 200 channels, 64 KiB msg | Dev account; client-usable key shipped in bundle | Generous and documented, but a new vendor dependency + exposed key can burn quota (same class of risk already flagged for TURN keys) |
| **Supabase Free (Realtime)** | 200 concurrent peak connections, 2M msgs/mo, 256 KB max message | Dev account; `anon` key shipped client-side (standard pattern) | **"Free projects are paused after 1 week of inactivity"** — an always-on lobby dies without weekly pings |
| **Firebase RTDB (Spark)** | **100 simultaneous connections**, 1 GB stored, 10 GB/mo egress | Dev account; database URL + rules public; Trystero README documents exact security rules to lock rooms to a `__trystero__` namespace | 100 connections is the tightest cap of any option; fine for signaling-only, fatal if held during play |
| **PartyKit free** | 10 live projects, storage cleared every 24 h; or deploy to your own Cloudflare account free | Dev account | Joined Cloudflare (Apr 2024); effectively a Durable Objects wrapper — adopting it adds a layer over what we'd build directly |
| **Metered Realtime Messaging** | 100 connections, 100k msgs/mo | Dev account | Vendor-coupled SDK; from prior research 02 |

- Sources: https://peerjs.com/ , https://github.com/peers/peerjs-server (self-host `concurrent_limit` default 5000), https://ably.com/pricing , https://supabase.com/pricing , https://firebase.google.com/pricing , https://partykit.io/ , https://github.com/dmotz/trystero README (Firebase/Supabase setup sections) — all fetched 2026-09-01.
- Quota-abuse flag (consistent with the TURN-key finding in research 12): a developer-registered key embedded in a static client (Ably/Supabase/Firebase anon) is extractable by anyone and its quota is burnable until rotated. Detection/response only, not prevention. PeerJS cloud avoids keys entirely but replaces quota risk with ID-squatting risk.

## 5. Comparison

| Option | Capacity | Reliability | Latency to first connection | Abuse/quota exposure | Failure behavior (what joiner sees) |
|---|---|---|---|---|---|
| **CF Worker + Durable Object** | ~10k sessions/day inside free tier (math §1); 1k req/s per room | Owned infra; deploys disconnect sockets (reconnect logic needed); no SLA on free but same vendor as TURN Worker | One RTT to CF edge + one RTT to DO — sub-second typical; WS push (no polling) | Origin allowlist + room-code validation + per-room object isolation; quota exceeded → hard error to you, not strangers' traffic | "Room not found" / "Server unavailable" → client offers copy-paste fallback |
| **Trystero/torrent** | Unpublished (community trackers) | No SLA; tracker failure/warning messages standardized | Announce burst on join; tracker interval up to 10 s | Public topic readable; SDP encrypted by Trystero | `onJoinError` / silent announce failure → stuck "joining…" |
| **Trystero/NoStr** | Unpublished (29 relays, redundancy 5) | Decentralized; relay CLOSED/rate-limited handled with backoff | Immediate announce; propagation sub-second–seconds | Same as trackers | Same |
| **Trystero/MQTT** | Unpublished | **Worst:** mosquitto "do not rely upon it… websockets most likely to be unavailable"; EMQX "prototype, learn, test" | Immediate (retained announce) | Same; plaintext on broker unless SDP-encrypted | Broker restart drops socket; Trystero reconnects |
| **PeerJS cloud** | Unpublished | Shared free server, no SLA | Sub-second typical | ID squatting (room code = peer ID, first-come) | "ID taken" / unavailable errors |
| **Ably/Supabase/Firebase** | Published (200 conn / 200 conn / 100 conn) | Commercial vendors, best uptime of the class | Sub-second | Embedded dev key quota burn | Connect rejected at limit → error |
| **Copy-paste/QR** | Unlimited | No server to fail | Human-speed (~a minute) | None | Only ICE/network failure (existing TURN fallback covers) |

## 6. Recommendation

### Primary: Cloudflare Worker + Durable Object signaling room (free tier, SQLite-backed, WebSocket Hibernation)

The room code maps to a Durable Object via `idFromName(<5-char-code>)`; one object = one room = the exact "one object per game session" pattern Cloudflare's own docs advertise for multiplayer games.

1. **Worker front door** (same Worker/account as the existing TURN-credential endpoint, or a sibling): validates the room-code format server-side (`^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$`) and checks `Origin` against the GitHub Pages host, then proxies the WebSocket upgrade to the DO. Invalid codes never reach a DO — cheap abuse containment.
2. **Room DO** (SQLite class, `new_sqlite_classes` migration): role-tagged sockets (host + up to 3 guests, enforced in-object); stores host SDP + ICE in SQLite; relays offers/answers/candidates between host and the requesting guest; per-socket `serializeAttachment` for hibernation; `setAlarm()` TTL to garbage-collect dead rooms (alarm = 1 request + 1 row write).
3. **Host flow**: on "create room", host opens the signaling WS and **keeps it open for the whole session** — hibernation makes an idle socket free, and it keeps the host discoverable for late joins and the rejoin-handshake (Q10) path.
4. **Guest flow**: enter code → WS to `/room/<code>/ws` → DO returns "room not found" or relays signaling → once the RTCDataChannel opens, the guest **closes its signaling WS** (all game traffic is P2P; the DO never sees game data).
5. **TURN**: guests fetch ephemeral TURN creds from the existing credential Worker at join, exactly as specced in research 12. ICE failure at this point is a TURN problem, not a signaling problem.
6. **Client rule from prior research carried forward**: signaling-Worker failure is never fatal — it degrades to "no auto-join this session," never an error screen.

Reasoning: it is the only option with published, sufficient capacity (§1 math), the lowest latency (push, no announce intervals), it reuses an account/precedent we already hold, it needs no third-party key in the bundle (closing the quota-abuse class that research 12 flagged for TURN), and the failure mode is deterministic and testable. Public brokers (Trystero) and key-embedded services both fail on either reliability or abuse exposure for a room-code lobby whose whole job is "this 5-char code resolves right now."

### Fallback: manual copy-paste with compressed non-trickle SDP

Offer/answer with ICE bundled (no trickle), gzip via `CompressionStream` + base64 → ~one chat message each way. Kept behind a "Advanced: manual join" affordance and surfaced automatically when the signaling WS fails. Zero infra, zero accounts, cannot be rate-limited, and it exercises the same non-trickle SDP code path a QR flow would need — so it is cheap to build and doubles as the offline/dev-mode connector. For a casual friends-and-family audience, a once-a-year fallback chore is acceptable where a primary-flow chore is not.

### Rejected middle options (recorded for the spec's trade-offs section)

- **Trystero public brokers** (torrent/NoStr/MQTT): tempting zero-server path, but every default relay is someone else's freebie with no SLA and no published capacity (mosquitto's own page tells you not to rely on it; EMQX labels the public broker a prototyping sandbox). Adopting it would make room resolution probabilistic — the one thing a room code must not be.
- **PeerJS cloud**: zero-account and effortless, but the room code *is* the peer ID on a shared community server — squatting and no SLA. Self-hosting PeerServer reintroduces a server we'd rather build as a DO.
- **Ably/Supabase/Firebase/PartyKit**: all viable, all either add an embedded burnable key (the exact HIGH risk research 12 closed for TURN), pause after idle (Supabase), cap hard at 100 connections (Firebase Spark), or wrap the Durable Objects we'd use directly (PartyKit).

## 7. Conflicts / unresolved

- **Public-broker capacity is unpublished by design** (community trackers, NoStr relays, mosquitto, EMQX public, PeerJS cloud). Unresolvable from primary sources; it is the structural reason they are rejected as primary.
- **Trystero default tracker list liveness**: `open.ftorrent.com` and `tracker.files.fm:7073` have no published status pages; uptime unverifiable from docs. Trystero mitigates via multi-tracker redundancy (3 of 5 by default).
- **Real-world latency-to-first-connection for public brokers** is observable behavior (Trystero announce cadences are in source: immediate burst, 60 s steady for NoStr, 10 s/interval for trackers), but no primary source publishes end-to-end numbers. Prototype-verify.
- **DO duration headroom** relies on hibernation working as documented (idle sockets free, pings auto-answered). Verify actual GB-s consumption on the free dashboard during the prototype.
- **Cloudflare free-plan Error 1027 behavior** for Workers routes supports fail-open or fail-closed; for the signaling Worker choose fail-closed + client-side copy-paste fallback (never silently bypass validation).

## 8. Source index (all fetched 2026-09-01 unless noted)

- Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/ (page updated 2026-08-28)
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/ (2026-07-28)
- Cloudflare Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/ (2026-08-25)
- Cloudflare Durable Objects limits: https://developers.cloudflare.com/durable-objects/platform/limits/ (2026-06-01)
- Cloudflare DO WebSockets/Hibernation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/ (2026-06-19)
- Cloudflare DO product page (multiplayer use case): https://www.cloudflare.com/developer-platform/durable-objects/
- Trystero README + strategy source: https://github.com/dmotz/trystero , `packages/{torrent,nostr,mqtt}/src/index.ts`
- WebTorrent tracker: https://github.com/webtorrent/bittorrent-tracker
- NoStr NIP-01: https://github.com/nostr-protocol/nips/blob/master/01.md
- test.mosquitto.org: https://test.mosquitto.org/
- EMQX public broker: https://www.emqx.com/en/mqtt/public-mqtt5-broker
- PeerJS: https://peerjs.com/ , https://peerjs.com/docs/ , https://github.com/peers/peerjs-server
- Ably: https://ably.com/pricing
- Supabase: https://supabase.com/pricing
- Firebase: https://firebase.google.com/pricing
- PartyKit: https://partykit.io/
- MDN CompressionStream: https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream
- DENSO Wave QR capacity: https://www.qrcode.com/en/about/version.html , https://www.qrcode.com/en/about/error_correction.html
