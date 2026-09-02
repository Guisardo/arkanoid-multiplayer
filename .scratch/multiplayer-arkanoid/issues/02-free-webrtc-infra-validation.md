# Research: free WebRTC infra validation

Type: research
Status: resolved

## Question

Can 4-player browser multiplayer run on free infrastructure only, and what exactly is the recipe?

Establish facts: free STUN servers (Google, etc.); free TURN options (Open Relay Project, Cloudflare, metered.ca free tier, others) with their limits and reliability; WebRTC DataChannel support on Android Chrome and desktop Chrome/Firefox/Safari; feasibility of a host-authoritative topology (host holds game state, 3 peer DataChannels, ~20-60 updates/sec) over home NATs; expected connection-success rate without paid TURN; browser quirks that bite mobile play (fullscreen, orientation, background-tab throttling).

Deliver: a validated free-infra recipe (which STUN/TURN, which topology) plus a risk list. This gates Netcode sync architecture and informs Session & lobby flow design.

## Answer

Yes — 4-player remote play runs on free infra only. Recipe: Google STUN (`stun.l.google.com:19302`) + Open Relay STUN as secondary; Open Relay Project (metered.ca) free TURN as ICE fallback (ports 80/443, UDP/TCP/TLS, free signup, no credit card); host-authoritative star topology — host device holds game state, one RTCPeerConnection + DataChannel per guest (max 3), 20–60 Hz state snapshots ≈ 45 KB/s aggregate, trivially inside any limit. Cloudflare Calls TURN is NOT free standalone ($0.05/GB unless paired with their SFU); Twilio/Xirsys excluded (paid/trial-shaped). DataChannel supported on all target browsers (caniuse 96.39%).

Top risks: (1) Open Relay free quota conflict — their Open Relay page says 20 GB/mo, their pricing page says 500 MB/mo; fully-relayed worst case burns ~300 MB/h — verify at signup. (2) TURN credential REST API key must be embedded client-side on a static host → quota-abuse exposure; needs ephemeral creds + rotation. (3) Host device backgrounding: hidden tab → rAF stops, timers coarsen, Chrome can freeze/discard the tab under memory pressure → whole session stalls; WebRTC-in-use exempts intensive throttling but not freeze. Mitigate with wake lock, timer/Worker-driven host tick, pause-and-resync. Expect large majority of home-NAT pairs to connect via STUN alone; symmetric NAT/cellular/corporate firewalls need TURN (the common ~80–90% STUN-success figure is folklore, no primary source).

Full findings: [research/02-free-webrtc-infra-validation.md](../research/02-free-webrtc-infra-validation.md)
