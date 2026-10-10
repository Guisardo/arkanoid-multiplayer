// Memory telemetry (ticket 102, spec §12): JS heap + texture memory for the
// dev perf overlay. Pure and DOM-free — the caller feeds in a heap reading and
// a texture byte estimate, and the overlay renders the result. The GPU-side
// texture number stays an estimate (the shipped set is static, so it is exact
// for it) and the real device number stays manual
// (docs/perf-validation.md).
import { BUDGETS, estimateTextureBytes } from "app/frameStats";
import { FIELD_H, FIELD_W } from "shared/gridConstants";

/** Heap size above which the overlay warns (MB). Not a budget — a smell. */
export const HEAP_WARNING_MB = 200;

/**
 * The subset of `performance.memory` Chromium exposes. Firefox and Safari
 * have never shipped it, so every read has to survive its absence — telemetry
 * that throws is worse than no telemetry.
 */
export interface HeapMemoryInfo {
  usedJSHeapSize?: number;
}

/** A live source of heap readings. Injected so tests need no global patching. */
export interface MemoryProbe {
  /** Used JS heap in MB, or null where the browser does not expose it. */
  readonly heapUsedMb: number | null;
}

/**
 * The `performance` global as the probe needs it. Mirrors the real global's
 * shape (`performance.memory`) so a fake is a drop-in for it.
 */
export interface PerformanceWithMemory {
  memory?: HeapMemoryInfo;
}

/** One telemetry sample. Nulls mean "not measurable here", never zero. */
export interface MemoryStats {
  /** Used JS heap in MB, or null when the browser does not expose it. */
  readonly heapUsedMb: number | null;
  /** Estimated texture memory in MB. */
  readonly textureMb: number;
  /** True when the texture estimate exceeds the 64 MB ceiling (spec §12). */
  readonly textureOverBudget: boolean;
  /** True when the heap is above HEAP_WARNING_MB. False when unknown. */
  readonly heapWarning: boolean;
}

/**
 * Build a probe over an optional `performance`-shaped source. Pass nothing and
 * it reads the global; pass a fake and it reads that.
 */
export function createMemoryProbe(source?: PerformanceWithMemory | undefined): MemoryProbe {
  return {
    get heapUsedMb(): number | null {
      const memory = (source ?? globalPerformance())?.memory;
      const used = memory?.usedJSHeapSize;
      // A non-numeric or negative reading is a broken browser build, not a
      // measurement — report "unknown" rather than NaN into the overlay.
      if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return null;
      return used / (1024 * 1024);
    },
  };
}

/** The global `performance`, or undefined where it does not exist. */
function globalPerformance(): PerformanceWithMemory | undefined {
  return globalThis.performance as (Performance & { memory?: HeapMemoryInfo }) | undefined;
}

/**
 * One telemetry sample. `textureBytes` is the RGBA8 estimate over the live
 * texture set (see frameStats.estimateTextureBytes).
 */
export function sampleMemoryStats(probe: MemoryProbe, textureBytes: number): MemoryStats {
  const heapUsedMb = probe.heapUsedMb;
  return {
    heapUsedMb,
    textureMb: textureBytes / (1024 * 1024),
    textureOverBudget: !withinTextureCeiling(textureBytes),
    heapWarning: heapUsedMb !== null && heapUsedMb > HEAP_WARNING_MB,
  };
}

/** Texture-ceiling verdict for a byte estimate (spec §12: 64 MB). */
export function withinTextureCeiling(bytes: number): boolean {
  return bytes <= BUDGETS.textureMb * 1024 * 1024;
}

/**
 * RGBA8 bytes for `fieldCount` cached brick-wall textures (ADR 0005), each
 * covering one field recorded at `textureResolution`. This is the term ticket
 * 102 actually scales — the shipped sprite set next to it is ~0.1 MB and
 * static, so the cached walls are what a texture-leak or downscale shows up
 * in.
 */
export function cachedWallBytes(fieldCount: number, textureResolution: number): number {
  if (fieldCount <= 0) return 0;
  const resolution = textureResolution > 0 ? textureResolution : 1;
  return estimateTextureBytes(
    Array.from({ length: fieldCount }, () => ({
      w: Math.round(FIELD_W * resolution),
      h: Math.round(FIELD_H * resolution),
    })),
  );
}