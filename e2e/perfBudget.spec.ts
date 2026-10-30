// E2E (ticket 106): measured draw calls. The numbers come from the real WebGL
// context (every draw* entry point is counted), so they are independent of
// raster speed — SwiftShader's slow frame times do not matter, only how many
// batches each rendered frame submits. Budget (spec §12): hard < 20, expected <= 10.
import { expect, test, type Page } from "@playwright/test";

const HARD_LIMIT = 20;
const SAMPLE_FRAMES = 20;

/** Count WebGL draw calls per Pixi render() while the match runs. */
async function sampleDrawCalls(page: Page, probe: "__arkanoid" | "__arkanoidBots"): Promise<number[]> {
  return page.evaluate(
    async ([key, frames]: [string, number]) => {
      const w = globalThis as unknown as Record<string, { app: { renderer: { render: (...a: unknown[]) => unknown } } }> & {
        __drawCalls?: number;
      };
      const session = w[key];
      if (session === undefined) throw new Error(`probe ${key} missing`);
      const renderer = session.app.renderer;
      const original = renderer.render.bind(renderer);
      const perFrame: number[] = [];
      renderer.render = (...args: unknown[]): unknown => {
        const before = w.__drawCalls ?? 0;
        const result = original(...args);
        perFrame.push((w.__drawCalls ?? 0) - before);
        return result;
      };
      const start = performance.now();
      while (perFrame.length < frames && performance.now() - start < 60_000) {
        await new Promise((r) => globalThis.setTimeout(r, 100));
      }
      renderer.render = original;
      return perFrame;
    },
    [probe, SAMPLE_FRAMES] as [string, number],
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = globalThis as unknown as { __drawCalls?: number };
    w.__drawCalls = 0;
    const names = ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"] as const;
    for (const ctor of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
      for (const name of names) {
        const proto = ctor.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
        const original = proto[name];
        if (typeof original !== "function") continue;
        proto[name] = function (this: unknown, ...args: unknown[]): unknown {
          w.__drawCalls = (w.__drawCalls ?? 0) + 1;
          return original.apply(this, args);
        };
      }
    }
  });
});

test("draw calls: a solo field stays under the hard limit", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");
  await page.locator("button", { hasText: "Solo" }).click();
  await page.waitForFunction(() => globalThis.__arkanoid !== undefined, null, { timeout: 15_000 });
  const frames = await sampleDrawCalls(page, "__arkanoid");
  expect(frames.length).toBeGreaterThanOrEqual(SAMPLE_FRAMES);
  const worst = Math.max(...frames);
  test.info().annotations.push({ type: "solo draw calls (max/frame)", description: String(worst) });
  expect(worst).toBeGreaterThan(0); // the counter really sees the renderer
  expect(worst).toBeLessThan(HARD_LIMIT);
  expect(errors).toEqual([]);
});

test("draw calls: four split-screen fields stay under the hard limit", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");
  await page.locator("button", { hasText: "Versus bots" }).click();
  const screen = page.locator(".vb-root");
  await screen.locator("div", { hasText: "Bots" }).first().locator("button", { hasText: "3" }).click();
  await screen.locator("button", { hasText: "Start" }).click();
  await page.waitForFunction(() => globalThis.__arkanoidBots !== undefined, null, { timeout: 15_000 });
  expect(await page.evaluate(() => globalThis.__arkanoidBots!.fieldCount)).toBe(4);
  const frames = await sampleDrawCalls(page, "__arkanoidBots");
  expect(frames.length).toBeGreaterThanOrEqual(SAMPLE_FRAMES);
  const worst = Math.max(...frames);
  test.info().annotations.push({ type: "4-field draw calls (max/frame)", description: String(worst) });
  expect(worst).toBeGreaterThan(0);
  expect(worst).toBeLessThan(HARD_LIMIT);
  expect(errors).toEqual([]);
});
