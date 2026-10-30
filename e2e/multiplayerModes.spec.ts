// E2E (ticket 105): every competitive/coop variant boots a real match through
// the versus-bots path and renders the field layout its mode defines —
// parallel fields for Race/Attack/Parallel assist, one field for Duel and
// Shared field.
import { expect, test } from "@playwright/test";

const VARIANTS = [
  { label: "Race", fields: 3 },
  { label: "Attack", fields: 3 },
  { label: "Parallel assist", fields: 3 },
  { label: "Duel", fields: 1 },
  { label: "Shared field", fields: 1 },
] as const;

for (const variant of VARIANTS) {
  test(`versus bots: ${variant.label} boots with ${String(variant.fields)} field(s)`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await page.goto("/");
    await page.locator("button", { hasText: "Versus bots" }).click();
    const screen = page.locator(".vb-root");
    await screen.locator("button", { hasText: variant.label }).first().click();
    if (variant.fields > 1) {
      // 2 bots + the human = 3 parallel fields.
      await screen.locator("div", { hasText: "Bots" }).first().locator("button", { hasText: "2" }).click();
    }
    await screen.locator("button", { hasText: "Start" }).click();
    await page.waitForFunction(() => globalThis.__arkanoidBots !== undefined, null, { timeout: 15_000 });

    expect(await page.evaluate(() => globalThis.__arkanoidBots!.fieldCount)).toBe(variant.fields);
    // The match is live: snapshots exist and every field has a HUD.
    await page.waitForFunction(
      () => (globalThis.__arkanoidBots?.hudLines() ?? []).every(([name]) => name !== ""),
      null,
      { timeout: 30_000, polling: 500 },
    );
    expect(await page.evaluate(() => globalThis.__arkanoidBots!.snapshots().length)).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}
