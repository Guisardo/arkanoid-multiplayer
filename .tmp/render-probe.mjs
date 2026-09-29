// Throwaway probe (ticket 56 fix): duel = 2 paddles on 1 field;
// race 3 bots = 4 fields, all populated (bricks + paddle + ball).
import { chromium } from "@playwright/test";

const browser = await chromium.launch();

async function probe(variant, bots) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://localhost:5173", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    globalThis.localStorage.setItem("settings.language", "en-US");
  });
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("button", { timeout: 15000 });
  await page.locator("button", { hasText: "Versus bots" }).click();
  const screen = page.locator(".vb-root");
  await screen.waitFor({ timeout: 10000 });
  if (bots !== 1) {
    await screen.locator("div", { hasText: "Bots" }).first().locator("button", { hasText: String(bots) }).click();
  }
  await screen.locator("button", { hasText: variant }).click();
  await screen.locator("button", { hasText: "Start" }).click();
  await page.waitForFunction(() => globalThis.__arkanoidBots !== undefined, null, { timeout: 15000 });
  await page.waitForTimeout(2500);

  const m = await page.evaluate(() => {
    const s = globalThis.__arkanoidBots;
    const snaps = s.snapshots();
    return {
      fieldCount: s.fieldCount,
      snapshots: snaps.map((x) => ({
        players: x.players.length,
        paddles: x.players.map((p) => Math.round(p.paddle.x)),
        bricks: x.bricks.filter((b) => b !== 0).length,
        balls: x.balls.length,
        phase: x.phase,
      })),
    };
  });
  console.log(`\n=== ${variant} (${bots} bots) ===`);
  console.log(JSON.stringify(m, null, 2));
  console.log("errors:", errors.length === 0 ? "none" : errors.slice(0, 3));
  await page.close();
  return m;
}

await probe("Duel", 1);
await probe("Race", 3);
await browser.close();
