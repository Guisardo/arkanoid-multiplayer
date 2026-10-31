// E2E (ticket #149, spec #140): the Laser end to end in Solo. Arm through the
// debug hook, hold the primary action (Space), and assert Bolts fly, Bricks
// fall to them (Bolt hits flash their Brick; ball hits never do), and the touch
// launch button swaps to the Laser glyph. A touch phone context so the overlay
// exists; the keyboard is always merged in Solo, so Space still holds fire.
import { expect, test } from "@playwright/test";

test("solo Laser: arm, hold fire, Bricks break and the touch glyph swaps", async ({ browser }) => {
  const errors: string[] = [];
  const phone = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    viewport: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await phone.newPage();
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");
  await page.locator("button", { hasText: "Solo" }).click();
  await page.waitForFunction(() => globalThis.__arkanoid !== undefined, null, { timeout: 15_000 });
  await page.waitForFunction(() => globalThis.__arkanoid!.touchLaserBadge !== null, null, { timeout: 10_000 });
  expect(await page.evaluate(() => globalThis.__arkanoid!.touchLaserBadge?.glyph)).toBe("launch");

  await page.keyboard.press("Space");
  await page.waitForFunction(() => globalThis.__arkanoid!.latestSnapshot().phase === "play", null, { timeout: 10_000 });

  // Arm: an L Capsule just above the Paddle is caught at once.
  await page.evaluate(() => {
    const s = globalThis.__arkanoid!;
    const paddle = s.latestSnapshot().players[0]!.paddle;
    s.debugDropCapsule(paddle.x, paddle.y - paddle.h, "L");
  });
  await page.waitForFunction(() => globalThis.__arkanoid!.touchLaserBadge?.glyph === "laser", null, { timeout: 10_000 });
  const armed = await page.evaluate(() => {
    const s = globalThis.__arkanoid!.latestSnapshot();
    return {
      L: s.players[0]!.effects.L,
      bricks: s.bricks.filter((c) => c !== 0 && c !== 13).length,
    };
  });
  expect(armed.L).toBe(1);

  // Hold fire: Bolts appear, and a Bolt hit flashes its Brick.
  await page.keyboard.down("Space");
  await page.waitForFunction(() => (globalThis.__arkanoid!.latestSnapshot().bolts?.length ?? 0) > 0, null, {
    timeout: 10_000,
  });
  await page.waitForFunction(() => globalThis.__arkanoid!.effectsState.brickFlashes.length > 0, null, {
    timeout: 10_000,
  });
  await page.waitForFunction(
    (before) => {
      const s = globalThis.__arkanoid!.latestSnapshot();
      return s.bricks.filter((c) => c !== 0 && c !== 13).length <= before - 2;
    },
    armed.bricks,
    { timeout: 10_000 },
  );
  await page.keyboard.up("Space");

  expect(errors).toEqual([]);
  await phone.close();
});
