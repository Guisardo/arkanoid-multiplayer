// Landing + lobby screens (ticket 43, spec §8): landing with three
// entries (Solo / Versus bots / Multiplayer), the multiplayer choice
// (Create room / Join room, #159), room-code create (code large + QR
// share) and join (5 auto-advancing boxes, ?code= prefill, Scan QR),
// local-player add, host config panel + guest read-only panel, ready
// checks + all-ready gate, mode picker greying, kick, countdown.
// DOM pattern follows settingsScreen; tap targets >=48 px.
import { t, type Locale, type StringKey } from "ui/strings";
import { GamepadMenuNav } from "ui/gamepadNav";
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
import { SKINS } from "content/skins";
import { THEMES } from "content/themes";
import { ROOM_CODE_REGEX } from "signaling/code";
import {
  CameraError,
  codeFromUrl,
  roomCodeFromScan,
  type CameraErrorKind,
  type QrScanner,
} from "ui/qrScan";
import qrcode from "qrcode-generator";

// ---- QR (client-side, zero network) ----

/** Minimal surface of the qrcode-generator lib the screens depend on. */
interface QrGenerator {
  addData(data: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}
type QrFactory = (typeNumber: 0, errorCorrectionLevel: "M") => QrGenerator;

/**
 * QR payload for a room: https://<host><path>?code=XXXXX (spec §8). The path
 * rides along so project-site subpaths (GH Pages /arkanoid-multiplayer/)
 * produce scannable links — host-only payloads 404 there.
 */
export function qrPayloadFor(code: string, host: string, path = "/"): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `https://${host}${cleanPath}?code=${code}`;
}

/**
 * QR modules for the payload; null when it cannot be encoded (e.g. too long).
 * The factory is injectable so tests can substitute a fake generator.
 */
export function qrMatrix(payload: string, factory: QrFactory = qrcode): boolean[][] | null {
  try {
    const qr = factory(0, "M");
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
  } catch (err) {
    console.warn("[lobby] QR encode failed; room code stays text-only", err);
    return null;
  }
}

/** Pixels per QR module on the share canvas. */
const QR_MODULE_PX = 8;

/**
 * Draw the QR for a payload onto a canvas (white quiet background, black
 * modules). Null when the payload cannot be encoded or no 2D context exists.
 */
export function renderQrCanvas(payload: string): HTMLCanvasElement | null {
  const matrix = qrMatrix(payload);
  if (matrix === null) return null;
  const canvas = document.createElement("canvas");
  canvas.width = matrix.length * QR_MODULE_PX;
  canvas.height = matrix.length * QR_MODULE_PX;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  for (let y = 0; y < matrix.length; y++) {
    const row = matrix[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      if (row[x] === true) ctx.fillRect(x * QR_MODULE_PX, y * QR_MODULE_PX, QR_MODULE_PX, QR_MODULE_PX);
    }
  }
  canvas.style.alignSelf = "center";
  return canvas;
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
  /** Settings entry (spec §14: reachable from landing always). */
  onSettings?: () => void;
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
    ".ld-hint{color:#999;font-size:12px;text-align:center;}" +
    ".ld-view{display:flex;flex-direction:column;gap:12px;}" +
    ".ld-error{color:#f77;font-size:14px;text-align:center;}" +
    ".ld-error:empty{display:none;}" +
    ".ld-video{width:min(80vw,360px);aspect-ratio:1;object-fit:cover;background:#000;align-self:center;}";
  document.head.appendChild(style);
}

export class LandingScreen {
  readonly root: HTMLDivElement;
  private readonly nav: GamepadMenuNav;

  constructor(opts: LandingScreenOptions) {
    ensureStyles();
    this.root = document.createElement("div");
    this.root.className = "ld-root";
    // `.ld-root` is a shared look, not a unique identity — MpFlow's reconnect,
    // throttle and fatal overlays reuse it. `data-screen` is what identifies
    // *which* screen is on top, for tests and for anyone debugging the DOM.
    this.root.dataset.screen = "landing";
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
    // ?code= prefill rides the multiplayer choice as joinCode — the QR
    // share link must land on the JOIN screen with the code filled, not
    // on create.
    mp.addEventListener("click", () => {
      opts.onChoice("multiplayer", opts.prefillCode ?? undefined);
    });
    panel.append(solo, bots, mp);

    // Settings (spec §14: reachable from landing always).
    if (opts.onSettings !== undefined) {
      const settingsBtn = menuBtn(opts.locale, "menu.settings");
      settingsBtn.addEventListener("click", () => { opts.onSettings?.(); });
      panel.appendChild(settingsBtn);
    }

    this.root.appendChild(panel);
    opts.host.appendChild(this.root);
    this.nav = new GamepadMenuNav({ root: this.root });
    this.nav.start();

    // QR prefill (?code=) jumps straight into join. Deferred to a
    // microtask: the caller's `const landing = new LandingScreen(...)`
    // must finish first — the onChoice handler closes this screen, and a
    // synchronous click would hit the uninitialized binding (TDZ).
    if (opts.prefillCode !== null && opts.prefillCode !== undefined) {
      void Promise.resolve().then(() => { mp.click(); });
    }
  }

  close(): void {
    this.nav.stop();
    this.root.remove();
  }
}

// ---- Multiplayer choice (#159): create a room or join one ----

export type MultiplayerChoice = "create" | "join";

export interface MultiplayerChoiceScreenOptions {
  host: HTMLElement;
  locale: Locale;
  onChoice: (choice: MultiplayerChoice) => void;
  onBack: () => void;
}

export class MultiplayerChoiceScreen {
  readonly root: HTMLDivElement;
  private readonly nav: GamepadMenuNav;

  constructor(opts: MultiplayerChoiceScreenOptions) {
    ensureStyles();
    this.root = document.createElement("div");
    this.root.className = "ld-root";
    this.root.dataset.screen = "mpchoice";
    const panel = document.createElement("div");
    panel.className = "ld-panel";

    const title = document.createElement("h2");
    title.className = "ld-title";
    title.textContent = t(opts.locale, "menu.multiplayer");
    panel.appendChild(title);

    const create = menuBtn(opts.locale, "menu.createRoom");
    create.addEventListener("click", () => { opts.onChoice("create"); });
    const join = menuBtn(opts.locale, "menu.joinRoom");
    join.addEventListener("click", () => { opts.onChoice("join"); });
    const back = menuBtn(opts.locale, "menu.back");
    back.addEventListener("click", () => { opts.onBack(); });
    panel.append(create, join, back);

    this.root.appendChild(panel);
    opts.host.appendChild(this.root);
    this.nav = new GamepadMenuNav({ root: this.root, onCancel: opts.onBack });
    this.nav.start();
  }

  close(): void {
    this.nav.stop();
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
  /** Page path for the QR payload (project-site subpath, default "/"). */
  pagePath?: string;
  onCreate: (code: string) => void;
  onJoin: (code: string) => void;
  onBack: () => void;
  /** Join: camera QR scanning (#159). Without it the join screen is manual-only. */
  qrScan?: QrScanSupport;
}

/** What the join screen needs to offer Scan QR. */
export interface QrScanSupport {
  scanner: QrScanner;
  /** Resolves true when a camera is usable; Scan QR stays hidden otherwise. */
  hasCamera: () => Promise<boolean>;
}

export class RoomCodeScreen {
  readonly root: HTMLDivElement;
  private readonly nav: GamepadMenuNav;
  private readonly boxes: HTMLInputElement[] = [];
  private readonly opts: RoomCodeScreenOptions;
  /** Join mode: manual entry view and camera view (only one shows at a time). */
  private joinView: HTMLElement | null = null;
  private scanView: HTMLElement | null = null;
  /** Join view message line: why the camera could not start. */
  private joinError: HTMLElement | null = null;
  /** Camera view message line: a scanned QR that is not a room. */
  private scanStatus: HTMLElement | null = null;
  private video: HTMLVideoElement | null = null;
  /** True from Scan QR until the camera view is left; the scanner runs meanwhile. */
  private scanning = false;

  constructor(opts: RoomCodeScreenOptions) {
    ensureStyles();
    this.opts = opts;
    this.root = document.createElement("div");
    this.root.className = "ld-root";
    this.root.dataset.screen = "roomcode";
    const panel = document.createElement("div");
    panel.className = "ld-panel";

    if (opts.mode === "create") {
      const code = opts.code ?? generateRoomCode();
      const codeEl = document.createElement("div");
      codeEl.className = "ld-code";
      codeEl.textContent = code;
      panel.appendChild(codeEl);

      // QR share: https://<host><path>?code=XXXXX, client-side.
      const qrCanvas = renderQrCanvas(qrPayloadFor(code, opts.pageHost, opts.pagePath));
      if (qrCanvas !== null) panel.appendChild(qrCanvas);

      const cont = menuBtn(opts.locale, "lobby.continue");
      cont.addEventListener("click", () => { opts.onCreate(code); });
      const back = menuBtn(opts.locale, "menu.back");
      back.addEventListener("click", () => { opts.onBack(); });
      panel.append(cont, back);
    } else {
      this.buildJoin(panel, opts);
    }

    this.root.appendChild(panel);
    opts.host.appendChild(this.root);
    // B leaves the camera view first, then the screen.
    this.nav = new GamepadMenuNav({ root: this.root, onCancel: () => { this.cancel(); } });
    this.nav.start();
  }

  close(): void {
    this.stopScan();
    this.nav.stop();
    this.root.remove();
  }

  /** Join: manual 5-box entry, plus Scan QR when a scanner and a camera exist. */
  private buildJoin(panel: HTMLElement, opts: RoomCodeScreenOptions): void {
    const joinView = document.createElement("div");
    joinView.className = "ld-view";
    this.joinView = joinView;

    const hint = document.createElement("div");
    hint.className = "ld-hint";
    hint.textContent = t(opts.locale, "lobby.enterCode");
    joinView.appendChild(hint);

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.justifyContent = "center";
    for (let i = 0; i < 5; i++) {
      const box = document.createElement("input");
      box.className = "ld-input";
      // One glyph per box: the shared 12ch width pushes five boxes off a phone.
      box.style.width = "2ch";
      box.style.letterSpacing = "0";
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
    joinView.appendChild(row);

    const joinError = document.createElement("div");
    joinError.className = "ld-error";
    joinError.setAttribute("role", "alert");
    this.joinError = joinError;
    joinView.appendChild(joinError);

    const join = menuBtn(opts.locale, "lobby.join");
    join.addEventListener("click", () => {
      const code = this.boxes.map((b) => b.value).join("");
      if (ROOM_CODE_REGEX.test(code)) opts.onJoin(code);
    });
    joinView.appendChild(join);

    if (opts.qrScan !== undefined) {
      const scan = menuBtn(opts.locale, "lobby.scanQr");
      // Hidden until the camera probe answers: a button that can only fail is
      // worse than none.
      setShown(scan, false);
      scan.addEventListener("click", () => { this.startScan(); });
      joinView.appendChild(scan);
      opts.qrScan.hasCamera().then(
        (hasCamera) => { setShown(scan, hasCamera); },
        (err: unknown) => {
          console.error("[lobby] RoomCodeScreen: camera detection failed; Scan QR stays hidden", err);
        },
      );
      panel.appendChild(this.buildScanView(opts));
    }

    const back = menuBtn(opts.locale, "menu.back");
    back.addEventListener("click", () => { opts.onBack(); });
    joinView.appendChild(back);
    panel.insertBefore(joinView, panel.firstChild);

    // Prefill (?code=) fills the boxes.
    if (opts.code !== undefined && ROOM_CODE_REGEX.test(opts.code)) this.fillBoxes(opts.code);
  }

  /** Camera view: live video, scan feedback, Back to the code boxes. Starts hidden. */
  private buildScanView(opts: RoomCodeScreenOptions): HTMLElement {
    const scanView = document.createElement("div");
    scanView.className = "ld-view";
    setShown(scanView, false);
    this.scanView = scanView;

    const video = document.createElement("video");
    video.className = "ld-video";
    // iOS only plays inline, muted video without a user-gesture-bound play().
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    this.video = video;

    const status = document.createElement("div");
    status.className = "ld-error";
    status.setAttribute("role", "alert");
    this.scanStatus = status;

    const back = menuBtn(opts.locale, "menu.back");
    back.addEventListener("click", () => { this.leaveScan(); });
    scanView.append(video, status, back);
    return scanView;
  }

  private fillBoxes(code: string): void {
    for (let i = 0; i < 5; i++) {
      const box = this.boxes[i];
      if (box !== undefined) box.value = code[i] ?? "";
    }
  }

  /** Back / gamepad B: out of the camera view when scanning, else out of the screen. */
  private cancel(): void {
    if (this.scanning) this.leaveScan();
    else this.opts.onBack();
  }

  private startScan(): void {
    const qrScan = this.opts.qrScan;
    const video = this.video;
    if (qrScan === undefined || video === null || this.scanning) return;
    this.scanning = true;
    this.setText(this.joinError, "");
    this.setText(this.scanStatus, "");
    this.showScanView(true);
    qrScan.scanner.start(video, (text) => { this.onScanned(text); }).then(
      () => undefined,
      (err: unknown) => { this.scanFailed(err); },
    );
  }

  private onScanned(text: string): void {
    if (!this.scanning) return;
    const code = roomCodeFromScan(text);
    if (code === null) {
      // Keep scanning: the next frame may hold the right QR.
      this.setText(this.scanStatus, t(this.opts.locale, "lobby.errInvalidCode"));
      return;
    }
    this.fillBoxes(code);
    this.stopScan();
    this.opts.onJoin(code);
  }

  private scanFailed(err: unknown): void {
    // Already left the camera view (Back / close / join): the camera is
    // stopped and the player has moved on, so there is nothing to report.
    if (!this.scanning) return;
    let kind: CameraErrorKind;
    if (err instanceof CameraError) {
      kind = err.kind;
    } else {
      console.error("[lobby] RoomCodeScreen: camera scanner failed to start", err);
      kind = "busy";
    }
    this.leaveScan();
    this.setText(this.joinError, t(this.opts.locale, cameraErrorKey(kind)));
  }

  /** Stop the camera and return to the code boxes. */
  private leaveScan(): void {
    this.stopScan();
    this.showScanView(false);
    this.boxes[0]?.focus();
  }

  private stopScan(): void {
    if (!this.scanning) return;
    this.scanning = false;
    this.opts.qrScan?.scanner.stop();
  }

  private showScanView(scanning: boolean): void {
    if (this.joinView !== null) setShown(this.joinView, !scanning);
    if (this.scanView !== null) setShown(this.scanView, scanning);
  }

  private setText(el: HTMLElement | null, text: string): void {
    if (el !== null) el.textContent = text;
  }
}

/** Show/hide by inline display, so the element's class layout comes back on show. */
function setShown(el: HTMLElement, shown: boolean): void {
  el.style.display = shown ? "" : "none";
}

function cameraErrorKey(kind: CameraErrorKind): StringKey {
  switch (kind) {
    case "denied":
      return "lobby.errCameraDenied";
    case "noCamera":
      return "lobby.errNoCamera";
    case "busy":
      return "lobby.errCameraBusy";
  }
}

// ---- Lobby ----

export interface LobbyScreenOptions {
  host: HTMLElement;
  locale: Locale;
  device?: LobbyDevice;
  /** Per-device default skin UUID (Settings Appearance) — new locals start on it. */
  defaultSkinId?: string;
  /** State changes feed this screen (host or guest view). */
  onEvent: (event: Parameters<typeof reduceLobby>[1]) => void;
  /** Host start pressed with a valid, all-ready state. */
  onStart: () => void;
  onQuit: () => void;
  /** Settings entry (spec §14: reachable from lobby always). */
  onSettings?: () => void;
  /** Ticket 101: page host for the QR share link; no QR is drawn without it. */
  pageHost?: string;
  /** Page path for the QR link (project-site subpath, default "/"). */
  pagePath?: string;
}

export class LobbyScreen {
  readonly root: HTMLDivElement;
  private readonly nav: GamepadMenuNav;
  private state: LobbyState;
  private readonly opts: LobbyScreenOptions;
  private readonly device: LobbyDevice;
  private readonly playersEl: HTMLElement;
  private readonly configEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  /** Ticket 101: holds the QR canvas for the current room code. */
  private readonly qrEl: HTMLElement;
  /** The code the QR was drawn for — redraw only when it changes. */
  private qrCode: string | null = null;
  private startEl: HTMLButtonElement | null = null;

  constructor(opts: LobbyScreenOptions) {
    ensureStyles();
    this.opts = opts;
    this.device = opts.device ?? DESKTOP_DEVICE;
    this.state = createLobbyState(true);

    this.root = document.createElement("div");
    this.root.className = "ld-root";
    this.root.dataset.screen = "lobby";
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

    this.qrEl = document.createElement("div");
    this.qrEl.style.display = "flex";
    this.qrEl.style.justifyContent = "center";
    panel.appendChild(this.qrEl);

    this.playersEl = document.createElement("div");
    this.playersEl.style.display = "flex";
    this.playersEl.style.flexDirection = "column";
    this.playersEl.style.gap = "6px";
    panel.appendChild(this.playersEl);

    const addLocal = menuBtn(opts.locale, "lobby.addLocalPlayer");
    addLocal.addEventListener("click", () => {
      this.dispatch({
        type: "addLocalPlayer",
        ...(opts.defaultSkinId !== undefined ? { skinId: opts.defaultSkinId } : {}),
      });
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
    this.startEl = start;
    const quit = menuBtn(opts.locale, "menu.quit");
    quit.addEventListener("click", () => {
      this.opts.onQuit();
    });
    panel.append(start, quit);

    // Settings (spec §14: reachable from lobby always).
    if (opts.onSettings !== undefined) {
      const settingsBtn = menuBtn(opts.locale, "menu.settings");
      settingsBtn.addEventListener("click", () => { this.opts.onSettings?.(); });
      panel.appendChild(settingsBtn);
    }

    this.root.appendChild(panel);
    opts.host.appendChild(this.root);
    this.nav = new GamepadMenuNav({ root: this.root });
    this.nav.start();
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

  /** Share QR for the room code (ticket 101): only while joining is possible. */
  private renderQr(code: string | null): void {
    const host = this.opts.pageHost;
    const wanted = host === undefined ? null : code;
    if (wanted === this.qrCode) return;
    this.qrCode = wanted;
    this.qrEl.replaceChildren();
    if (wanted === null || host === undefined) return;
    const canvas = renderQrCanvas(qrPayloadFor(wanted, host, this.opts.pagePath));
    if (canvas !== null) this.qrEl.appendChild(canvas);
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

    this.renderQr(s.phase === "lobby" ? s.code : null);

    // Start gate (spec §8): host + lobby phase + every player ready.
    // Mirrors the reducer's startCountdown guard so the button never
    // invites a click that would be rejected.
    if (this.startEl !== null) {
      this.startEl.disabled =
        !s.isHost ||
        s.phase !== "lobby" ||
        s.players.some((p) => !p.ready);
    }

    // Players: name (editable, local), skin picker (local, ticket 44),
    // ready check, kick (host-only on remotes).
    this.playersEl.replaceChildren();
    for (const p of s.players) {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";
      const name = document.createElement("span");
      name.textContent = p.name;
      name.style.color = "#eee";
      if (p.kind === "local") {
        // Name editing (ticket 43 leftover, spec §8): 12-char max,
        // never localized. Input replaces the span on this row.
        const input = document.createElement("input");
        input.className = "ld-input";
        input.style.letterSpacing = "0";
        input.style.width = "12ch";
        input.style.textTransform = "none";
        input.value = p.name;
        input.maxLength = NAME_MAX_CHARS;
        input.addEventListener("change", () => {
          this.dispatch({ type: "setPlayerName", playerId: p.id, name: input.value });
        });
        row.appendChild(input);
        // Skin picker (ticket 44): same slot as name editing.
        const skin = document.createElement("select");
        skin.className = "ld-input";
        skin.style.letterSpacing = "0";
        skin.style.textTransform = "none";
        skin.style.width = "auto";
        skin.style.minHeight = "48px";
        for (const sk of SKINS) {
          const opt = document.createElement("option");
          opt.value = sk.id;
          opt.textContent = sk.name;
          skin.appendChild(opt);
        }
        skin.value = p.skinId;
        skin.addEventListener("change", () => {
          this.dispatch({ type: "setPlayerSkin", playerId: p.id, skinId: skin.value });
        });
        row.appendChild(skin);
      } else {
        row.appendChild(name);
      }
      const ready = document.createElement("button");
      ready.className = "ld-btn";
      ready.style.minHeight = "48px";
      ready.style.minWidth = "72px";
      ready.textContent = p.ready ? t(locale, "lobby.ready") : t(locale, "lobby.notReady");
      ready.addEventListener("click", () => {
        this.dispatch({ type: "setReady", playerId: p.id, ready: !p.ready });
      });
      row.appendChild(ready);
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

    // Field theme (ticket 44): host-chosen, visual-only (spec §13).
    // Host edits via select; guests see the chosen name read-only.
    const themeRow = document.createElement("div");
    themeRow.style.display = "flex";
    themeRow.style.alignItems = "center";
    themeRow.style.gap = "8px";
    const themeLabel = document.createElement("span");
    themeLabel.className = "ld-hint";
    themeLabel.textContent = t(locale, "settings.theme");
    themeRow.appendChild(themeLabel);
    if (s.isHost) {
      const themeSelect = document.createElement("select");
      themeSelect.className = "ld-input";
      themeSelect.style.letterSpacing = "0";
      themeSelect.style.textTransform = "none";
      themeSelect.style.width = "auto";
      themeSelect.style.minHeight = "48px";
      for (const th of THEMES) {
        const opt = document.createElement("option");
        opt.value = th.id;
        opt.textContent = th.name;
        themeSelect.appendChild(opt);
      }
      themeSelect.value = s.config.themeId;
      themeSelect.addEventListener("change", () => {
        this.dispatch({ type: "setConfig", config: { themeId: themeSelect.value } });
      });
      themeRow.appendChild(themeSelect);
    } else {
      const themeName = document.createElement("span");
      themeName.style.color = "#eee";
      themeName.textContent =
        THEMES.find((th) => th.id === s.config.themeId)?.name ?? THEMES[0]?.name ?? "";
      themeRow.appendChild(themeName);
    }
    this.configEl.appendChild(themeRow);
  }

  close(): void {
    this.nav.stop();
    this.root.remove();
  }

  /** Re-attach after close (match ended → back to lobby). Idempotent. */
  reopen(): void {
    if (this.root.isConnected) return;
    this.opts.host.appendChild(this.root);
    this.nav.start();
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

export { NAME_MAX_CHARS, MOBILE_DEVICE, codeFromUrl };
