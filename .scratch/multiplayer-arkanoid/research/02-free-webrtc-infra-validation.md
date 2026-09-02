# Research: free WebRTC infra validation

Resolves: [02-free-webrtc-infra-validation](../issues/02-free-webrtc-infra-validation.md)
Date: 2026-08-30
Question: Can 4-player remote play run on free infrastructure only, and what is the exact recipe?

Verdict: **Yes, viable** — free STUN (Google) for the common case, Open Relay free TURN as fallback, host-authoritative star mesh over RTCDataChannel. Caveats: TURN free-tier quota numbers conflict across Metered's own pages, and a hidden/backgrounded host device can stall the whole session.

---

## 1. Free STUN servers

**Facts:**

- `stun:stun.l.google.com:19302` is alive and current: it is the ICE server used in webrtc.org's own official sample code (page last updated 2025-11-10). Google publishes no usage limits, no SLA, and no deprecation notice for it. It has run for ~15 years and is the de-facto default in WebRTC docs.
  - Source: https://webrtc.org/getting-started/peer-connections (2025-11-10)
- Google STUN is not "yours": no guarantee, no support, could change without notice. Standard practice is to list 2–3 STUN servers from different providers so one DNS outage doesn't kill connectivity.
- Open Relay also exposes free STUN alongside its TURN (`stun:openrelay.metered.ca:80`).
  - Source: https://www.metered.ca/tools/openrelay/ (2026)
- Twilio's `stun:global.stun.twilio.com:3478` exists but is only reachable via Network Traversal Service tokens minted server-side with Twilio account credentials — not usable for a zero-backend static site.
  - Source: https://www.twilio.com/docs/stun-turn (2026-08-27)
- Cloudflare publishes `stun:stun.cloudflare.com:3478/udp`, but their docs only describe TURN pricing ("free of charge when used together with the Realtime SFU"); they do not commit to standalone free STUN. Do not rely on it as a free STUN.
  - Source: https://developers.cloudflare.com/realtime/turn/ (2026-04-21)

**Conclusion:** Use Google STUN as primary, Open Relay STUN as secondary. Both free, no signup needed for STUN.

## 2. Free TURN options

**Facts per provider:**

| Provider | Free offer | Quota | Credit card | Verdict |
|---|---|---|---|---|
| Open Relay Project (Metered, openrelay.metered.ca) | Free TURN, ports 80/443, TCP+UDP+TLS(turns), geo-routed | **20 GB/month TURN usage** per Open Relay page — but Metered's own pricing page lists the free TURN plan as **500 MB/month "trial"**. Conflicting numbers on the same company's pages. | No ("No credit card required" on signup) | **Best free option; primary fallback.** |
| Cloudflare Calls TURN | Free **only** when used with Cloudflare's Realtime SFU; standalone TURN costs $0.05/GB outbound | Per-allocation limits generous (5–10 kpps, 50–100 Mbps) but irrelevant — standalone use is paid | n/a | **Excluded — not free for P2P use.** |
| Twilio Network Traversal Service | No free tier; trial credit only | Pay per MB relayed (both directions summed) | Account + server-side token minting required | **Excluded — paid + needs backend.** |
| Xirsys | 30-day free trial with full 12-region network, then "free forever on ongoing Developer limits" (limits not stated on page); STUN stays free, TURN bandwidth is paid | Unclear post-trial | Sign-up free | **Excluded as primary — trial-shaped, vague forever-limits. Possible secondary.** |

- Sources: https://www.metered.ca/tools/openrelay/ , https://www.metered.ca/pricing/ , https://developers.cloudflare.com/realtime/turn/ , https://www.twilio.com/docs/stun-turn/faq , https://xirsys.com/ (all fetched 2026-08-30)

**Open Relay mechanics (important for a static free-hosted site):**

- Real usage path: sign up free → get an API key → at runtime call `https://yourappname.metered.live/api/v1/turn/credentials?apiKey=API_KEY` → returns an `iceServers` array with ephemeral TURN credentials. The credentials API key is meant to be called from a server; **embedding it in a client exposes it to quota abuse** (see risk list). Their publishable `pk_live_...` signalling key model does not apply to the TURN REST API.
- Static-auth endpoint exists (`staticauth.openrelay.metered.ca` with shared secret `openrelayprojectsecret`) but the publicly documented `username: openrelayproject / credential: openrelayproject` config is explicitly labeled "not real urls, you need to create a account" — treat as placeholder, not a usable free credential.
- Same company also offers free managed signalling ("Realtime Messaging": 100 connections, 100k messages/month free) and an MIT JS SDK (`@metered-ca/realtime`) — could serve the room-code lobby, but adopting their SDK couples the session/lobby flow to a vendor (decision for the Netcode/Session tickets, not this one).

**Quota math for our game:** host-authoritative, 3 guest DataChannels, ~256-byte state snapshot at 60 Hz ≈ 15 KB/s per peer, ~45 KB/s host-side total. If ALL three guest connections go through TURN (worst case), counting both relayed directions that is roughly ~300–350 MB per hour of play. At the claimed 20 GB/month that is ~60 fully-relayed play-hours/month (TURN fallback typically engages for only a minority of peers, so real burn is far lower). At the 500 GB→**500 MB** reading, it is ~1.5 hours/month — the difference matters; must be re-verified at signup.

## 3. RTCDataChannel support (caniuse, fetched 2026-08-30)

**Facts (https://caniuse.com/mdn-api_rtcdatachannel, global support 96.39%):**

- Chrome desktop: supported since 24 (current 154) ✅
- Chrome for Android: supported ✅
- Firefox: since 22 (current 157) ✅
- Safari desktop: since 11 (current 27) ✅
- Safari on iOS: since 11 (current 26.6) ✅
- Edge: since 79 (current 151) ✅
- Samsung Internet: since 4 ✅
- No partial-support flags on any current target browser; only legacy IE and pre-2016 browsers lack it.

**Quirks:** none material for our targets today. Historical footnotes (Safari < 11 had none; older Safari versions had SCTP negotiation quirks) are outside the support window. Practical note: design for `binaryType: "arraybuffer"` and feature-detect, per MDN — but no current target browser fails.

## 4. Host-authoritative topology feasibility

**Facts:**

- webrtc.org: "For most WebRTC applications to function a server is required for relaying the traffic between peers, since a direct socket is often not possible between the clients" — TURN is the standard answer, and "most commercial WebRTC based services use a TURN server."
  - Source: https://webrtc.org/getting-started/turn-server (2023)
- Open Relay/Metered docs: STUN "does not always work… firewall rules and symmetrical NATs and many other situations" → TURN fallback required in those cases.
  - Source: https://www.metered.ca/tools/openrelay/stun-servers-and-friends
- Known NAT shape driver: consumer home routers are usually full-cone or address/port-restricted NAT (STUN succeeds); symmetric NAT (and carrier-grade NAT on cellular) breaks STUN peer-reflexive pairing → TURN needed. This is textbook ICE behavior (RFC 8445/8489), reflected in all cited docs.
- **No primary source publishes a hard "% fail without TURN" figure.** The widely-cited industry estimate is ~80–90% of consumer-to-consumer pairs connect with STUN alone, ~10–20% need TURN; treat that as folklore, not verified fact. For our worst case (any one of 3 host↔guest pairs failing = that guest needs TURN), expected per-session TURN engagement is higher than per-pair rate.

**Feasibility of the star topology itself:**

- One host device holding game state + 3 `RTCPeerConnection`s (one per guest device), each with an RTCDataChannel, is exactly the shape webrtc.org documents (per-peer connections, trickle ICE, `connectionstatechange` for readiness). No mesh-between-guests needed — guests never talk to each other, only to the host. Max 3 simultaneous peer connections per host is trivial load.
- 20–60 state updates/sec over DataChannel is far below any documented channel limit (Cloudflare's TURN allocation limits, for comparison, allow 5–10k packets/sec). Bandwidth ≈ 45 KB/s aggregate at 60 Hz — negligible for P2P and well inside the TURN worst-case math above.
- Split-screen + remote combinable sessions don't change the picture: 2 local players on the host device share one peer connection's traffic; 2 local players on a guest device likewise.

**Verdict: topology feasible on free infra.** DataChannel never traverses anything but DTLS; TURN relay cannot read game data (relay is transport-only, per both Cloudflare and Metered docs) — relevant to the later trust-boundary ticket.

## 5. Mobile browser quirks that bite networked play

**Background-tab throttling (verified, high confidence):**

- Chrome 88+ intensive throttling: hidden page + chain count ≥ 5 + silent ≥ 30 s + hidden ≥ 5 min → timers checked once per **minute**. Critical exemption for us: **"WebRTC is in use" (an `RTCPeerConnection` with an open `RTCDataChannel` or live `MediaStreamTrack`) keeps the page out of intensive throttling** — timers stay at the once-per-second "throttling" tier. MDN confirms: tabs using WebRTC/WebSockets "go unthrottled."
  - Sources: https://developer.chrome.com/blog/timer-throttling-in-chrome-88 (2021), https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API (2025-12)
- But: `requestAnimationFrame` stops entirely in hidden tabs, and other timers degrade to ≥1 s granularity even with WebRTC. **A hidden host still degrades the session** — game loop must not be rAF-only on the host device; netcode tick needs a timer/Worker driver.
- Budget-based throttling: Firefox ±(−150 ms/+50 ms) window budgets, Chrome similar in seconds; budget regenerates 10 ms/s. Long-hidden tabs trend toward starvation.

**Page lifecycle (verified):**

- Chrome can **freeze** hidden tabs (freezable tasks suspended — timers, fetch callbacks) and **discard** them (no events fire at all; only `document.wasDiscarded` on reload). Chrome's own docs recommend closing WebRTC connections on `freeze`. On Android this happens aggressively under memory pressure.
  - Source: https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- `visibilitychange` → `hidden` is the **last reliable signal** before freeze/discard on mobile; `unload`/`beforeunload` are unreliable on mobile. Host device switching apps or locking the screen is therefore the single biggest stability threat to a host-authoritative session.
- Mitigations to carry into the spec: Screen Wake Lock API on the host, "keep this tab focused" UX affordance, persist session state on `visibilitychange`, pause-and-resync on `resume` (guests hold last state + host resends snapshot).

**Fullscreen API (verified, caniuse `fullscreen`, fetched 2026-08-30):**

- Chrome for Android: supported ✅. Firefox Android ✅. Samsung Internet ✅ (10.1+).
- Safari on iOS: **partial** (12–26.6) — element-level fullscreen is effectively unavailable/limited on iPhone; iPadOS behaves differently. Do not make fullscreen a required part of remote play UX on iOS. (iOS is not a stated target — PC/Mac/Android are — but flag it.)
- Desktop Chrome/Edge/Firefox/Safari 16.4+: full support ✅.

**Screen orientation lock (verified):**

- `screen.orientation.lock()` works on Android Chrome (in fullscreen), per MDN "Managing screen orientation" (2025-12): lock accepts `landscape`/`portrait`/etc., returns a promise, must generally be combined with fullscreen on Android.
- **iOS Safari: not supported** — orientation must be handled via responsive layout + `orientation` media query instead.
  - Sources: https://developer.mozilla.org/en-US/docs/Web/API/CSS_Object_Model/Managing_screen_orientation , https://developer.mozilla.org/en-US/docs/Web/API/Screen_Orientation_API (Baseline "widely available", March 2023)
- Spec implication: landscape play field + touch paddle control → lock landscape on Android when entering fullscreen; degrade gracefully to CSS-orientation-aware layout when lock fails.

---

## Recipe: free infra for 4-player remote play

1. **STUN (always, no signup):**
   - `stun:stun.l.google.com:19302` (primary)
   - `stun:openrelay.metered.ca:80` (secondary)
2. **TURN fallback (free signup, no credit card): Open Relay Project** (`openrelay.metered.ca`, ports 80/443, UDP/TCP/TLS). Fetch ephemeral ICE credentials via their REST endpoint at session start. Configure all four transport variants (80 UDP, 80 TCP, 443 TCP/TLS) for firewall coverage. Re-verify actual free-quota (20 GB vs 500 MB conflict) at signup time; if the effective quota is ~500 MB, TURN usage must be treated as scarce (see risks) or a second free account stacked.
3. **Topology: host-authoritative star.** Host device (any player, incl. a split-screen host with 2 local players) holds the authoritative game state, runs the tick (20–60 Hz) on a timer/Worker-driven loop (NOT rAF-alone), opens one `RTCPeerConnection` + DataChannel per guest device (max 3 remote peers). Guests send input events up; host sends state snapshots down. Guests never connect to each other. ICE lets each pair independently choose direct (STUN) or relay (TURN).
4. **Signalling for the room-code lobby:** WebRTC has none built in (webrtc.org). Free options: (a) Metered Realtime Messaging free tier (100 connections, 100k msgs/mo — but vendor-coupled), or (b) copy-paste/QR SDP exchange (zero infra, worse UX), or (c) a free-tier WebSocket room service — decision belongs to the Session & lobby flow ticket, not this one. The recipe is signalling-agnostic.
5. **Mobile session hardening (spec requirements):** wake lock + fullscreen + orientation-lock attempt on Android on game start; persist on `visibilitychange`; resync on `resume`; never depend on rAF for the host tick.

Everything above is $0, no paid services, no server-side persistence — consistent with the map's "free infrastructure only" constraint.

## Risk list

1. **Open Relay quota ambiguity (HIGH).** Metered's Open Relay page claims 20 GB/mo free TURN; Metered's own pricing page lists the free TURN plan at 500 MB/mo. Numbers fetched 2026-08-30; these change. Fully-relayed worst case burns ~300–350 MB/h. Mitigation: verify at signup; monitor; prefer STUN-only paths (ICE does this automatically); consider stacking a second provider (Xirsys dev tier) if quota is tight.
2. **Exposed TURN credential API key (HIGH, architectural).** The Open Relay REST key is designed for server-side use; a static free-hosted site must embed it client-side, letting anyone extract it and burn the monthly quota. Mitigations: ephemeral credentials (short TTL), key rotation, domain-restricted keys if offered — must be resolved in the Netcode/Hosting tickets.
3. **Single small-vendor dependency (MEDIUM).** Open Relay is one company's community freebie — no SLA on the free tier, could change limits or disappear (as Cloudflare's did: TURN-only-via-SFU). Google STUN has the same no-SLA character. Mitigation: multiple ICE servers listed; failure of TURN degrades to "STUN-only connections work, rest get error message."
4. **Host backgrounding (MEDIUM-HIGH, biggest UX risk).** Host switches app / locks phone → tab hidden → rAF stops, timers coarsen to ≥1 s, and Chrome may freeze the tab outright under memory pressure → whole session stalls for all 4 players. No host migration possible without a server (out of scope by map). Mitigations: wake lock, visible "do not leave" affordance on host, pause-and-resync protocol, guests detect silent host and show recovery UI.
5. **Connection success without TURN is probabilistic (MEDIUM).** Expect the large majority of home-NAT pairs to connect with STUN alone; symmetric/CGNAT (notably cellular data on Android) and corporate firewalls need TURN. Commonly cited ~80–90% STUN-success figure is industry folklore, not primary-source verified. Per-session risk compounds across 3 host↔guest pairs. Mitigation: TURN always configured as ICE fallback so failure is invisible to players when quota allows.
6. **iOS Safari gaps (LOW — not a stated target).** No orientation lock; element fullscreen partial. If iOS players appear, layout must be orientation-agnostic.
7. **TURN relay doubles as a trust/threat surface (INFO).** Relay sees only transport (DTLS-encrypted) — cannot read/tamper game data. Relevant input for the later "Remote competitive fairness" ticket.

## Unverified / follow-ups

- Exact Open Relay effective quota at signup (conflicting docs — needs a live account check).
- Metered Realtime Messaging free tier reliability for the lobby (candidate for the Session & lobby ticket).
- caniuse stats are global aggregates; Android WebView (if players open links in apps) tracked separately — assume Chrome-equivalent.
