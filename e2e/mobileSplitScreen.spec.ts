// E2E (ticket 105): mobile split-screen — a phone-class device (coarse
// pointer, mobile UA) renders one field for single-field variants and two
// side-by-side fields for a human + one bot, each with its HUD strip, and the
// layout survives a rotation without collapsing a field or throwing.
import { devices, expect, test, type Page } from "@playwright/test";

// Landscape Pixel 5: the 2-local layout plan is landscape (spec §12).
const PHONE = devices["Pixel 5 landscape"];

test.use({ ...PHONE });

async function startBots(page: Page, variant: string, bots: number | null): Promise<void> {
  await page.goto("/");
  await page.locator("button", { hasText: "Versus bots" }).click();
  const screen = page.locator(".vb-root");
  await screen.locator("button", { hasText: variant }).first().click();
  if (bots !== null) {
    await screen.locator("div", { hasText: "Bots" }).first().locator("button", { hasText: String(bots) }).click();
  }
  await screen.locator("button", { hasText: "Start" }).click();
  await page.waitForFunction(() => globalThis.__arkanoidBots !== undefined, null, { timeout: 15_000 });
  await page.waitForFunction(
    () => (globalThis.__arkanoidBots?.hudLines() ?? []).every(([name]) => name !== ""),
    null,
    { timeout: 30_000, polling: 500 },
  );
}

test("mobile: one human + one bot renders two side-by-side fields", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await startBots(page, "Race", 1);

  expect(await page.evaluate(() => globalThis.__arkanoidBots!.fieldCount)).toBe(2);
  expect(await page.evaluate(() => globalThis.__arkanoidBots!.hudLines().length)).toBe(2);
  // Landscape phone: the canvas is wider than tall, so the fields sit side by side.
  const size = await page.evaluate(() => {
    const s = globalThis.__arkanoidBots!;
    return { w: s.app.renderer.width, h: s.app.renderer.height };
  });
  expect(size.w).toBeGreaterThan(size.h);

  expect(errors).toEqual([]);
});

test("mobile: a single-field variant renders one field", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await startBots(page, "Duel", null);

  expect(await page.evaluate(() => globalThis.__arkanoidBots!.fieldCount)).toBe(1);
  expect(errors).toEqual([]);
});

test("mobile: two fields keep their HUD strips across a rotation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await startBots(page, "Race", 1);
  const names = await page.evaluate(() => globalThis.__arkanoidBots!.hudLines().map(([name]) => name));

  for (const size of [{ width: 393, height: 851 }, { width: 851, height: 393 }]) {
    await page.setViewportSize(size);
    // Pixi applies the resize a frame later; poll until HUD text is back.
    await page.waitForFunction(
      (expected: string[]) => {
        const lines = globalThis.__arkanoidBots?.hudLines() ?? [];
        return (
          lines.length === expected.length &&
          lines.every(([name, stats], i) => name === expected[i] && /\d{6}/.test(stats))
        );
      },
      names,
      { timeout: 30_000, polling: 250 },
    );
    expect(await page.evaluate(() => globalThis.__arkanoidBots!.fieldCount)).toBe(2);
  }

  expect(errors).toEqual([]);
});
