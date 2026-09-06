// Pause coordination units (ticket 48): the pure reducer + mode gate.
import { describe, expect, it } from "vitest";
import { pauseAllowedFor, reducePause, UNPAUSED } from "app/pauseCoord";

describe("pauseCoord (ticket 48)", () => {
  it("request pauses with the requester recorded", () => {
    const next = reducePause(UNPAUSED, { type: "request", player: 2 });
    expect(next).toEqual({ paused: true, pausedBy: 2 });
  });

  it("a second request while paused is a no-op (state keeps the pauser)", () => {
    const first = reducePause(UNPAUSED, { type: "request", player: 1 });
    const second = reducePause(first, { type: "request", player: 3 });
    expect(second).toBe(first);
    expect(second.pausedBy).toBe(1);
  });

  it("the pauser cancels its own pause; another player cannot cancel", () => {
    const paused = reducePause(UNPAUSED, { type: "request", player: 1 });
    const stranger = reducePause(paused, { type: "cancel", player: 2 });
    expect(stranger).toBe(paused);
    const own = reducePause(paused, { type: "cancel", player: 1 });
    expect(own).toEqual(UNPAUSED);
  });

  it("any player resumes; resume while unpaused is a no-op", () => {
    const paused = reducePause(UNPAUSED, { type: "request", player: 0 });
    expect(reducePause(paused, { type: "resume", player: 3 })).toEqual(UNPAUSED);
    expect(reducePause(UNPAUSED, { type: "resume", player: 0 })).toBe(UNPAUSED);
  });

  it("coop modes allow pause; competitive modes never do (spec §8)", () => {
    expect(pauseAllowedFor("sharedField")).toBe(true);
    expect(pauseAllowedFor("parallelAssist")).toBe(true);
    expect(pauseAllowedFor("race")).toBe(false);
    expect(pauseAllowedFor("attack")).toBe(false);
    expect(pauseAllowedFor("duel")).toBe(false);
  });
});
