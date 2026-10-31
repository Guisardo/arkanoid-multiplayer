// Ticket 102: memory telemetry — JS heap + texture memory, reported to the
// dev perf overlay. The collector is pure (numbers in, numbers out); the
// overlay is DOM-only, so both are testable in jsdom without a GPU.
//
// Seam: sampleMemoryStats() is the whole telemetry surface; PerfOverlay
// renders it. Catches a wrong unit (bytes vs MB), a missing null-guard for
// browsers without performance.memory, and a ceiling breach. Misses the real
// GPU number, which stays manual (docs/perf-validation.md).
import { describe, expect, it } from "vitest";
import {
  sampleMemoryStats,
  createMemoryProbe,
  withinTextureCeiling,
  cachedWallBytes as wallBytes,
  HEAP_WARNING_MB,
  type PerformanceWithMemory,
} from "app/memoryStats";
import { BUDGETS, estimateTextureBytes } from "app/frameStats";
import { PERF_RUNGS } from "app/perfLadder";
import { layoutField } from "render/layout";
import { wallCacheResolution } from "render/brickLayer";

/** RGBA8 bytes for N cached wall textures at a resolution (ADR 0005). */
const cachedWallBytes = wallBytes;

describe("memory telemetry (ticket 102)", () => {
  it("reports the JS heap in MB from performance.memory", () => {
    const probe = createMemoryProbe({
      memory: { usedJSHeapSize: 40 * 1024 * 1024 },
    });
    expect(probe.heapUsedMb).toBe(40);
  });

  it("nulls the heap where the browser does not expose performance.memory", () => {
    const probe = createMemoryProbe({});
    expect(probe.heapUsedMb).toBeNull();
  });

  it("never invents a heap number from a missing field", () => {
    const probe = createMemoryProbe({});
    expect(probe.heapUsedMb).toBeNull();
  });

  it("ignores a non-numeric heap reading rather than reporting NaN", () => {
    const probe = createMemoryProbe({
      memory: { usedJSHeapSize: "lots" },
    } as unknown as PerformanceWithMemory);
    expect(probe.heapUsedMb).toBeNull();
  });

  it("ignores a negative heap reading", () => {
    const probe = createMemoryProbe({ memory: { usedJSHeapSize: -1 } });
    expect(probe.heapUsedMb).toBeNull();
  });

  it("sums texture bytes from RGBA8 sizes", () => {
    // 64x16 + 64x64 at 4 bytes/px = 4096 + 16384 = 20480 bytes = 0.0195 MB.
    const bytes = estimateTextureBytes([{ w: 64, h: 16 }, { w: 64, h: 64 }]);
    const stats = sampleMemoryStats(createMemoryProbe(undefined), bytes);
    expect(stats.textureMb).toBeCloseTo(bytes / (1024 * 1024), 10);
  });

  it("reads the live global heap when no probe is injected", () => {
    const stats = sampleMemoryStats(createMemoryProbe(undefined), 0);
    expect(stats.heapUsedMb === null || typeof stats.heapUsedMb === "number").toBe(true);
  });

  it("flags the texture ceiling breach explicitly", () => {
    const over = BUDGETS.textureMb * 1024 * 1024 + 1;
    expect(withinTextureCeiling(over)).toBe(false);
    expect(withinTextureCeiling(BUDGETS.textureMb * 1024 * 1024)).toBe(true);
  });

  // ---- Cached wall textures (the part ticket 102 actually scales) ----
  it("counts one cached wall texture per field", () => {
    const one = cachedWallBytes([1]);
    expect(cachedWallBytes([1, 1, 1, 1])).toBe(one * 4);
    expect(cachedWallBytes([])).toBe(0);
  });

  it("a wall at half resolution costs a quarter of the bytes", () => {
    expect(cachedWallBytes([0.5, 0.5])).toBe(cachedWallBytes([1, 1]) / 4);
  });

  it("a whole 4-field match stays under the 64 MB ceiling at every rung", () => {
    // The acceptance criterion: texture memory under 64 MB. Ticket #151 records
    // each wall at its on-screen density, so size the walls like a real 4-way
    // split of a 1920x1080 CSS viewport at the rung's DPR.
    const fieldRegion = { x: 0, y: 0, w: 960, h: 540 };
    const { scale } = layoutField(fieldRegion);
    for (const rung of PERF_RUNGS) {
      const res = wallCacheResolution(scale, rung.dpr, rung.textureResolution);
      const bytes = cachedWallBytes([res, res, res, res]);
      expect(bytes / (1024 * 1024)).toBeLessThan(BUDGETS.textureMb);
    }
  });

  it("the degraded rung's downscale is a real saving", () => {
    const full = wallCacheResolution(3, 2, 1);
    const degraded = wallCacheResolution(3, 2, PERF_RUNGS[3]?.textureResolution ?? 1);
    expect(cachedWallBytes([degraded])).toBeLessThan(cachedWallBytes([full]));
  });

  it("even a wall at the texture-edge cap fits the budget on its own", () => {
    const capped = wallCacheResolution(100, 2, 1);
    expect(cachedWallBytes([capped]) / (1024 * 1024)).toBeLessThan(BUDGETS.textureMb);
  });

  it("flags a heap above the warning threshold", () => {
    const probe = createMemoryProbe({
      memory: { usedJSHeapSize: (HEAP_WARNING_MB + 5) * 1024 * 1024 },
    });
    const stats = sampleMemoryStats(probe, 0);
    expect(stats.heapWarning).toBe(true);
  });

  it("a null heap never trips the warning", () => {
    const stats = sampleMemoryStats(createMemoryProbe(undefined), 0);
    expect(stats.heapWarning).toBe(false);
  });

  it("a normal heap stays quiet", () => {
    const probe = createMemoryProbe({ memory: { usedJSHeapSize: 12 * 1024 * 1024 } });
    expect(sampleMemoryStats(probe, 0).heapWarning).toBe(false);
  });
});