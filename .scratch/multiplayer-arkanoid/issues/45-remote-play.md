# 45 — Remote play

**What to build:** Real remote multiplayer over WebRTC using the net core (27) and signaling (37): host-authoritative input relay + state broadcast. Two channels per guest: game (unreliable, unordered — input frames ↑ at 60 Hz, snapshots ↓ at 30 Hz; 60 Hz snapshots for Duel) + control (reliable, ordered — lobby, version handshake). Guests send 60 Hz Input frames with ~10-tick redundancy; host simulates fixed 60 Hz, dedupes by (player, tick), clamps axes to [-1..1], ignores unknown action types, caps input-frame rate. Host broadcasts full binary Snapshots. Guest interpolation of remote paddles/balls only (buffer latest − ~2.5 intervals, adaptive; never extrapolate the ball); host renders authoritative state. Version handshake: protocol version int in join; mismatch → join refused, "refresh your browser". Malformed binary snapshot or control JSON on the guest = protocol error → clean session-end ("Connection corrupted — session ended"), never a crash. Remote progress strip: top edge, one row per remote player — name + color, score, R12/33, lives (competitive) / downed flag (parallel assist); mobile landscape compresses to name + score; numbers only; remote fields never rendered. Competitive remote input delay D = 3–5 ticks (default 4, lobby-configurable); D = 0 coop remote. Demoable: two devices play a Race remotely.

**Blocked by:** 27 — Net core: snapshot serializer + delay queue; 43 — Lobby + landing + session flow.

**Status:** resolved

- [x] Two devices (or two browser contexts) join via room code and play a full Race remotely
- [x] Game channel unreliable/unordered; control channel reliable/ordered; binary on game, JSON on control
- [x] 60 Hz guest input with redundancy; host dedupe + clamp + rate cap + unknown-action rejection (unit-tested)
- [x] 30 Hz snapshots (60 Hz Duel); guest interpolation buffer adaptive, ball never extrapolated
- [x] Version mismatch → refused join with "refresh your browser"
- [x] Malformed frames → clean protocol-error session end on guest, never a crash (fuzz-tested)
- [x] Remote progress strip correct per mode; remote fields never rendered
- [x] D configurable 3–5 competitive (default 4), 0 coop; uniform delay queue holds for host-local players

## Answer

Implemented on `chunk/remote-play` (worktree arkanoid-wt-45, PR #29).

### Data plane — `src/net/`
- **`inputCodec.ts`** (new): binary input batches — u8 kind/frameCount + per frame {u8 deviceLocal, u32 tick, i8 axisX/Y (1/127 quantization), u8 flags (launch/cycle/fire×4)}; `redundancyWindow` keeps newest 10 frames per send. Decode throws on malformed (truncated/unknown kind/absurd counts) — fuzz-tested with 200 random buffers.
- **`hostGuard.ts`** (new): structural validation (ADR 0003) — axes clamped [-1..1] (NaN→0), dedupe by (player, tick), rate cap 2 frames/player/tick, invalid player/tick dropped, unknown action shapes sanitized to empty. Malformed never crashes the host.
- **`interpolate.ts`** (new): guest snapshot buffer, render at (now − delay); delay adapts (grows on starvation, shrinks to nominal ~2.5 intervals when fed, capped 150 ms); starved = newest holds — **ball never extrapolated**.
- **`control.ts`** (new): typed control-message union (hello/hello-ok/hello-refused/lobby-state/lobby-intent/lobby-start/game-start/game-end/to-lobby/ping/pong/kick/bye) + strict `parseControl` → `protocol` error on any malformed shape; `PROTOCOL_VERSION` rides hello (in `shared/protocol.ts`).

### Game sessions — `src/app/`
- **`hostGame.ts`** (new): all 5 modes via existing sim seams (multiField/attackSession/assistSession/duel/sharedField — same composition as versus bots); uniform delay queue (host-local frames enter same queue, network hop skipped); D=4 competitive / 0 coop (`delayTicksFor`); 30 Hz snapshots, 60 Hz Duel (`snapshotHzFor`); parallel modes send each guest only its own fields (kind-2 multi-snapshot packing) + 5 Hz progress rows (kind-3 wire, `hostProgress.ts`); single-field modes broadcast the field; guest drop → routing removed, match continues; match-end callback feeds standings.
- **`guestGame.ts`** (new): 60 Hz input collect + redundancy send; snapshot unpack (kind 2 multi / kind 3 progress / raw single); interpolation per local field; progress rows (parallel modes from kind-3 wire, single-field derived from snapshot players); **malformed snapshot → protocol-error flag → caller shows "Connection corrupted — session ended", never a crash**.
- **`mpLobby.ts`** (new): host runs authoritative `reduceLobby` + broadcasts full state on change; guests send intents (ready toggles all device players, name/skin first player, addLocalPlayer second = guestIndex+10 slot); hello version mismatch → refused → "refresh your browser"; guest slots = guestIndex+100; countdown → matchStarted notifies guests.
- **`mpFlow.ts`** (new): host/guest orchestration — connect → lobby → 3-2-1 countdown → match (appShell + SplitScreenView for local fields + RemoteStrip for remotes + accumulator loop) → end screen (ticket-50 shapes) → rematch/lobby/quit; disconnection → host-left / connection-corrupted fatal screens.
- **`remoteStrip.ts`** (`render/`, new): DOM strip — name + color dot (ownerColor), score, R{round}/{max}, lives/downed ▼; numbers only; remote fields never rendered.

### Signaling — multi-guest
- **`relayLogic.ts`** + `workers/signaling/src`: per-guest targeted offers (`hostOffers: Map<guestIndex, sdp>`), `joined-ack` delivers the guest its index; RoomDO persists per-guest offers (SQLite `room_offers`), deletes on guest close.
- **`client.ts`**: multi-handler `onMessage` (host room listens for joins while awaiting a specific answer); `joinedAck()`/`offer()` guest awaits.
- **`rtc.ts`**: `openHostRoom` — host signaling WS held all session, one `RTCPeerConnection` + channel pair per guest, targeted offer → answer → channels open → `connectGuest` callback; guest `connectViaSignalingGuest` closes signaling once channels open; copy-paste fallback unchanged.

### App wiring
- **`main.ts`**: landing (Solo / Versus bots / Multiplayer); Multiplayer → RoomCodeScreen (create/join) → host: `openHostRoom` + LobbyScreen wired to `hostLocalEvent`/`hostStartMatch` + guest channel wiring; guest: `connectViaSignalingGuest` + LobbyScreen intents → `guestHello`; `?code=` prefill preserved.
- **`strings.ts`**: 8 new keys ×2 locales (connecting, refresh browser, connection corrupted, host left, remote progress, reconnecting).

### Tests — 68 new, 688/688 green
- `tests/net/`: inputCodec (13, incl. fuzz + quantization), hostGuard (8), interpolate (7), control (12, incl. fuzz)
- `tests/app/`: mpLobby loopback (11 — hello/intents/caps/countdown/refused/dropped), mpLoopback (13 — full data plane with deterministic 5%/30% loss, malformed-drop, packMulti/progress round-trips, Duel 60 Hz, coop D=0)
- `e2e/remote.spec.ts` (new): **two browser contexts connect via real WebRTC copy-paste** — both channels open + binary echo host→guest→host; `playwright.config.ts` disables mDNS hiding so loopback ICE works in CI
- boot/settings/solo e2e updated for the landing gate (Solo click first)
- lint / typecheck / build clean; signaling relay tests updated to targeted-offer semantics
