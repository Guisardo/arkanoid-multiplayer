// Regression (ticket 55 prod bug): high-dpr devices overflowed the screen —
// autoDensity:false + resolution:dpr left the canvas CSS size at the
// backing-store size (logical × dpr), so every dpr>1 device rendered the
// playground 2×+ larger than the viewport. autoDensity:true keeps CSS size
// logical while the backing store stays dpr-scaled (crisp).
import { expect, test } from "@playwright/test";

test("high-dpr device: canvas CSS size stays within the viewport", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto(baseURL ?? "http://localhost:5173");
  await page.locator("button", { hasText: "Solo" }).click();
  await expect(page.locator("#app canvas")).toBeVisible();
  await page.waitForTimeout(1500); // let the ladder settle + first frames render

  const m = await page.evaluate(() => {
    const canvas = document.querySelector("#app canvas");
    if (canvas === null) return null;
    const r = canvas.getBoundingClientRect();
    return {
      cssW: r.width, cssH: r.height,
      vw: document.documentElement.clientWidth,
      vh: document.documentElement.clientHeight,
      dpr: window.devicePixelRatio,
    };
  });
  expect(m).not.toBeNull();
  expect(m.dpr).toBe(2);
  // CSS size must equal the logical viewport, not the dpr-multiplied one.
  expect(m.cssW).toBe(m.vw);
  expect(m.cssH).toBe(m.vh);
  // And the backing store stays dpr-scaled (crisp rendering preserved).
  const backing = await page.evaluate(() => {
    const canvas = document.querySelector("#app canvas");
    return canvas === null ? null : { w: canvas.width, h: canvas.height };
  });
  expect(backing).not.toBeNull();
  expect(backing.w).toBe(m.vw * 2);
  expect(backing.h).toBe(m.vh * 2);
  expect(errors).toEqual([]);
  await ctx.close();
});
