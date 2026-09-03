import { RoomDO } from "./room";
import { validateRoomCode } from "./code";

export interface SignalingEnv {
  ROOM_DO: DurableObjectNamespace<RoomDO>;
  ALLOWED_ORIGINS: string;
}

const ROOM_PATH_REGEX = /^\/room\/([A-Za-z0-9]{1,64})\/ws$/;

function originAllowed(origin: string | null, allowed: string): boolean {
  if (origin === null) return false;
  const list = allowed.split(",").map((o) => o.trim()).filter((o) => o.length > 0);
  return list.includes(origin);
}

export default {
  async fetch(request: Request, env: SignalingEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }
    const match = ROOM_PATH_REGEX.exec(url.pathname);
    if (match === null || match[1] === undefined) {
      return new Response("not found", { status: 404 });
    }
    const code = match[1].toUpperCase();
    if (!validateRoomCode(code)) {
      return new Response("invalid room code", { status: 400 });
    }
    if (!originAllowed(request.headers.get("Origin"), env.ALLOWED_ORIGINS)) {
      return new Response("origin not allowed", { status: 403 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }
    const id = env.ROOM_DO.idFromName(code);
    const stub = env.ROOM_DO.get(id);
    return stub.fetch(request);
  },
} satisfies ExportedHandler<SignalingEnv>;

export { RoomDO };
