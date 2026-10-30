// E2E (ticket 105): the perf ladder in a real browser — forcing each rung
// changes the backing-store resolution and render cadence, the degraded rung
// shows the explicit banner, and the sim rate never changes (spec §12).
import { expect, test } from "@playwright/test";

test("perf ladder: rungs change resolution and cadence, degraded rung is announced", async ({ browser }) => {
  const errors: string[] = [];
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");
  await page.locator("button", { hasText: "Solo" }).click();
  await page.waitForFunction(() => globalThis.__arkanoid !== undefined, null, { timeout: 15_000 });

  const probe = (): Promise<{ rung: number; resolution: number; degradedBanner: boolean }> =>
    page.evaluate(() => {
      const s = globalThis.__arkanoid!;
      return {
        rung: s.perfRung,
        resolution: s.app.renderer.resolution,
        degradedBanner: document.querySelector("[data-perf-degraded]") !== null,
      };
    });

  // Rung ladder (spec §12): dpr 2 → 1.5 → 1 → degraded (dpr 1, 30 fps).
  const seen: number[] = [];
  for (const rung of [0, 1, 2]) {
    await page.evaluate((r) => { globalThis.__arkanoid!.setPerfRung(r); }, rung);
    const state = await probe();
    expect(state.rung).toBe(rung);
    expect(state.degradedBanner).toBe(false);
    seen.push(state.resolution);
  }
  expect(seen).toEqual([2, 1.5, 1]);

  await page.evaluate(() => { globalThis.__arkanoid!.setPerfRung(3); });
  const degraded = await probe();
  expect(degraded.rung).toBe(3);
  expect(degraded.resolution).toBe(1);
  expect(degraded.degradedBanner).toBe(true);

  // Sim rate invariant: ticks keep advancing at the fixed 60 Hz cadence on
  // the degraded rung (render is halved, the sim is not).
  const t0 = await page.evaluate(() => globalThis.__arkanoid!.latestSnapshot().tick);
  await page.waitForTimeout(1000);
  const t1 = await page.evaluate(() => globalThis.__arkanoid!.latestSnapshot().tick);
  expect(t1 - t0).toBeGreaterThan(20); // SwiftShader is slow; far above a halved-sim floor of 0

  // Recovery: back on the top rung the banner clears.
  await page.evaluate(() => { globalThis.__arkanoid!.setPerfRung(0); });
  expect((await probe()).degradedBanner).toBe(false);

  expect(errors).toEqual([]);
  await ctx.close();
});
