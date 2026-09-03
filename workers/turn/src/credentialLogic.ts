// Pure TURN-credential issuance logic (spec §10 ICE / ticket 38).
// Kept free of Workers runtime types so it is unit-testable with a fake fetch:
// the Worker handler in worker.ts wires these functions to the real runtime.

export interface TurnCredential {
  username: string;
  password: string;
  apiKey: string;
}

export interface MeteredIceServer {
  urls: string;
  username?: string;
  credential?: string;
}

export const CREDENTIAL_TTL_SECONDS = 3600; // ~1 h per spec §10

export function originAllowed(origin: string | null, allowed: string): boolean {
  if (origin === null) return false;
  const list = allowed.split(",").map((o) => o.trim()).filter((o) => o.length > 0);
  return list.includes(origin);
}

export function meteredCredentialUrl(domain: string, secretKey: string): string {
  return `https://${domain}/api/v1/turn/credential?secretKey=${encodeURIComponent(secretKey)}`;
}

export function meteredIceServersUrl(domain: string, apiKey: string): string {
  return `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseCredentialResponse(body: unknown): TurnCredential | null {
  if (!isRecord(body)) return null;
  const { username, password, apiKey } = body;
  if (typeof username !== "string" || username.length === 0) return null;
  if (typeof password !== "string" || password.length === 0) return null;
  if (typeof apiKey !== "string" || apiKey.length === 0) return null;
  return { username, password, apiKey };
}

export function parseIceServersResponse(body: unknown): MeteredIceServer[] | null {
  if (!Array.isArray(body)) return null;
  const servers: MeteredIceServer[] = [];
  for (const entry of body) {
    if (!isRecord(entry)) return null;
    const urls = entry.urls;
    if (typeof urls !== "string" || urls.length === 0) return null;
    const server: MeteredIceServer = { urls };
    if (typeof entry.username === "string") server.username = entry.username;
    if (typeof entry.credential === "string") server.credential = entry.credential;
    servers.push(server);
  }
  return servers;
}

export type FetchLike = (input: string, init?: RequestInit_Like) => Promise<ResponseLike>;

// Structural stand-ins for the Workers runtime fetch types so this module
// typechecks under both the Workers tsconfig and the root tsconfig (DOM lib).
export interface RequestInit_Like {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface IssueTurnCredentialsResult {
  status: number;
  body: string;
}

/**
 * Full issuance flow: mint an expiring credential (secret stays server-side),
 * then resolve it to the iceServers array Metered returns for that credential.
 * Any failure maps to a non-200 status — the client treats that as
 * "no TURN this session" and falls back to STUN-direct (never fatal).
 */
export async function issueTurnCredentials(
  domain: string,
  secretKey: string,
  label: string,
  fetchLike: FetchLike,
  ttlSeconds: number = CREDENTIAL_TTL_SECONDS,
): Promise<IssueTurnCredentialsResult> {
  let mintResponse: ResponseLike;
  try {
    mintResponse = await fetchLike(meteredCredentialUrl(domain, secretKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiryInSeconds: ttlSeconds, label }),
    });
  } catch {
    return { status: 502, body: JSON.stringify({ error: "credential mint failed" }) };
  }
  if (!mintResponse.ok) {
    return { status: 502, body: JSON.stringify({ error: "credential mint failed" }) };
  }
  let mintBody: unknown;
  try {
    mintBody = await mintResponse.json();
  } catch {
    return { status: 502, body: JSON.stringify({ error: "malformed credential response" }) };
  }
  const credential = parseCredentialResponse(mintBody);
  if (credential === null) {
    return { status: 502, body: JSON.stringify({ error: "malformed credential response" }) };
  }
  let iceResponse: ResponseLike;
  try {
    iceResponse = await fetchLike(meteredIceServersUrl(domain, credential.apiKey), {
      method: "GET",
    });
  } catch {
    return { status: 502, body: JSON.stringify({ error: "ice servers fetch failed" }) };
  }
  if (!iceResponse.ok) {
    return { status: 502, body: JSON.stringify({ error: "ice servers fetch failed" }) };
  }
  let iceBody: unknown;
  try {
    iceBody = await iceResponse.json();
  } catch {
    return { status: 502, body: JSON.stringify({ error: "malformed ice servers response" }) };
  }
  const iceServers = parseIceServersResponse(iceBody);
  if (iceServers === null) {
    return { status: 502, body: JSON.stringify({ error: "malformed ice servers response" }) };
  }
  return {
    status: 200,
    body: JSON.stringify({
      iceServers,
      username: credential.username,
      password: credential.password,
      ttlSeconds,
    }),
  };
}
