// Skin sprites end-to-end (issue #152). After the atlas switch (#114) every
// Paddle and ball silently fell back to procedural geometry: the registries
// still named old public paths, the frame cache is keyed by atlas frame name,
// and node tests cannot load an atlas. Only a real browser loads the real
// manifest, so this is the guard that the shipped art actually draws.
import { expect, test } from "@playwright/test";

test("a solo match draws the Paddle and ball from Skin sprites, with no missing frame", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  await page.goto("/");
  await page.locator("button", { hasText: "Solo" }).click();
  await page.waitForFunction(() => globalThis.__arkanoid !== undefined, null, { timeout: 15_000 });
  await page.waitForFunction(() => (globalThis.__arkanoid!.spriteProbe.field?.paddles.length ?? 0) > 0, null, {
    timeout: 10_000,
  });

  const probe = await page.evaluate(() => globalThis.__arkanoid!.spriteProbe);
  expect(probe.missingFrames).toEqual([]);
  const field = probe.field!;
  expect(field.paddles).toHaveLength(1);
  const paddle = field.paddles[0]!;
  expect(paddle.drawnFrom).toBe("sprite");
  expect(paddle.frame).toMatch(/^paddle-.*\.png$/);
  // Drawn at the Paddle's size, not the art's natural 64×28.
  expect(paddle.width).toBeCloseTo(32, 0);
  expect(paddle.height).toBeCloseTo(6, 0);
  expect(field.balls.length).toBeGreaterThan(0);
  for (const ball of field.balls) {
    expect(ball.drawnFrom).toBe("sprite");
    expect(ball.width).toBeCloseTo(6, 0);
    expect(ball.tint).toBe(0xffffff); // solo: untinted
  }
  expect(consoleErrors.filter((e) => e.includes("has no atlas frame"))).toEqual([]);
});
