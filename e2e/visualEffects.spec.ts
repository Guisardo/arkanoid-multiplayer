// Visual effects end-to-end (ADR 0009, ticket #91).
//
// The Vitest suite covers the orchestrator headlessly; this spec closes the
// remaining gap: that the *real browser* path — assets loaded, ParticleContainer
// backed by a real atlas texture, sprites sized from live snapshots — actually
// produces visible feedback. That cannot be proven in node, where the particle
// pool no-ops without a DOM.
import { expect, test, type Page } from "@playwright/test";
import type { SimEventType } from "shared/protocol";

/** Boot the solo session and return once the field is live. */
async function bootSolo(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/");
  await page.locator("button", { hasText: "Solo" }).click();
  await page.waitForFunction(() => globalThis.__arkanoid !== undefined, null, { timeout: 15_000 });
  // Serve → play, so a ball exists for the ball-anchored recipes.
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  return errors;
}

test("each juice event produces measurable feedback in the browser", async ({ page }) => {
  const errors = await bootSolo(page);

  // Fire one event per recipe and read the resulting state. `debugFireEvent`
  // goes through the same onSimEvent path a real snapshot event takes.
  const events = [
    "paddleBounce",
    "brickBreak",
    "brickSilverHit",
    "capsuleCatch",
    "ballLoss",
    "roundClear",
    "bossHit",
    "bossDead",
    "attack",
    "assist",
    "ballLaunch",
    "gameOver",
  ] as const;

  for (const type of events) {
    const st = await page.evaluate((t: SimEventType) => {
      const s = globalThis.__arkanoid!;
      s.debugFireEvent(t, 0, 15);
      const e = s.effectsState;
      return {
        trauma: e.trauma,
        flash: e.flashAlpha,
        hitStop: e.hitStopFrames,
        ballX: e.ballScale.x,
        paddleX: e.paddleScale.x,
        pops: e.pops.length,
      };
    }, type);
    const anyFeedback =
      st.trauma > 0 || st.flash > 0 || st.hitStop > 0 || st.ballX !== 1 || st.paddleX !== 1 || st.pops > 0;
    expect(anyFeedback, `${type} produced no feedback`).toBe(true);
  }

  expect(errors).toEqual([]);
});

test("the particle pool is live and prewarmed per field", async ({ page }) => {
  const errors = await bootSolo(page);

  // ADR 0009: ~200 particles per field, prewarmed so bursts never allocate.
  // Free + in-flight is the constant — the play loop may already have emitted
  // some brick-break debris, so the free count alone is not the invariant.
  const idle = await page.evaluate(() => {
    const s = globalThis.__arkanoid!.effectsState;
    return { total: s.particlePool + s.particles, live: s.particles };
  });
  expect(idle.total).toBe(200);

  const burst = await page.evaluate(() => {
    globalThis.__arkanoid!.debugFireEvent("roundClear", 0, -1);
    const s = globalThis.__arkanoid!.effectsState;
    return { live: s.particles, free: s.particlePool };
  });
  // A roundClear burst is the biggest preset (40 particles), and it must come
  // out of the pool rather than growing the total.
  expect(burst.live).toBeGreaterThan(idle.live);
  expect(burst.free + burst.live).toBe(200);

  // And the pool drains back — effects must expire, not accumulate.
  await expect
    .poll(async () => (await page.evaluate(() => globalThis.__arkanoid!.effectsState.particles)), {
      timeout: 20_000,
    })
    .toBe(0);

  expect(errors).toEqual([]);
});

test("effects expire on their own and leave nothing behind", async ({ page }) => {
  const errors = await bootSolo(page);

  // Fire and sample inside ONE evaluate. debugFireEvent and the effectsState
  // getter are both synchronous and rAF cannot interleave a single task, so this
  // is the true peak. Reading the state in a second evaluate raced the play loop:
  // trauma, flash and squash all begin decaying on the very next frame, so the
  // sample depended on how long the round-trip took. `effectsState` builds a
  // fresh object per read, so the captured peak cannot mutate under us.
  const peak = await page.evaluate(() => {
    globalThis.__arkanoid!.debugFireEvent("bossDead", 0, -1);
    return globalThis.__arkanoid!.effectsState;
  });
  // bossDead is a field-centre detonation: trauma, a long freeze, the ring
  // burst, the flash and the reward label.
  expect(peak.trauma).toBeGreaterThan(0);
  expect(peak.hitStopFrames).toBeGreaterThan(0);
  expect(peak.pops).toContain("BOSS CLEAR");
  expect(peak.flashAlpha).toBeGreaterThan(0);

  // Poll the specific channel this event owns. A live round keeps firing
  // brickBreak, so asserting "trauma === 0" would race the gameplay; asserting
  // that *this* event's label is gone cannot.
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => globalThis.__arkanoid!.effectsState)).pops.includes("BOSS CLEAR"),
      { timeout: 20_000 },
    )
    .toBe(false);

  // Squash is asserted against bossHit, the recipe that actually carries a
  // ballSquash. bossDead owns none, so asserting it here sampled whatever
  // ambient paddle bounce happened to be in flight — which is why this
  // assertion flaked toward a neutral 1.
  const squashed = await page.evaluate(() => {
    globalThis.__arkanoid!.debugFireEvent("bossHit", 0, -1);
    return globalThis.__arkanoid!.effectsState.ballScale.x;
  });
  expect(squashed).not.toBeCloseTo(1, 3);

  // And that squash eases back to exactly neutral on its own.
  await expect
    .poll(async () => (await page.evaluate(() => globalThis.__arkanoid!.effectsState)).ballScale.x, {
      timeout: 20_000,
    })
    .toBeCloseTo(1, 3);

  expect(errors).toEqual([]);
});

test("reduced effects drops the decorative channels but keeps readability", async ({ page }) => {
  const errors = await bootSolo(page);

  // Toggle reduced effects through the real settings UI — the same path a
  // player takes, including the live re-apply into the running session.
  await page.keyboard.press("Escape");
  const pauseMenu = page.locator("[data-pause-menu]");
  await expect(pauseMenu).toBeVisible({ timeout: 5_000 });
  await pauseMenu.locator("button", { hasText: "Settings" }).click();
  const overlay = page.locator("div", { hasText: "Settings" }).first();
  await expect(overlay).toBeVisible({ timeout: 5_000 });

  // Pick the checkbox by its label — the Audio section's mute toggle is also a
  // checkbox and comes first in the DOM.
  const toggle = overlay.locator("label", { hasText: /reduced|efectos|reduced effects/i }).locator('input[type="checkbox"]');
  await expect(toggle).toHaveCount(1);
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  // Closing the overlay re-applies display settings live (ticket 54 path).
  await overlay.locator("button", { hasText: "Back" }).first().click();
  await expect(pauseMenu).toBeVisible({ timeout: 5_000 });
  await pauseMenu.locator("button", { hasText: "Resume" }).click();
  await page.waitForTimeout(150);

  const st = await page.evaluate(() => {
    globalThis.__arkanoid!.debugFireEvent("roundClear", 0, -1);
    return globalThis.__arkanoid!.effectsState;
  });
  expect(st.reducedEffects).toBe(true);
  // Decorative channels are off...
  expect(st.trauma).toBe(0);
  expect(st.flashAlpha).toBe(0);
  expect(st.particles).toBe(0);
  // ...but the reward label survives — it is information, not decoration.
  expect(st.pops).toContain("CLEAR");

  expect(errors).toEqual([]);
});
