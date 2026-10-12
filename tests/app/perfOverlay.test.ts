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
      memory: { heapUsedMb: 42, textureMb: 0.1, textureOverBudget: false, heapWarning: false },
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

  // ---- Ticket 102: memory telemetry ----
  it("reports the JS heap and texture memory", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const overlay = new PerfOverlay(host);
    const stats = new FrameStats();
    stats.push({ simMs: 1, syncMs: 1, renderMs: 1, frameMs: 16.7 } as never, 16.7);
    overlay.update({
      stats: stats.view,
      dpr: 1,
      renderEvery: 1,
      drawCalls: null,
      textureMb: 2.5,
      memory: { heapUsedMb: 128.25, textureMb: 2.5, textureOverBudget: false, heapWarning: false },
    });
    const text = overlay.root.textContent ?? "";
    expect(text).toContain("heap 128.3MB");
    expect(text).toContain("tex 2.5MB");
    overlay.close();
  });

  it("shows ? for the heap where the browser does not expose performance.memory", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const overlay = new PerfOverlay(host);
    const stats = new FrameStats();
    overlay.update({
      stats: stats.view,
      dpr: 1,
      renderEvery: 1,
      drawCalls: null,
      textureMb: 0.1,
      memory: { heapUsedMb: null, textureMb: 0.1, textureOverBudget: false, heapWarning: false },
    });
    const text = overlay.root.textContent ?? "";
    expect(text).toContain("heap ?");
    overlay.close();
  });

  it("marks a texture ceiling breach and a heap warning", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const overlay = new PerfOverlay(host);
    const stats = new FrameStats();
    overlay.update({
      stats: stats.view,
      dpr: 1,
      renderEvery: 1,
      drawCalls: null,
      textureMb: 96,
      memory: { heapUsedMb: 512, textureMb: 96, textureOverBudget: true, heapWarning: true },
    });
    const text = overlay.root.textContent ?? "";
    expect(text).toContain("tex 96.0MB (≤64) !");
    expect(text).toContain("heap 512.0MB");
    overlay.close();
  });

  it("omits the heap line entirely when no memory sample is supplied", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const overlay = new PerfOverlay(host);
    overlay.update({
      stats: new FrameStats().view,
      dpr: 1,
      renderEvery: 1,
      drawCalls: null,
      textureMb: null,
    });
    expect(overlay.root.querySelector('[data-line="heap"]')).toBeNull();
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
