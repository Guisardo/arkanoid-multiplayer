// Landing + lobby screens (ticket 43, spec §8): landing with three
// entries (Solo / Versus bots / Multiplayer), room-code create (code
// large + QR share) and join (5 auto-advancing boxes, ?code= prefill),
// local-player add, host config panel + guest read-only panel, ready
// checks + all-ready gate, mode picker greying, kick, countdown.
// DOM pattern follows settingsScreen; tap targets >=48 px.
import { t, type Locale, type StringKey } from "ui/strings";
import {
  createLobbyState,
  reduceLobby,
  modeErrorFor,
  DESKTOP_DEVICE,
  MOBILE_DEVICE,
  NAME_MAX_CHARS,
  type LobbyDevice,
  type LobbyError,
  type LobbyMode,
  type LobbyState,
} from "app/lobbyState";
import { ROOM_CODE_REGEX } from "signaling/code";

// ---- QR (client-side, zero network) ----

/** Minimal surface of the qrcode-generator lib (no bundled types). */
interface QrGenerator {
  addData(data: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}
type QrFactory = (typeNumber: number, errorCorrectionLevel: string) => QrGenerator;

/** QR payload for a room: https://<host>/?code=XXXXX (spec §8). */
export function qrPayloadFor(code: string, host: string): string {
  return `https://${host}/?code=${code}`;
}

/** Render a QR matrix for the payload; null when the lib is unavailable. */
export function qrMatrix(payload: string): boolean[][] | null {
  const mod = (globalThis as Record<string, unknown>).qrcode;
  if (typeof mod !== "function") return null;
  try {
    const qr = (mod as QrFactory)(0, "M");
    qr.addData(payload);
    qr.make();
    const n = qr.getModuleCount();
    const out: boolean[][] = [];
    for (let y = 0; y < n; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < n; x++) row.push(qr.isDark(y, x));
      out.push(row);
    }
    return out;
  } catch {
    return null;
  }
}

/** Read ?code= from a URL; null when absent/invalid. */
export function codeFromUrl(url: string): string | null {
  const m = /[?&]code=([A-Za-z0-9]{5})/.exec(url);
  const code = m?.[1];
  if (code === undefined || !ROOM_CODE_REGEX.test(code)) return null;
  return code;
}

/** Random 5-char room code from the lookalike-free charset. */
export function generateRoomCode(rng: () => number = Math.random): string {
  const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) {
    const ch = CHARS[Math.floor(rng() * CHARS.length)];
    out += ch ?? "";
  }
  return out;
}

// ---- Landing ----

export type LandingChoice = "solo" | "versusBots" | "multiplayer";

export interface LandingScreenOptions {
  host: HTMLElement;
  locale: Locale;
  /** Prefilled join code from ?code= (QR link) — jumps straight to join. */
  prefillCode?: string | null;
  onChoice: (choice: LandingChoice, joinCode?: string) => void;
}

const STYLE_ID = "arkanoid-landing-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    ".ld-root{position:fixed;inset:0;background:#0a0a14;display:flex;align-items:center;" +
    "justify-content:center;z-index:1000;}" +
    ".ld-panel{display:flex;flex-direction:column;gap:12px;min-width:320px;font-family:monospace;}" +
    ".ld-title{color:#eee;font-size:24px;font-weight:bold;text-align:center;margin:0 0 8px;}" +
    ".ld-btn{padding:12px 16px;font-family:monospace;min-height:48px;min-width:48px;" +
    "touch-action:manipulation;cursor:pointer;background:#181828;color:#eee;border:2px solid #444;}" +
    ".ld-input{padding:12px;font-family:monospace;min-height:48px;background:#181828;color:#eee;" +
    "border:2px solid #444;text-transform:uppercase;letter-spacing:8px;text-align:center;width:12ch;}" +
    ".ld-code{color:#fd4;font-size:40px;font-weight:bold;text-align:center;letter-spacing:12px;}" +
    ".ld-hint{color:#999;font-size:12px;text-align:center;}";
  document.head.appendChild(style);
}

export class LandingScreen {
  readonly root: HTMLDivElement;

  constructor(opts: LandingScreenOptions) {
    ensureStyles();
    this.root = document.createElement("div");
    this.root.className = "ld-root";
    const panel = document.createElement("div");
    panel.className = "ld-panel";

    const title = document.createElement("h1");
    title.className = "ld-title";
    title.textContent = t(opts.locale, "app.title");
    panel.appendChild(title);

    const solo = menuBtn(opts.locale, "menu.solo");
    solo.addEventListener("click", () => { opts.onChoice("solo"); });
    const bots = menuBtn(opts.locale, "menu.versusBots");
    bots.addEventListener("click", () => { opts.onChoice("versusBots"); });
    const mp = menuBtn(opts.locale, "menu.multiplayer");
    mp.addEventListener("click", () => { opts.onChoice("multiplayer"); });
    panel.append(solo, bots, mp);

    this.root.appendChild(panel);
    opts.host.appendChild(this.root);

    // QR prefill (?code=) jumps straight into join.
    if (opts.prefillCode !== null && opts.prefillCode !== undefined) {
      mp.click();
    }
  }

  close(): void {
    this.root.remove();
  }
}

function menuBtn(locale: Locale, key: StringKey): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "ld-btn";
  btn.textContent = t(locale, key);
  return btn;
}

// ---- Room code entry (create shows code large + QR; join = 5 boxes) ----

export interface RoomCodeScreenOptions {
  host: HTMLElement;
  locale: Locale;
  mode: "create" | "join";
  /** Create: the generated code. Join: prefill from ?code=. */
  code?: string;
  /** For the QR payload. */
  pageHost: string;
  onCreate: (code: string) => void;
  onJoin: (code: string) => void;
  onBack: () => void;
}

export class RoomCodeScreen {
  readonly root: HTMLDivElement;
  private readonly boxes: HTMLInputElement[] = [];
  private readonly opts: RoomCodeScreenOptions;

  constructor(opts: RoomCodeScreenOptions) {
    ensureStyles();
    this.opts = opts;
    this.root = document.createElement("div");
    this.root.className = "ld-root";
    const panel = document.createElement("div");
    panel.className = "ld-panel";

    if (opts.mode === "create") {
      const code = opts.code ?? generateRoomCode();
      const codeEl = document.createElement("div");
      codeEl.className = "ld-code";
      codeEl.textContent = code;
      panel.appendChild(codeEl);

      // QR share: https://<host>/?code=XXXXX, client-side.
      const matrix = qrMatrix(qrPayloadFor(code, opts.pageHost));
      if (matrix !== null) {
        const size = 8;
        const canvas = document.createElement("canvas");
        canvas.width = matrix.length * size;
        canvas.height = matrix.length * size;
        const ctx = canvas.getContext("2d");
        if (ctx !== null) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#000000";
          for (let y = 0; y < matrix.length; y++) {
            const row = matrix[y];
            if (!row) continue;
            for (let x = 0; x < row.length; x++) {
              if (row[x] === true) ctx.fillRect(x * size, y * size, size, size);
            }
          }
          canvas.style.alignSelf = "center";
          panel.appendChild(canvas);
        }
      }

      const cont = menuBtn(opts.locale, "lobby.continue");
      cont.addEventListener("click", () => { opts.onCreate(code); });
      const back = menuBtn(opts.locale, "menu.back");
      back.addEventListener("click", () => { opts.onBack(); });
      panel.append(cont, back);
    } else {
      const hint = document.createElement("div");
      hint.className = "ld-hint";
      hint.textContent = t(opts.locale, "lobby.enterCode");
      panel.appendChild(hint);

      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.justifyContent = "center";
      for (let i = 0; i < 5; i++) {
        const box = document.createElement("input");
        box.className = "ld-input";
        box.maxLength = 1;
        box.autocomplete = "off";
        box.addEventListener("input", () => {
          box.value = box.value.toUpperCase();
          if (box.value !== "" && i < 4) this.boxes[i + 1]?.focus();
        });
        box.addEventListener("keydown", (e) => {
          if (e.key === "Backspace" && box.value === "" && i > 0) {
            this.boxes[i - 1]?.focus();
          }
        });
        row.appendChild(box);
        this.boxes.push(box);
      }
      panel.appendChild(row);

      const join = menuBtn(opts.locale, "lobby.join");
      join.addEventListener("click", () => {
        const code = this.boxes.map((b) => b.value).join("");
        if (ROOM_CODE_REGEX.test(code)) opts.onJoin(code);
      });
      const back = menuBtn(opts.locale, "menu.back");
      back.addEventListener("click", () => { opts.onBack(); });
      panel.append(join, back);

      // Prefill (?code=) fills the boxes.
      if (opts.code !== undefined && ROOM_CODE_REGEX.test(opts.code)) {
        const code = opts.code;
        for (let i = 0; i < 5; i++) {
          const box = this.boxes[i];
          if (box !== undefined) box.value = code[i] ?? "";
        }
      }
    }

    this.root.appendChild(panel);
    opts.host.appendChild(this.root);
  }

  close(): void {
    this.root.remove();
  }
}

// ---- Lobby ----

export interface LobbyScreenOptions {
  host: HTMLElement;
  locale: Locale;
  device?: LobbyDevice;
  /** State changes feed this screen (host or guest view). */
  onEvent: (event: Parameters<typeof reduceLobby>[1]) => void;
  /** Host start pressed with a valid, all-ready state. */
  onStart: () => void;
  onQuit: () => void;
}

export class LobbyScreen {
  readonly root: HTMLDivElement;
  private state: LobbyState;
  private readonly opts: LobbyScreenOptions;
  private readonly device: LobbyDevice;
  private readonly playersEl: HTMLElement;
  private readonly configEl: HTMLElement;
  private readonly statusEl: HTMLElement;

  constructor(opts: LobbyScreenOptions) {
    ensureStyles();
    this.opts = opts;
    this.device = opts.device ?? DESKTOP_DEVICE;
    this.state = createLobbyState(true);

    this.root = document.createElement("div");
    this.root.className = "ld-root";
    const panel = document.createElement("div");
    panel.className = "ld-panel";
    panel.style.minWidth = "420px";

    const title = document.createElement("h2");
    title.className = "ld-title";
    title.textContent = t(opts.locale, "lobby.title");
    panel.appendChild(title);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "ld-hint";
    panel.appendChild(this.statusEl);

    this.playersEl = document.createElement("div");
    this.playersEl.style.display = "flex";
    this.playersEl.style.flexDirection = "column";
    this.playersEl.style.gap = "6px";
    panel.appendChild(this.playersEl);

    const addLocal = menuBtn(opts.locale, "lobby.addLocalPlayer");
    addLocal.addEventListener("click", () => {
      this.dispatch({ type: "addLocalPlayer" });
    });
    panel.appendChild(addLocal);

    this.configEl = document.createElement("div");
    this.configEl.style.display = "flex";
    this.configEl.style.flexDirection = "column";
    this.configEl.style.gap = "6px";
    panel.appendChild(this.configEl);

    const start = menuBtn(opts.locale, "lobby.start");
    start.addEventListener("click", () => {
      this.opts.onStart();
    });
    const quit = menuBtn(opts.locale, "menu.quit");
    quit.addEventListener("click", () => {
      this.opts.onQuit();
    });
    panel.append(start, quit);

    this.root.appendChild(panel);
    opts.host.appendChild(this.root);
    this.render();
  }

  /** Feed a new state (from the reducer, local or remote-driven). */
  sync(state: LobbyState): void {
    this.state = state;
    this.render();
  }

  private dispatch(event: Parameters<typeof reduceLobby>[1]): void {
    const r = reduceLobby(this.state, event, this.device);
    this.state = r.state;
    this.render();
    this.opts.onEvent(event);
  }

  private render(): void {
    const s = this.state;
    const locale = this.opts.locale;

    // Status: room code / phase / countdown.
    if (s.phase === "countdown") {
      this.statusEl.textContent = String(s.countdownRemaining);
    } else if (s.code !== null) {
      this.statusEl.textContent = s.code;
    } else {
      this.statusEl.textContent = "";
    }

    // Players: name, ready check, kick (host-only on remotes).
    this.playersEl.replaceChildren();
    for (const p of s.players) {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";
      const name = document.createElement("span");
      name.textContent = p.name;
      name.style.color = "#eee";
      const ready = document.createElement("button");
      ready.className = "ld-btn";
      ready.style.minHeight = "48px";
      ready.style.minWidth = "72px";
      ready.textContent = p.ready ? t(locale, "lobby.ready") : t(locale, "lobby.notReady");
      ready.addEventListener("click", () => {
        this.dispatch({ type: "setReady", playerId: p.id, ready: !p.ready });
      });
      row.append(name, ready);
      if (s.isHost && p.kind === "remote") {
        const kick = menuBtn(locale, "lobby.kick");
        kick.style.minHeight = "48px";
        kick.addEventListener("click", () => {
          this.dispatch({ type: "removePlayer", playerId: p.id });
        });
        row.appendChild(kick);
      }
      this.playersEl.appendChild(row);
    }

    // Config: host edits, guests read-only.
    this.configEl.replaceChildren();
    const label = document.createElement("div");
    label.className = "ld-hint";
    label.textContent = t(locale, s.isHost ? "lobby.config" : "lobby.configReadOnly");
    this.configEl.appendChild(label);

    const modeRow = document.createElement("div");
    modeRow.style.display = "flex";
    modeRow.style.flexWrap = "wrap";
    modeRow.style.gap = "8px";
    const modes: LobbyMode[] = ["race", "attack", "duel", "sharedField", "parallelAssist"];
    for (const m of modes) {
      const btn = document.createElement("button");
      btn.className = "ld-btn";
      btn.textContent = t(locale, modeKey(m));
      const err = modeErrorFor(m, s.players.length);
      // Disabled when invalid for the player count OR guest (read-only panel).
      btn.disabled = err !== null || !s.isHost;
      btn.title = err !== null ? t(locale, errorKey(err)) : "";
      btn.classList.toggle("selected", s.config.mode === m);
      if (s.isHost) {
        btn.addEventListener("click", () => {
          this.dispatch({ type: "setConfig", config: { mode: m } });
        });
      }
      modeRow.appendChild(btn);
    }
    this.configEl.appendChild(modeRow);
  }

  close(): void {
    this.root.remove();
  }
}

function modeKey(m: LobbyMode): StringKey {
  switch (m) {
    case "race":
      return "menu.race";
    case "attack":
      return "menu.attack";
    case "duel":
      return "menu.duel";
    case "sharedField":
      return "menu.sharedField";
    case "parallelAssist":
      return "menu.parallelAssist";
  }
}

/** Map a lobby error to its display string key (exported for tests + callers). */
export function errorKey(e: LobbyError): StringKey {
  switch (e) {
    case "modeNeedsTwo":
      return "lobby.errNeedsTwo";
    case "duelNeedsExactlyTwo":
      return "lobby.errDuelTwo";
    case "notAllReady":
      return "lobby.errNotAllReady";
    case "notHost":
      return "lobby.errNotHost";
    case "sessionFull":
      return "lobby.errSessionFull";
    case "deviceFull":
      return "lobby.errDeviceFull";
    case "noLateJoin":
      return "lobby.errNoLateJoin";
    case "invalidCode":
      return "lobby.errInvalidCode";
    case "playerNotFound":
      return "lobby.errPlayerNotFound";
  }
}

export { NAME_MAX_CHARS, MOBILE_DEVICE };
