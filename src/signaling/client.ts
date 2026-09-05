import { validateRoomCode } from "signaling/code";
import type { RelayMessage } from "signaling/relayLogic";

export type SignalingEvent = RelayMessage;

export class SignalingUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignalingUnavailable";
  }
}

export interface SignalingConnectOptions {
  url?: string;
  role?: "host" | "guest";
  connectTimeoutMs?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const AWAIT_TIMEOUT_MS = 30000;

export class SignalingClient {
  private readonly ws: WebSocket;
  private readonly handlers: Array<(msg: SignalingEvent) => void> = [];
  private readonly pending: SignalingEvent[] = [];
  private closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      let parsed: SignalingEvent;
      try {
        parsed = JSON.parse(ev.data as string) as SignalingEvent;
      } catch {
        parsed = { type: "error", reason: "malformed server message" };
      }
      if (this.handlers.length === 0) {
        this.pending.push(parsed);
        return;
      }
      for (const h of [...this.handlers]) h(parsed);
    });
  }

  static async connect(code: string, opts: SignalingConnectOptions = {}): Promise<SignalingClient> {
    if (!validateRoomCode(code)) {
      throw new SignalingUnavailable("invalid room code");
    }
    const role = opts.role ?? "guest";
    const url = opts.url ?? defaultSignalingUrl(code, role);
    const timeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const ws = new WebSocket(url);
    const client = new SignalingClient(ws);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err: SignalingUnavailable | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err === null) resolve();
        else reject(err);
      };
      const timer = setTimeout(() => {
        ws.close();
        finish(new SignalingUnavailable("signaling connect timeout"));
      }, timeoutMs);
      ws.addEventListener("open", () => {
        finish(null);
      }, { once: true });
      ws.addEventListener("error", () => {
        finish(new SignalingUnavailable("signaling server unavailable"));
      }, { once: true });
      ws.addEventListener("close", () => {
        finish(new SignalingUnavailable("signaling server unavailable"));
      }, { once: true });
    });
    if (role === "guest") {
      client.send({ type: "join" });
    }
    return client;
  }

  /**
   * Live event stream. Multiple handlers may register simultaneously (the
   * host room listens for joins while awaiting a specific guest's answer);
   * all receive every event.
   */
  onMessage(cb: (msg: SignalingEvent) => void): () => void {
    this.handlers.push(cb);
    while (this.pending.length > 0) {
      const buffered = this.pending.shift();
      if (buffered === undefined) break;
      cb(buffered);
    }
    return () => {
      const i = this.handlers.indexOf(cb);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  send(msg: RelayMessage): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private waitFor(
    pred: (msg: SignalingEvent) => boolean,
    failTypes: readonly SignalingEvent["type"][],
  ): Promise<SignalingEvent> {
    return new Promise<SignalingEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new SignalingUnavailable("signaling wait timeout"));
      }, AWAIT_TIMEOUT_MS);
      const off = this.onMessage((msg) => {
        if (failTypes.includes(msg.type)) {
          clearTimeout(timer);
          off();
          reject(new SignalingUnavailable(msg.reason ?? msg.type));
          return;
        }
        if (pred(msg)) {
          clearTimeout(timer);
          off();
          resolve(msg);
        }
      });
    });
  }

  // ---- Guest flow ----

  /** Guest: await the joined-ack carrying our guest index. */
  async joinedAck(): Promise<number> {
    const ack = await this.waitFor(
      (msg) => msg.type === "joined-ack" && msg.guestIndex !== undefined,
      ["error", "room-full"],
    );
    return ack.guestIndex ?? 0;
  }

  /** Guest: await the host offer targeted at our guest index. */
  async offer(): Promise<string> {
    const offer = await this.waitFor(
      (msg) => msg.type === "host-offer" && msg.sdp !== undefined,
      ["error", "room-full"],
    );
    const sdp = offer.sdp;
    if (sdp === undefined) throw new SignalingUnavailable("offer missing sdp");
    return sdp;
  }

  sendAnswer(answerSdp: string): void {
    this.send({ type: "guest-answer", sdp: answerSdp });
  }

  sendIce(candidate: string, guestIndex?: number): void {
    if (guestIndex === undefined) {
      this.send({ type: "ice", candidate });
      return;
    }
    this.send({ type: "ice", candidate, guestIndex });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close(1000, "signaling complete");
    }
  }
}

export function defaultSignalingUrl(code: string, role: "host" | "guest"): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/room/${code}/ws?role=${role}`;
}
