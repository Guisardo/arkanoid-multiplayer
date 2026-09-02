# Arkanoid Multiplayer

A multiplayer version of the classic brick-breaking game Arkanoid, supporting local split-screen and remote networked play across PC, Mac, and Android web browsers.

## Language

### Core Game

**Arkanoid**:
A paddle-and-ball brick-breaking game in the style of the 1986 Taito arcade classic. The player controls a paddle at the bottom of the play field, bouncing a ball upward to destroy bricks.
_Avoid_: Breakout (different game), brick-breaker (generic)

**Paddle**:
The player-controlled bar that deflects the ball.
_Avoid_: Racket, ship, Vaus (the Arkanoid paddle's canonical name — reserved for lore-accurate clones)

**Brick**:
A destructible block in the play field, destroyed when struck by the ball.
_Avoid_: Block, tile

**Capsule**:
A collectible dropped from destroyed bricks that grants a temporary or permanent effect when caught by the paddle (expand, laser, multiball, extra life, etc.).
_Avoid_: Power-up (superseded — earlier tickets' "power-up" means Capsule), bonus item, drop

**Capsule script**:
The per-level, deterministic sequence of capsules a level drops: which capsules, in what order, each bound to a specific brick-break count. Encoded in level data; no randomness.
_Avoid_: Drop table (implies random rolls), loot table

**Episode**:
A contiguous range of rounds played through as one unit (e.g. rounds 1–33); the unit coop play-throughs and continuous competitive races consume.
_Avoid_: Campaign, world

**Play field**:
The bounded area containing bricks, ball, and paddle for one game instance.
_Avoid_: Level (means a designed arrangement of bricks), screen (means the display)

### Multiplayer

**Split-screen play**:
Multiple players sharing one device, each with their own play field rendered in a divided view.
_Avoid_: Local multiplayer (ambiguous — could mean shared play field), couch co-op (implies coop only)

**Field region**:
The rectangular viewport subdivision allocated to one local player, containing their play field and HUD strip.
_Avoid_: Viewport (means the whole canvas), pane

**HUD strip**:
The status bar rendered above one play field: player name and color, lives, score, round indicator, and — in attack/assist modes — the meter and current target. Shared-field coop renders one strip for the whole field.
_Avoid_: Status bar (vague), info bar

**Remote progress strip**:
The top-edge rows showing each remote player's progress as numbers only (name, score, round, lives or downed flag) — remote play fields are never rendered.
_Avoid_: Spectator bar, mini-view (implies rendered fields)

**Touch overlay**:
The floating on-screen control layer for touch devices: a virtual stick in the bottom-left corner and a context-sensitive button cluster in the bottom-right.
_Avoid_: Virtual controls (vague), on-screen gamepad

**Remote play**:
Players on separate devices connected over a network, each with their own play field.
_Avoid_: Online multiplayer (ambiguous about connection model), netplay

**Competitive mode**:
A mode where players oppose each other; one player's success harms the others' standing.
_Avoid_: Versus mode, PvP (narrower than the mode may be)

**Coop mode**:
A mode where players share a goal and win or lose together.
_Avoid_: Cooperative mode (verbose), co-operative

### Competitive variants

**Race**:
A competitive variant on identical parallel play fields where the first player to clear their field wins.
_Avoid_: Sprint, time attack

**Attack**:
A competitive variant on parallel play fields where players send attacks to opponents, triggered by brick chains, power-up captures, charged manual attacks, or level clears.
_Avoid_: Battle, versus attack

**Duel**:
A two-player competitive variant on a shared play field with direct paddle and ball interference.
_Avoid_: Face-off, 1v1

**Round**:
One level played to a result within a match; the unit of best-of-N match structure.
_Avoid_: Game (ambiguous), turn

**Match**:
A complete competitive session composed of rounds under a chosen structure: best-of-N rounds, continuous episode race, or one-off single level.
_Avoid_: Session (means the lobby connection), series

**Chain**:
A run of consecutive brick breaks without the ball touching the paddle; an attack trigger in Attack.
_Avoid_: Combo, streak

**Attack meter**:
A resource pool filled by brick breaks, spent to fire manually chosen attack types at a chosen target.
_Avoid_: Energy bar, charge gauge

**Brick rain**:
An attack that respawns destroyed bricks in a target's play field, scaled by the triggering chain or meter spend.
_Avoid_: Garbage, penalty bricks

**Ball ownership**:
The attribution of a ball's brick-break points to its last paddle toucher; in the shared-ball model, touch by the opponent steals ownership.
_Avoid_: Ball control, possession

### Coop variants

**Shared field**:
A coop variant where all players' paddles defend one play field from a shared life pool.
_Avoid_: Co-op arena, team field

**Parallel assist**:
A coop variant where each player plays their own play field, sharing score and an assist economy.
_Avoid_: Parallel play, solo assist

**Downed player**:
A parallel-assist player who has lost all lives; their field freezes and they spectate until revived by a life gift.
_Avoid_: Eliminated, dead player

**Assist meter**:
The coop counterpart of the attack meter; filled by the same triggers (chains, power-up captures) and spent on power-up gifts, brick clears, and life gifts to teammates.
_Avoid_: Support bar, help gauge

**Life gift**:
An assist-meter spend that revives a downed player with one life; the life is created by the meter spend, not transferred from another player.
_Avoid_: Revive token, life transfer

**Brick clear**:
An assist-meter spend that removes the lowest N bricks in a teammate's play field.
_Avoid_: Brick removal, cleanup

### Single-player

**Solo**:
Single-player mode: one human playing the classic episode (rounds 1–33) alone on one play field, with no lobby.
_Avoid_: Single-player (ambiguous — also covers versus bots), campaign mode, practice mode

**Versus bots**:
Single-player mode where one human plays any multiplayer variant against bot opponents or with bot teammates (exactly 1 human + N bots), configured on a trimmed lobby screen.
_Avoid_: Vs AI, bot match, practice mode

**Bot**:
An AI-driven player that produces input frames through the same host-local pipeline as a human player; never a network peer.
_Avoid_: AI player, CPU, computer player

**Bot difficulty**:
The session-wide Easy/Normal/Hard parameter set shaping a bot's aim noise, tracking engagement, launch timing, and meter usage.
_Avoid_: Skill level, AI level

**Continue**:
The solo game-over choice to resume the episode from the current round with a fresh set of lives.
_Avoid_: Checkpoint, resume, extra life

### Session

**Lobby**:
The pre-game screen where players gather, configure the match, and start play.
_Avoid_: Waiting room, matchmaking screen

**Room code**:
A short code players enter to join a remote session's lobby.
_Avoid_: Invite code, password

**Host**:
The device that created the room; holds authoritative game state and lobby configuration rights for the session.
_Avoid_: Server (implies dedicated infrastructure), owner

**Guest**:
A device joined to a session via room code; receives authoritative state from the host.
_Avoid_: Client (ambiguous with the browser app itself), peer

**Rejoin window**:
The 90-second period after a guest disconnects during which their slot is held and re-entering the room code restores them to it.
_Avoid_: Grace period, reconnect timeout

**Kick**:
Host-initiated player removal. A lobby kick removes a player before start; a mid-session kick follows removal semantics (competitive = field eliminated as a loss, coop = slot gone, not revivable).
_Avoid_: Ban, vote-kick

**Ready check**:
A per-player lobby confirmation; the host may start only when every player has marked ready.
_Avoid_: Ready up (verb form), lock-in

### Input

**Input frame**:
The per-player, per-sim-tick normalized input sample the simulation consumes: a 2D move axis in `[-1..1]` plus edge events (launch, cycle target, fire action type). Device adapters translate keyboard, mouse, gamepad, and touch into it; the simulation never sees raw devices.
_Avoid_: Input packet (means the network message carrying frames), input event (means the raw device occurrence)

### Netcode

**Snapshot**:
The host's periodic complete-state broadcast: every player's kinematics, the brick grids, scores, meters, effect timers, and recent events, stamped with the host tick it describes.
_Avoid_: State update (vague), delta (explicitly rejected — snapshots are always full), tick packet

**Signaling**:
The SDP/ICE exchange that establishes the host↔guest WebRTC connection, bootstrapped by the room code.
_Avoid_: Handshake (reserved for the join/version handshake), discovery
