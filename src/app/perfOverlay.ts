// Dev perf overlay (ticket 54): sim/sync/render split + fps + dpr + draw
// calls + texture MB, visible behind ?perf=1. DOM-only, no Pixi — cheap
// and testable in jsdom. Not localized (developer-facing, spec §14 covers
// user-facing strings only).
import type { FrameStatsView } from "app/frameStats";

export interface PerfOverlayInputs {
  stats: FrameStatsView;
  dpr: number;
  renderEvery: number;
  drawCalls: number | null;
  textureMb: number | null;
}

export class PerfOverlay {
  readonly root: HTMLDivElement;
  private readonly lines: Record<string, HTMLDivElement> = {};

  constructor(host: HTMLElement) {
    this.root = document.createElement("div");
    this.root.dataset.perfOverlay = "";
    this.root.style.cssText =
      "position:absolute;top:0;left:0;z-index:900;font-family:monospace;" +
      "font-size:11px;line-height:1.35;color:#8f8;background:rgba(0,0,0,0.55);" +
      "padding:4px 8px;pointer-events:none;white-space:pre;";
    for (const key of ["fps", "sim", "sync", "render", "total", "dpr", "draw", "tex"]) {
      const line = document.createElement("div");
      line.dataset.line = key;
      this.lines[key] = line;
      this.root.appendChild(line);
    }
    host.appendChild(this.root);
  }

  update(inputs: PerfOverlayInputs): void {
    const { stats, dpr, renderEvery, drawCalls, textureMb } = inputs;
    const total = stats.avg.simMs + stats.avg.syncMs + stats.avg.renderMs;
    const set = (key: string, text: string): void => {
      const line = this.lines[key];
      if (line !== undefined) line.textContent = text;
    };
    set("fps", `fps ${stats.fps.toFixed(0)}${renderEvery > 1 ? " (30fps mode)" : ""}`);
    set("sim", `sim ${stats.avg.simMs.toFixed(2)}ms (≤2)${stats.overBudget.sim ? " !" : ""}`);
    set("sync", `sync ${stats.avg.syncMs.toFixed(2)}ms (≤3)${stats.overBudget.sync ? " !" : ""}`);
    set("render", `render ${stats.avg.renderMs.toFixed(2)}ms (≤5)${stats.overBudget.render ? " !" : ""}`);
    set("total", `total ${total.toFixed(2)}ms (≤10)${stats.overBudget.total ? " !" : ""}`);
    set("dpr", `dpr ${String(dpr)}`);
    set("draw", `draw ${drawCalls === null ? "?" : String(drawCalls)} (<20)`);
    set("tex", `tex ${textureMb === null ? "?" : textureMb.toFixed(1)}MB (≤64)`);
  }

  close(): void {
    this.root.remove();
  }
}

/** ?perf=1 detection (dev flag, ticket 54). */
export function perfFlagOn(href: string): boolean {
  try {
    return new URL(href).searchParams.get("perf") === "1";
  } catch {
    return false;
  }
}
