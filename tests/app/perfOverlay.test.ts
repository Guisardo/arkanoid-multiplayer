// Ticket 54: perf overlay — dev-only DOM readout behind ?perf=1.
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { PerfOverlay, perfFlagOn } from "app/perfOverlay";
import { FrameStats } from "app/frameStats";

describe("perf overlay (ticket 54)", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("renders the sim/sync/render/fps/dpr/draw/tex lines", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const overlay = new PerfOverlay(host);
    const stats = new FrameStats();
    stats.push({ simMs: 1, syncMs: 2, renderMs: 3, frameMs: 16.7 } as never, 16.7);
    overlay.update({
      stats: stats.view,
      dpr: 1.5,
      renderEvery: 1,
      drawCalls: 8,
      textureMb: 0.1,
    });
    const text = overlay.root.textContent ?? "";
    expect(text).toContain("fps");
    expect(text).toContain("sim 1.00ms");
    expect(text).toContain("sync 2.00ms");
    expect(text).toContain("render 3.00ms");
    expect(text).toContain("dpr 1.5");
    expect(text).toContain("draw 8");
    expect(text).toContain("tex 0.1MB");
    overlay.close();
  });

  it("marks 30 fps mode and budget breaches", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const overlay = new PerfOverlay(host);
    const stats = new FrameStats();
    stats.push({ simMs: 3, syncMs: 4, renderMs: 6, frameMs: 16.7 } as never, 16.7);
    overlay.update({
      stats: stats.view,
      dpr: 1,
      renderEvery: 2,
      drawCalls: null,
      textureMb: null,
    });
    const text = overlay.root.textContent ?? "";
    expect(text).toContain("30fps mode");
    expect(text).toContain("!"); // over-budget markers
    expect(text).toContain("draw ?");
    overlay.close();
  });

  it("close removes the root", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const overlay = new PerfOverlay(host);
    expect(document.querySelector("[data-perf-overlay]")).not.toBeNull();
    overlay.close();
    expect(document.querySelector("[data-perf-overlay]")).toBeNull();
  });
});

describe("perfFlagOn (?perf=1)", () => {
  it("detects the flag", () => {
    expect(perfFlagOn("https://host/game?perf=1")).toBe(true);
    expect(perfFlagOn("https://host/game")).toBe(false);
    expect(perfFlagOn("https://host/game?perf=0")).toBe(false);
  });

  it("garbage hrefs are off, never throw", () => {
    expect(perfFlagOn("not a url")).toBe(false);
  });
});
