// Shared e2e steps for the copy-paste connect fallback (spec §9): abort the
// signaling WS so the fallback engages at once, then carry the offer and
// answer codes between two pages through the UI, as a human would.
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Close every room WS so the copy-paste fallback engages immediately (the dev
 * server would otherwise accept the upgrade and stall the relay handshake).
 * `onUrl` sees each room WS URL, which carries the room code.
 */
export async function abortSignaling(page: Page, onUrl?: (url: string) => void): Promise<void> {
  await page.routeWebSocket(/\/room\/.+\/ws/, (ws) => {
    onUrl?.(ws.url());
    void ws.close();
  });
}

/** Host: landing → Multiplayer → Create room. Returns the room code shown. */
export async function createRoom(hostPage: Page): Promise<string> {
  await hostPage.goto("/");
  await hostPage.locator("button", { hasText: "Multiplayer" }).click();
  await hostPage.locator("button", { hasText: "Create room" }).click();
  const roomCode = (await hostPage.locator(".ld-code").textContent()) ?? "";
  expect(roomCode).toBeTruthy();
  return roomCode;
}

/** Host: Continue from the create screen; returns the copy-paste screen and its offer code. */
export async function hostOffer(hostPage: Page): Promise<{ hostCp: Locator; offerCode: string }> {
  await hostPage.locator("button", { hasText: "Continue" }).first().click();
  const hostCp = hostPage.locator(".cp-root");
  await expect(hostCp).toBeVisible({ timeout: 15_000 });
  const offerCode = (await hostCp.locator("[data-copy-code]").textContent()) ?? "";
  expect(offerCode).toBeTruthy();
  return { hostCp, offerCode };
}

/**
 * Guest (already past Join) pastes the offer, then the host pastes the answer
 * back. Ends with both pages connected and heading for the lobby.
 */
export async function exchangeCodes(guestPage: Page, hostCp: Locator, offerCode: string): Promise<void> {
  const guestCp = guestPage.locator(".cp-root");
  await expect(guestCp).toBeVisible({ timeout: 15_000 });
  await guestCp.locator("[data-copy-paste-input]").fill(offerCode);
  await guestCp.locator("[data-copy-submit]").click();

  // The screen mounts with an empty answer first; connectViaCopyPasteGuest
  // (decode + ICE, up to 5 s) re-renders it with the real code — poll for
  // the non-empty value instead of racing the replacement.
  await expect
    .poll(async () => (await guestCp.locator("[data-copy-code]").textContent()) ?? "", {
      timeout: 15_000,
    })
    .toBeTruthy();
  const answerCode = (await guestCp.locator("[data-copy-code]").textContent()) ?? "";
  await hostCp.locator("[data-copy-paste-input]").fill(answerCode);
  await hostCp.locator("[data-copy-submit]").click();
}

/** The lobby screen (scoped: reconnect/throttle/fatal overlays reuse `.ld-root`). */
export function lobbyOf(page: Page): Locator {
  return page.locator('[data-screen="lobby"]', { hasText: "Lobby" });
}
