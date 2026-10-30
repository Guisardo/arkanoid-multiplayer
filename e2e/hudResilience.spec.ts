// E2E (ticket 100): split-screen HUD strips survive viewport resize and
// orientation changes — every field keeps its HUD text and the field count
// never collapses, from desktop width down to a landscape phone.
import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 700, height: 500 },
  { width: 780, height: 360 }, // landscape phone
  { width: 360, height: 780 }, // portrait phone
  { width: 1280, height: 720 },
];

test("versus bots: HUD strips persist across resize and rotation (1-4 fields)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");

  await page.locator("button", { hasText: "Versus bots" }).click();
  const screen = page.locator(".vb-root");
  await screen.locator("div", { hasText: "Bots" }).first().locator("button", { hasText: "3" }).click();
  await screen.locator("button", { hasText: "Start" }).click();
  await page.waitForFunction(() => globalThis.__arkanoidBots !== undefined, null, { timeout: 15_000 });

  // The HUD is drawn once the first snapshot has synced.
  await page.waitForFunction(
    () => (globalThis.__arkanoidBots?.hudLines() ?? []).every(([name]) => name !== ""),
    null,
    { timeout: 30_000, polling: 500 },
  );
  const before = await page.evaluate(() => globalThis.__arkanoidBots!.hudLines().map(([name]) => name));
  expect(before).toHaveLength(4);

  for (const size of VIEWPORTS) {
    await page.setViewportSize(size);
    // Pixi applies the resize a frame later; poll until HUD text is back.
    await page.waitForFunction(
      (names: string[]) => {
        const lines = globalThis.__arkanoidBots?.hudLines() ?? [];
        return (
          lines.length === names.length &&
          lines.every(([name, stats], i) => name === names[i] && /\d{6}/.test(stats))
        );
      },
      before,
      { timeout: 30_000, polling: 250 },
    );
    expect(await page.evaluate(() => globalThis.__arkanoidBots!.fieldCount)).toBe(4);
  }

  expect(errors).toEqual([]);
});
