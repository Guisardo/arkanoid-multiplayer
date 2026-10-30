// Ticket 99: the whole Settings screen is operable from a gamepad — d-pad
// moves focus (with a visible indicator), A activates, a rebind needs the new
// button pressed twice to confirm, B backs out. The pad is stubbed through
// navigator.getGamepads, so this exercises the real polling, DOM and storage
// path but not real hardware.
import { expect, test, type Page } from "@playwright/test";

const A = 0;
const B = 1;
const LT = 6;
const DPAD_DOWN = 13;
const POLL_MS = 50;

declare global {
  interface Window {
    __pad: { pressed: number[] };
  }
}

async function installPad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__pad = { pressed: [] };
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [
        {
          connected: true,
          axes: [0, 0],
          buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: window.__pad.pressed.includes(i) })),
        },
      ],
    });
  });
}

/** Hold the buttons for a couple of polls, release for a couple more. */
async function tap(page: Page, ...buttons: number[]): Promise<void> {
  await page.evaluate((b) => {
    window.__pad.pressed = b;
  }, buttons);
  await page.waitForTimeout(POLL_MS * 3);
  await page.evaluate(() => {
    window.__pad.pressed = [];
  });
  await page.waitForTimeout(POLL_MS * 3);
}

/** D-pad down until the focused element satisfies `match`; fails if never reached. */
async function padDownUntil(page: Page, match: (el: Element | null) => boolean, maxSteps = 30): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    const hit = await page.evaluate(`(${match.toString()})(document.activeElement)`);
    if (hit) return;
    await tap(page, DPAD_DOWN);
  }
  throw new Error(`gamepadNav.spec: focus never reached target in ${maxSteps} d-pad steps`);
}

test("gamepad: landing → Settings → Gamepad tab → rebind with confirm → B closes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await installPad(page);
  await page.goto("/");
  await expect(page.locator("[data-screen='landing']")).toBeVisible({ timeout: 15_000 });
  await tap(page); // baseline: pad seen with nothing pressed

  // Landing: d-pad to Settings, A opens it.
  await padDownUntil(page, (el) => el?.textContent === "Settings");
  await expect(page.locator(".gp-focus")).toHaveCount(1);
  await tap(page, A);
  const settings = page.locator("div", { has: page.locator("h2", { hasText: "Settings" }) }).last();
  await expect(settings.locator("h2", { hasText: "Settings" })).toBeVisible({ timeout: 5_000 });

  // Gamepad tab via the pad.
  await padDownUntil(page, (el) => (el as HTMLElement | null)?.dataset?.deviceTab === "gamepad");
  await tap(page, A);
  await expect(page.locator("[data-movement-fixed]")).toBeVisible();

  // Rebind Launch: select row → press LT → press LT again to confirm.
  await padDownUntil(page, (el) => (el as HTMLElement | null)?.dataset?.action === "launch");
  await tap(page, A);
  const launch = page.locator("button[data-action='launch']");
  await expect(launch).toHaveClass(/capturing/);
  await tap(page, LT);
  await expect(launch).toContainText("lt"); // proposed, awaiting confirmation
  await tap(page, LT);
  await expect(page.locator("button[data-action='launch']")).toHaveText("lt");

  // B backs out of Settings to the landing screen.
  await tap(page, B);
  await expect(page.locator("[data-screen='landing']")).toBeVisible({ timeout: 5_000 });
  expect(errors).toEqual([]);
});
