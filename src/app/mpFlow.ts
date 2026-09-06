// Multiplayer flow orchestration (ticket 45): wires lobby → game → end
// screens for host and guest devices. Host runs reduceLobby + hostGame
// authoritatively; guests mirror via mpLobby and play through guestGame
// (interpolated view). Rendering reuses SplitScreenView (local fields) +
// RemoteStrip (remote players, numbers only) + EndScreen (ticket 50).
// Transport injects the channel pair — WebRTC in production, loopback or
// copy-paste in tests/e2e.
import type { RtcConnection } from "signaling/rtc";
import {
  createHostLobbySession,
  createGuestLobbySession,
  guestPlayerId,
  type HostLobbySession,
  type GuestLobbySession,
} from "app/mpLobby";
import {
  createHostGameSession,
  delayTicksFor,
  snapshotHzFor,
  type HostGameSession,
  type HostGamePlayer,
} from "app/hostGame";
import { createGuestGameSession, type GuestGameSession, type ProgressRow } from "app/guestGame";
import { createAccumulatorLoop, type AccumulatorLoop } from "app/loop";
import { assignSkinIndices } from "content/skinSync";
import { DEFAULT_THEME_ID } from "content/themes";
import type { LobbyState, LobbyMode } from "app/lobbyState";
import type { Locale } from "ui/strings";
import { t } from "ui/strings";
import type { InputFrame, Snapshot } from "shared/protocol";
import { skinByIndex } from "content/skins";
import { SplitScreenView } from "render/splitScreen";
import { RemoteStrip } from "render/remoteStrip";
import { createAppShell, type AppShell } from "render/appShell";
import { EndScreen, type StandingRow, type CoopOutcome } from "ui/endScreens";

/** Channel pair seam — real WebRTC in production, loopback in tests. */
export interface MpChannels {
  hostToGuest(guestIndex: number, buffer: ArrayBuffer): void;
  guestToHost(buffer: ArrayBuffer): void;
  hostControl(guestIndex: number, json: string): void;
  guestControl(json: string): void;
  onGuestDropped(cb: (guestIndex: number) => void): void;
  onHostGone(cb: () => void): void;
}

export interface MpConnectResult {
  isHost: boolean;
  /** Guest: signaling-assigned index (host: 0). */
  guestIndex: number;
  channels: MpChannels;
}

export interface MpFlowOptions {
  host: HTMLElement;
  locale: Locale;
  connect: () => Promise<MpConnectResult>;
  /** Callbacks the UI (main.ts) hooks for screens + local input wiring. */
  onLobbyState?(state: LobbyState): void;
  onCountdown?(seconds: number): void;
  /**
   * Per-tick local input source (ticket 46): called once per sim tick per
   * local player, in player order. Production wires keyboard/mouse/
   * gamepad/touch adapters here; null = no frame this tick (idle).
   */
  sampleLocal?(player: number, tick: number): InputFrame | null;
}

export type MpPhase = "idle" | "lobby" | "countdown" | "inGame" | "betweenMatches" | "dead";

export class MpFlow {
  private readonly hostEl: HTMLElement;
  private readonly locale: Locale;
  private readonly opts: MpFlowOptions;
  private shell: AppShell | null = null;
  private split: SplitScreenView | null = null;
  private strip: RemoteStrip | null = null;
  private endScreen: EndScreen | null = null;
  private lobby: HostLobbySession | null = null;
  private guestLobby: GuestLobbySession | null = null;
  private game: HostGameSession | null = null;
  private guestGame: GuestGameSession | null = null;
  private channels: MpChannels | null = null;
  private guestIndex = 0;
  private isHost = false;
  private phase: MpPhase = "idle";
  private loop: AccumulatorLoop | null = null;
  private pendingLocal: InputFrame[] = [];
  private lobbyState: LobbyState | null = null;
  private matchPlayers: string[] = [];
  private matchMode: LobbyMode | null = null;
  /** Sim players local to this device (host or guest), set at match start. */
  private matchLocalPlayers: number[] = [];
  private matchTick = 0;

  constructor(opts: MpFlowOptions) {
    this.hostEl = opts.host;
    this.locale = opts.locale;
    this.opts = opts;
  }

  get currentPhase(): MpPhase {
    return this.phase;
  }

  get lobbySnapshot(): LobbyState | null {
    return this.lobbyState;
  }

  /** Boot: connect, handshake, enter the lobby. Resolves when lobby is live. */
  async start(): Promise<void> {
    const result = await this.opts.connect();
    this.isHost = result.isHost;
    this.guestIndex = result.guestIndex;
    this.channels = result.channels;
    this.channels.onGuestDropped((gi) => { this.guestDropped(gi); });
    this.channels.onHostGone(() => { this.hostGone(); });
    this.phase = "lobby";

    if (this.isHost) {
      this.lobby = createHostLobbySession(
        (gi, msg) => {
          this.channels?.hostControl(gi, JSON.stringify(msg));
        },
        {
          // Any host-side state change (guest intents included) updates the
          // flow's mirror — the lobby screen and tests read from here.
          onStateChanged: (s) => {
            this.lobbyState = s;
            this.opts.onLobbyState?.(s);
          },
          onCountdownComplete: (s) => {
            this.lobbyState = s;
          },
        },
      );
      this.lobbyState = this.lobby.state();
    } else {
      this.guestLobby = createGuestLobbySession(
        (msg) => this.channels?.guestControl(JSON.stringify(msg)),
        1,
        {
          onState: (s) => {
            this.lobbyState = s;
            this.opts.onLobbyState?.(s);
          },
          onCountdown: (s) => {
            this.phase = "countdown";
            this.opts.onCountdown?.(s);
          },
          onRefused: (reason) => {
            this.fatal(
              reason === "version"
                ? t(this.locale, "mp.refreshBrowser")
                : t(this.locale, "lobby.errSessionFull"),
            );
          },
        },
      );
    }
  }

  // ---- Wire feed (transport calls these) ----

  controlFromWire(guestIndex: number, json: string): void {
    if (this.isHost) {
      this.lobby?.guestMessage(guestIndex, json);
    } else {
      const before = this.guestLobby?.state();
      this.guestLobby?.onHostMessage(json);
      const after = this.guestLobby?.state();
      if (before !== after) this.lobbyState = after ?? null;
      // Game-start arrives as control too: check phase transitions.
      this.maybeGuestGameStart(json);
    }
  }

  binaryFromWire(guestIndex: number, buffer: ArrayBuffer): void {
    if (this.isHost) {
      this.game?.guestBinary(guestIndex, buffer);
    } else {
      this.guestGame?.hostBinary(buffer);
    }
  }

  private maybeGuestGameStart(json: string): void {
    try {
      const parsed = JSON.parse(json) as {
        type?: string;
        localPlayers?: number[];
        players?: { name: string; skinIndex: number }[];
        themeId?: string;
        mode?: LobbyMode;
        snapshotHz?: 30 | 60;
        delayTicks?: number;
      };
      if (parsed.type !== "game-start" || this.isHost) return;
      const mode = parsed.mode ?? "race";
      const localPlayers = parsed.localPlayers ?? [];
      const names = (parsed.players ?? []).map((p) => p.name);
      const skinIndices = (parsed.players ?? []).map((p) => p.skinIndex);
      const allPlayers = names.map((_, i) => i);
      const remotePlayers = allPlayers.filter((p) => !localPlayers.includes(p));
      const delayTicks = typeof parsed.delayTicks === "number" ? parsed.delayTicks : 4;
      this.beginGuestMatch(
        mode,
        localPlayers,
        names,
        skinIndices,
        parsed.themeId ?? DEFAULT_THEME_ID,
        remotePlayers,
        delayTicks,
      );
    } catch {
      // Non-JSON or wrong shape: control parser already handles protocol.
    }
  }

  // ---- Host device API ----

  /** Host local lobby action (UI dispatches through this). */
  hostLocalEvent(event: Parameters<HostLobbySession["localEvent"]>[0]): void {
    this.lobby?.localEvent(event);
    const state = this.lobby?.state();
    if (state !== undefined) this.lobbyState = state;
    if (this.lobbyState !== null) this.opts.onLobbyState?.(this.lobbyState);
  }

  /** Host pressed Start with all ready: begin countdown → match. */
  hostStartMatch(): void {
    if (!this.isHost || this.lobby === null) return;
    const state = this.lobby.state();
    if (state.phase !== "lobby") return;
    this.lobby.startCountdown();
    this.phase = "countdown";
    this.opts.onCountdown?.(3);
    let remaining = 3;
    const timer = globalThis.setInterval(() => {
      remaining--;
      this.lobby?.countdownTick();
      this.opts.onCountdown?.(Math.max(0, remaining));
      if (remaining <= 0) {
        globalThis.clearInterval(timer);
        this.launchMatchAsHost();
      }
    }, 1000);
  }

  private launchMatchAsHost(): void {
    if (this.lobby === null) return;
    const state = this.lobby.state();
    // Deterministic slot order: lobby players sorted by id → sim index.
    const ordered = [...state.players].sort((a, b) => a.id - b.id);
    const skinIndices = assignSkinIndices(ordered.map((p) => p.skinId)).indices;
    const players: HostGamePlayer[] = ordered.map((p, i) => ({
      player: i,
      name: p.name,
      skinIndex: skinIndices[i] ?? 0,
      guestIndex: p.kind === "remote" ? p.id - 100 : -1,
    }));
    const hostLocal = players.filter((p) => p.guestIndex === -1).map((p) => p.player);
    const sendGame = (gi: number, buf: ArrayBuffer): void => {
      this.channels?.hostToGuest(gi, buf);
    };
    this.game = createHostGameSession(
      { mode: state.config.mode, config: state.config, players, hostLocalPlayers: hostLocal },
      sendGame,
      { onMatchEnd: (end) => { this.hostMatchEnd(end); } },
    );
    this.matchPlayers = players.map((p) => p.name);
    this.matchMode = state.config.mode;
    this.matchLocalPlayers = hostLocal;
    this.matchTick = 0;
    this.phase = "inGame";

    // Tell every guest the match started (control channel).
    for (const p of players) {
      if (p.guestIndex < 0) continue;
      this.channels?.hostControl(p.guestIndex, JSON.stringify({
        type: "game-start",
        mode: state.config.mode,
        localPlayers: [p.player],
        players: players.map((x) => ({ name: x.name, skinIndex: x.skinIndex })),
        themeId: state.config.themeId,
        snapshotHz: this.game.snapshotHz,
        delayTicks: this.game.delayTicks,
        config: state.config,
      }));
    }

    const remote = players.filter((p) => p.guestIndex !== -1).map((p) => p.player);
    void createAppShell(this.hostEl, {}).then((shell) => {
      if (this.phase !== "inGame") {
        shell.dispose();
        return;
      }
      this.shell = shell;
      this.mountRender(state.config.mode, hostLocal, remote, state.config.themeId, players.map((p) => p.skinIndex));
      this.startHostLoop();
    });
  }

  private startHostLoop(): void {
    const game = this.game;
    if (game === null) return;
    const loop = createAccumulatorLoop({
      tick: () => {
        this.sampleLocalFrames();
        game.tick(this.pendingLocal.splice(0));
      },
      render: () => {
        const snaps = game.snapshots();
        const local: Snapshot[] = [];
        for (let i = 0; i < snaps.length; i++) {
          if (this.localFieldFilter.includes(i)) {
            const s = snaps[i];
            if (s !== undefined) local.push(s);
          }
        }
        this.split?.sync(local);
      },
    });
    loop.start();
    this.loop = loop;
  }

  private localFieldFilter: number[] = [];

  private mountRender(
    mode: LobbyMode,
    localPlayers: number[],
    remotePlayers: number[],
    themeId: string,
    skinIndices: number[],
  ): void {
    this.teardownRender();
    const app = this.shell?.app;
    if (app === undefined) return;
    this.localFieldFilter = localPlayers;
    const single = mode === "duel" || mode === "sharedField";
    const fields = single ? [localPlayers[0] ?? 0] : localPlayers;
    this.split = new SplitScreenView({
      viewport: { w: app.renderer.width, h: app.renderer.height },
      players: fields,
      locale: this.locale,
      maxRound: 33,
      // Session skin indices → UUIDs for the FieldViews (ticket 44).
      skinIds: fields.map((p) => skinByIndex(skinIndices[p] ?? 0).id),
      themeId: themeId || DEFAULT_THEME_ID,
    });
    if (remotePlayers.length > 0) this.split.container.y = 28;
    app.stage.addChild(this.split.container);
    if (remotePlayers.length > 0 || !this.isHost) {
      this.strip = new RemoteStrip({ host: this.hostEl, locale: this.locale });
    }
  }

  private hostMatchEnd(end: { mode: LobbyMode; snapshots: Snapshot[] }): void {
    this.phase = "betweenMatches";
    this.lobby?.localEvent({ type: "matchEnded" });
    // Standings via ticket-50 shapes; host shows + broadcasts.
    const standings = this.standingsFor(end.mode, end.snapshots);
    const outcome = this.coopOutcomeFor(end.mode, end.snapshots);
    for (const gi of this.lobby?.guests() ?? []) {
      this.channels?.hostControl(gi, JSON.stringify({
        type: "game-end",
        mode: end.mode,
        standings,
        coopOutcome: outcome,
      }));
    }
    this.showEndScreen(end.mode, standings, outcome);
  }

  private standingsFor(mode: LobbyMode, snapshots: readonly Snapshot[]): StandingRow[] {
    // Minimal shape: rank by score from the final snapshots.
    const players = snapshots[0]?.players ?? [];
    const rows: StandingRow[] = players
      .map((p) => ({ player: p.player, name: p.name, score: p.score, metric: p.score, rank: 0 }))
      .sort((a, b) => b.metric - a.metric)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    return rows;
  }

  private coopOutcomeFor(mode: LobbyMode, snapshots: readonly Snapshot[]): CoopOutcome | null {
    if (mode !== "sharedField" && mode !== "parallelAssist") return null;
    const snap = snapshots[0];
    if (snap === undefined) return null;
    const cleared = snap.phase === "roundClear" && snap.round >= 33;
    return {
      cleared,
      teamScore: snapshots.reduce((n, s) => n + (s.players[0]?.score ?? 0), 0),
      roundReached: snap.round,
      maxRound: 33,
      perPlayer: snap.players.map((p) => ({
        player: p.player,
        name: p.name,
        bricks: 0,
        capsules: 0,
      })),
    };
  }

  private showEndScreen(mode: LobbyMode, standings: StandingRow[] | null, outcome: CoopOutcome | null): void {
    this.teardownGameLoops();
    const competitive = mode === "race" || mode === "attack" || mode === "duel";
    this.endScreen = new EndScreen({
      host: this.hostEl,
      locale: this.locale,
      data: competitive
        ? { kind: "competitive", mode: mode === "duel" ? "duel" : mode === "attack" ? "attack" : "race", standings: standings ?? [] }
        : { kind: "coop", outcome: outcome ?? { cleared: false, teamScore: 0, roundReached: 0, maxRound: 33, perPlayer: [] } },
      onChoice: (choice) => { this.endChoice(choice); },
    });
  }

  private endChoice(choice: "rematch" | "lobby" | "quit" | "continue" | "restart"): void {
    this.endScreen?.root.remove();
    this.endScreen = null;
    this.teardownRender();
    if (choice === "quit") {
      this.channels?.guestControl(JSON.stringify({ type: "bye" }));
      this.dispose();
      globalThis.location.reload();
      return;
    }
    // Rematch/lobby: back to lobby phase (between-match joins OK).
    this.phase = "lobby";
    for (const gi of this.lobby?.guests() ?? []) {
      this.channels?.hostControl(gi, JSON.stringify({ type: "to-lobby" }));
    }
    const state = this.lobby?.state();
    if (state !== undefined) this.opts.onLobbyState?.(state);
  }

  // ---- Guest device API ----

  /** Guest sends hello (name/skin from Settings). */
  guestHello(name: string, skinId: string): void {
    this.guestLobby?.hello(name, skinId);
  }

  /** Guest local intent (ready/name/skin/add local). */
  guestIntent(intent: Parameters<GuestLobbySession["intent"]>[0]): void {
    this.guestLobby?.intent(intent);
  }

  beginGuestMatch(
    mode: LobbyMode,
    localPlayers: number[],
    names: string[],
    skinIndices: number[],
    themeId: string,
    remotePlayers: number[],
    delayTicks = 4,
  ): void {
    this.guestGame = createGuestGameSession(
      {
        snapshotHz: snapshotHzFor(mode),
        localPlayers,
        remotePlayers,
        names,
        // Ticket 46: local-paddle prediction needs the mode's clamp set,
        // the input delay D, and the shared-field slice width.
        mode,
        delayTicks: mode === "sharedField" || mode === "parallelAssist" ? 0 : delayTicks,
        playerCount: names.length,
      },
      (buf) => this.channels?.guestToHost(buf),
      {
        onProgress: (rows) => this.strip?.update(rows),
        onProtocolError: () => { this.fatal(t(this.locale, "mp.connectionCorrupted")); },
      },
    );
    this.matchMode = mode;
    this.matchLocalPlayers = localPlayers;
    this.matchTick = 0;
    this.phase = "inGame";
    void createAppShell(this.hostEl, {}).then((shell) => {
      if (this.phase !== "inGame") {
        shell.dispose();
        return;
      }
      this.shell = shell;
      this.mountRender(mode, localPlayers, remotePlayers, themeId, skinIndices);
      this.startGuestLoop();
    });
  }

  private startGuestLoop(): void {
    const guestGame = this.guestGame;
    if (guestGame === null) return;
    const loop = createAccumulatorLoop({
      tick: () => {
        // Collect this tick's local frames (sample seam + legacy
        // localFrame callers), then send + advance prediction — the
        // predictor sees the frame on the tick it was made.
        this.sampleLocalFrames();
        guestGame.sendTick();
      },
      render: () => {
        const now = performance.now();
        this.split?.sync(guestGame.renderSnapshots(now));
      },
    });
    loop.start();
    this.loop = loop;
  }

  /** Sample local input once per tick for every local player (46). */
  private sampleLocalFrames(): void {
    if (this.opts.sampleLocal === undefined) return;
    for (const player of this.matchLocalPlayers) {
      const frame = this.opts.sampleLocal(player, this.matchTick);
      if (frame === null) continue;
      if (this.isHost) this.pendingLocal.push(frame);
      else this.guestGame?.collect(frame);
    }
    this.matchTick++;
  }

  /** Feed a local player's input frame (host: into pending; guest: collect). */
  localFrame(frame: InputFrame): void {
    if (this.isHost) {
      this.pendingLocal.push(frame);
    } else {
      this.guestGame?.collect(frame);
    }
  }

  /** Game-end control arrived (guest) — show the end screen. */
  guestGameEnd(standings: StandingRow[] | null, outcome: CoopOutcome | null): void {
    this.phase = "betweenMatches";
    const mode = this.matchMode ?? "race";
    const competitive = mode === "race" || mode === "attack" || mode === "duel";
    this.teardownGameLoops();
    this.endScreen = new EndScreen({
      host: this.hostEl,
      locale: this.locale,
      data: competitive
        ? { kind: "competitive", mode: mode === "duel" ? "duel" : mode === "attack" ? "attack" : "race", standings: standings ?? [] }
        : { kind: "coop", outcome: outcome ?? { cleared: false, teamScore: 0, roundReached: 0, maxRound: 33, perPlayer: [] } },
      onChoice: (choice) => {
        // Guests: lobby → wait for host; quit → bye + reload.
        this.endScreen?.root.remove();
        this.endScreen = null;
        this.teardownRender();
        this.phase = "lobby";
        if (choice === "quit") {
          this.channels?.guestControl(JSON.stringify({ type: "bye" }));
          this.dispose();
          globalThis.location.reload();
        }
      },
    });
  }

  // ---- Disconnection paths ----

  /** Transport signals a guest's channels closed (host side). */
  guestChannelClosed(guestIndex: number): void {
    this.guestDropped(guestIndex);
  }

  /** Transport signals the host's room died (host device side). */
  hostGoneFromOutside(): void {
    this.hostGone();
  }

  private guestDropped(guestIndex: number): void {
    if (this.isHost) {
      this.lobby?.guestClosed(guestIndex);
      this.game?.guestDropped(guestIndex);
      const state = this.lobby?.state();
      if (state !== undefined) {
        this.lobbyState = state;
        this.opts.onLobbyState?.(state);
      }
    } else {
      this.hostGone();
    }
  }

  private hostGone(): void {
    this.fatal(t(this.locale, "mp.hostLeft"));
  }

  private fatal(message: string): void {
    if (this.phase === "dead") return;
    this.phase = "dead";
    this.teardownGameLoops();
    this.teardownRender();
    const div = document.createElement("div");
    div.className = "ld-root";
    const panel = document.createElement("div");
    panel.className = "ld-panel";
    const text = document.createElement("h2");
    text.className = "ld-title";
    text.textContent = message;
    const back = document.createElement("button");
    back.className = "ld-btn";
    back.textContent = t(this.locale, "menu.back");
    back.addEventListener("click", () => {
      div.remove();
      globalThis.location.reload();
    });
    panel.append(text, back);
    div.appendChild(panel);
    this.hostEl.appendChild(div);
  }

  // ---- Teardown ----

  private teardownGameLoops(): void {
    this.loop?.stop();
    this.loop = null;
    this.game?.dispose();
    this.game = null;
    this.guestGame?.dispose();
    this.guestGame = null;
  }

  private teardownRender(): void {
    this.split?.container.destroy({ children: true });
    this.split = null;
    this.strip?.close();
    this.strip = null;
    if (this.shell !== null) this.shell.app.stage.removeChildren();
  }

  dispose(): void {
    this.teardownGameLoops();
    this.teardownRender();
    this.endScreen?.root.remove();
    this.endScreen = null;
    this.shell?.dispose();
    this.shell = null;
  }

  /** Test/e2e probes. */
  get isHostSide(): boolean {
    return this.isHost;
  }

  /** Test hook: drive the running loop deterministically (solo pattern). */
  advanceTest(ms: number): void {
    this.loop?.advance(ms);
  }

  localSnapshots(): Snapshot[] {
    if (this.isHost) return this.game?.snapshots() ?? [];
    return this.guestGame?.renderSnapshots(performance.now()) ?? [];
  }

  progressRows(): ProgressRow[] {
    return this.guestGame?.progressRows() ?? [];
  }
}

export { guestPlayerId, delayTicksFor, snapshotHzFor };
export type { RtcConnection };
