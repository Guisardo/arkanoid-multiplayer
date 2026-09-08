// Deploy environment resolution (ticket 55).
// Pure URL builders fed by injected env + location — the app boundary
// (main.ts) owns the actual import.meta.env read; everything here stays
// unit-testable with plain objects.
//
// Vars (all optional — absent = dev behavior, unchanged):
// - VITE_SIGNALING_BASE: https://<worker>.workers.dev — signaling WS base.
//     Absent → same-origin (localhost dev / wrangler dev proxy).
// - VITE_TURN_URL: https://<worker>.workers.dev/turn/credentials — TURN
//     credential endpoint. Absent → STUN-only (no fetch, current behavior).

export interface DeployEnv {
  signalingBase?: string;
  turnUrl?: string;
}

/** Read Vite env into a plain record (called once at the app boundary). */
export function deployEnvFromVite(env: Record<string, unknown>): DeployEnv {
  const out: DeployEnv = {};
  const signaling = env.VITE_SIGNALING_BASE;
  if (typeof signaling === "string" && signaling.length > 0) {
    out.signalingBase = stripTrailingSlash(signaling);
  }
  const turn = env.VITE_TURN_URL;
  if (typeof turn === "string" && turn.length > 0) {
    out.turnUrl = turn;
  }
  return out;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * Signaling WS URL for a room. Explicit base wins (production Worker);
 * absent → same-origin path (dev server / wrangler dev proxy).
 */
export function signalingUrlFor(
  env: DeployEnv,
  code: string,
  role: "host" | "guest",
  location: { protocol: string; host: string },
): string {
  if (env.signalingBase !== undefined) {
    return `${env.signalingBase}/room/${code}/ws?role=${role}`;
  }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/room/${code}/ws?role=${role}`;
}

/** True when a TURN credential endpoint is configured. */
export function turnConfigured(env: DeployEnv): boolean {
  return env.turnUrl !== undefined;
}
