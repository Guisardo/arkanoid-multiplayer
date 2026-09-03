import {
  CREDENTIAL_TTL_SECONDS,
  issueTurnCredentials,
  originAllowed,
  type IssueTurnCredentialsResult,
  type RequestInit_Like,
} from "./credentialLogic";

export interface TurnEnv {
  METERED_DOMAIN: string;
  METERED_SECRET_KEY: string;
  ALLOWED_ORIGINS: string;
}

const CREDENTIAL_PATH = "/turn/credentials";

function jsonResponse(result: IssueTurnCredentialsResult): Response {
  return new Response(result.body, {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
}

// Adapter from the pure logic's structural fetch types to the Workers
// runtime fetch (RequestInit_Like is structurally assignable to RequestInit).
function workersFetch(input: string, init?: RequestInit_Like): Promise<Response> {
  return fetch(input, init);
}

export default {
  async fetch(request: Request, env: TurnEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }
    if (url.pathname !== CREDENTIAL_PATH) {
      return new Response("not found", { status: 404 });
    }
    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    if (!originAllowed(request.headers.get("Origin"), env.ALLOWED_ORIGINS)) {
      return new Response("origin not allowed", { status: 403 });
    }
    // Label carries no client-controlled data: a coarse per-day bucket keeps
    // Metered usage attribution readable without storing anything per-user.
    const label = `turn-${new Date().toISOString().slice(0, 10)}`;
    const result = await issueTurnCredentials(
      env.METERED_DOMAIN,
      env.METERED_SECRET_KEY,
      label,
      workersFetch,
      CREDENTIAL_TTL_SECONDS,
    );
    return jsonResponse(result);
  },
} satisfies ExportedHandler<TurnEnv>;
