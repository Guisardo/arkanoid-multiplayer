// ICE configuration assembly (spec §10 ICE / ticket 38).
// Google STUN primary, Open Relay STUN secondary, TURN fallback on ports
// 80/443 over UDP/TCP/TLS. TURN credentials come from the credential Worker;
// when that fetch fails the config degrades to STUN-only — STUN-direct
// connections still work, only TURN relay is unavailable.

export interface IceServerSpec {
  urls: string;
  username?: string;
  credential?: string;
}

export interface ResolvedIceConfig {
  iceServers: IceServerSpec[];
  turnEnabled: boolean;
}

// Fresh objects per call — configs are never shared/mutable across callers.
export function stunOnlyServers(): IceServerSpec[] {
  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:openrelay.metered.ca:80" },
  ];
}

// Open Relay TURN fallback: ports 80/443, UDP/TCP/TLS (spec §10).
const OPENRELAY_TURN_URLS: readonly string[] = [
  "turn:openrelay.metered.ca:80",
  "turn:openrelay.metered.ca:80?transport=tcp",
  "turn:openrelay.metered.ca:443",
  "turns:openrelay.metered.ca:443?transport=tcp",
];

export function turnServers(username: string, credential: string): IceServerSpec[] {
  return OPENRELAY_TURN_URLS.map((urls) => ({ urls, username, credential }));
}

/** Spec-locked assembly: STUN pair + Open Relay TURN on 80/443 UDP/TCP/TLS. */
export function assembleIceConfig(username: string, credential: string): ResolvedIceConfig {
  return {
    iceServers: [...stunOnlyServers(), ...turnServers(username, credential)],
    turnEnabled: true,
  };
}

export function stunOnlyConfig(): ResolvedIceConfig {
  return { iceServers: stunOnlyServers(), turnEnabled: false };
}

/**
 * Assembly from the credential Worker's response: the spec STUN pair first,
 * then the Metered-issued iceServers (account-correct, geo-routed TURN
 * hostnames) as the TURN entries.
 */
export function assembleWithMeteredServers(meteredServers: IceServerSpec[]): ResolvedIceConfig {
  return {
    iceServers: [...stunOnlyServers(), ...meteredServers],
    turnEnabled: true,
  };
}

export type FetchLike = (url: string) => Promise<ResponseLike>;

export interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Validate a Metered-style iceServers array; null when absent or malformed. */
export function parseIceServerEntries(body: unknown): IceServerSpec[] | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const servers: IceServerSpec[] = [];
  for (const entry of body) {
    if (!isRecord(entry)) return null;
    const { urls } = entry;
    if (typeof urls !== "string" || urls.length === 0) return null;
    const server: IceServerSpec = { urls };
    if (typeof entry.username === "string") server.username = entry.username;
    if (typeof entry.credential === "string") server.credential = entry.credential;
    servers.push(server);
  }
  return servers;
}

interface CredentialPayload {
  username: string;
  password: string;
  meteredServers: IceServerSpec[] | null;
}

function parseCredentialPayload(body: unknown): CredentialPayload | null {
  if (!isRecord(body)) return null;
  const { username, password } = body;
  if (typeof username !== "string" || username.length === 0) return null;
  if (typeof password !== "string" || password.length === 0) return null;
  return {
    username,
    password,
    meteredServers: parseIceServerEntries(body.iceServers),
  };
}

/**
 * Fetch short-TTL TURN credentials from the credential Worker and assemble
 * the full ICE config. Prefers the Worker's Metered-issued iceServers
 * (account-correct TURN hostnames); falls back to the spec-locked Open Relay
 * URL assembly from the returned username/password. Never throws: any
 * failure (network, non-200, malformed body) resolves to the STUN-only
 * config so connection setup proceeds STUN-direct — only TURN degrades.
 */
export async function fetchIceConfig(
  credentialEndpoint: string,
  fetchLike: FetchLike,
): Promise<ResolvedIceConfig> {
  try {
    const response = await fetchLike(credentialEndpoint);
    if (!response.ok) return stunOnlyConfig();
    const payload = parseCredentialPayload(await response.json());
    if (payload === null) return stunOnlyConfig();
    if (payload.meteredServers !== null) {
      return assembleWithMeteredServers(payload.meteredServers);
    }
    return assembleIceConfig(payload.username, payload.password);
  } catch {
    return stunOnlyConfig();
  }
}
