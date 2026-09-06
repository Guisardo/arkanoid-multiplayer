// Pause coordination (ticket 48, spec §8/§14): coop remote pause semantics
// as a pure reducer. Any player (downed included) may request; the host is
// the only authority — it applies the request, pauses the sim for ALL, and
// broadcasts "paused by [player]". The pauser may cancel its own pause; any
// player may resume. Competitive remote NEVER pauses (spec §8) — the mode
// gate lives here so the wiring cannot accidentally pause a race/duel.
export interface PauseState {
  paused: boolean;
  /** Sim player index who requested the pause (header "Paused by P3"). */
  pausedBy: number | null;
}

export type PauseEvent =
  | { type: "request"; player: number }
  | { type: "cancel"; player: number }
  | { type: "resume"; player: number };

/** Coop modes pause; competitive modes never do (spec §8). */
export function pauseAllowedFor(mode: string): boolean {
  return mode === "sharedField" || mode === "parallelAssist";
}

/**
 * Reduce a pause event. Rules:
 * - request: only while unpaused (a second request while paused is a no-op
 *   — the state already says who paused); any player, downed included.
 * - cancel: only the pauser, only while paused (cancel = unpause).
 * - resume: any player, only while paused.
 */
export function reducePause(state: PauseState, event: PauseEvent): PauseState {
  switch (event.type) {
    case "request":
      if (state.paused) return state;
      return { paused: true, pausedBy: event.player };
    case "cancel":
      if (!state.paused || state.pausedBy !== event.player) return state;
      return { paused: false, pausedBy: null };
    case "resume":
      if (!state.paused) return state;
      return { paused: false, pausedBy: null };
  }
}

export const UNPAUSED: PauseState = { paused: false, pausedBy: null };
