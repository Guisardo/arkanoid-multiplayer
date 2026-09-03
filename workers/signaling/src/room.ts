import { DurableObject } from "cloudflare:workers";
import {
  createRelayState,
  handleRoomMessage,
  joinGuest,
  leaveMember,
  parseRelayMessage,
  type RelayAction,
  type RelayMember,
  type RelayState,
} from "./relayLogic";

interface SocketAttachment {
  role: "host" | "guest";
  guestIndex: number;
}

const HOST_ATTACHMENT: SocketAttachment = { role: "host", guestIndex: -1 };

export class RoomDO extends DurableObject {
  private relayState: RelayState;

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    this.relayState = createRelayState();
    this.initStorage();
    this.restoreFromStorage();
    this.restoreLiveSockets();
  }

  private restoreLiveSockets(): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment === null) continue;
      if (attachment.role === "host") {
        this.relayState.host = { role: "host", guestIndex: -1 };
      } else {
        this.relayState.guests.push({ role: "guest", guestIndex: attachment.guestIndex });
      }
    }
  }

  private initStorage(): void {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS room_log (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS room_kv (key TEXT PRIMARY KEY, value INTEGER NOT NULL)",
    );
  }

  private restoreFromStorage(): void {
    const rows = this.ctx.storage.sql.exec("SELECT payload FROM room_log").toArray();
    for (const row of rows) {
      const msg = parseRelayMessage(row.payload as string);
      if (msg === null) continue;
      if (msg.type === "host-offer" && msg.sdp !== undefined) {
        this.relayState.hostOffer = msg.sdp;
      }
    }
    const hostRows = this.ctx.storage.sql.exec(
      "SELECT value FROM room_kv WHERE key = 'host-present'",
    ).toArray();
    if (hostRows.length > 0 && hostRows[0]?.value === 1) {
      this.relayState.host = { role: "host", guestIndex: -1 };
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.endsWith("/ws")) {
      return new Response("not found", { status: 404 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const role = url.searchParams.get("role");
    this.ctx.acceptWebSocket(server);
    if (role === "host") {
      server.serializeAttachment(HOST_ATTACHMENT);
      this.relayState.host = { role: "host", guestIndex: -1 };
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO room_kv (key, value) VALUES ('host-present', 1)",
      );
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") {
      ws.send(JSON.stringify({ type: "error", reason: "binary messages unsupported" }));
      return;
    }
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (attachment === null) {
      this.handleJoin(ws, message);
      return;
    }
    const member: RelayMember = { role: attachment.role, guestIndex: attachment.guestIndex };
    const msg = parseRelayMessage(message);
    if (msg === null) {
      ws.send(JSON.stringify({ type: "error", reason: "malformed message" }));
      return;
    }
    if (msg.type === "host-offer" && msg.sdp !== undefined) {
      this.ctx.storage.sql.exec("INSERT INTO room_log (payload) VALUES (?)", message);
    }
    const actions = handleRoomMessage(this.relayState, member, msg);
    this.dispatch(actions);
  }

  private handleJoin(ws: WebSocket, message: string): void {
    const msg = parseRelayMessage(message);
    if (msg === null || msg.type !== "join") {
      ws.send(JSON.stringify({ type: "error", reason: "malformed message" }));
      return;
    }
    const result = joinGuest(this.relayState);
    if (result.member === null) {
      const rejectAction = result.actions[0];
      if (rejectAction !== undefined) {
        ws.send(JSON.stringify(rejectAction.message));
      }
      return;
    }
    const attachment: SocketAttachment = { role: "guest", guestIndex: result.member.guestIndex };
    ws.serializeAttachment(attachment);
    this.dispatch(result.actions);
  }

  private dispatch(actions: RelayAction[]): void {
    const sockets = this.ctx.getWebSockets();
    for (const action of actions) {
      if (action.to === null) continue;
      for (const socket of sockets) {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null;
        if (attachment === null) continue;
        if (attachment.role !== action.to.role) continue;
        if (action.to.role === "guest" && attachment.guestIndex !== action.to.guestIndex) continue;
        socket.send(JSON.stringify(action.message));
      }
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    void wasClean;
    ws.close(code, reason);
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (attachment === null) return;
    const member: RelayMember = { role: attachment.role, guestIndex: attachment.guestIndex };
    const actions = leaveMember(this.relayState, member);
    if (member.role === "host") {
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO room_kv (key, value) VALUES ('host-present', 0)",
      );
    }
    this.dispatch(actions);
  }
}
