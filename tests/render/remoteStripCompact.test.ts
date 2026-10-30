// Ticket 100: RemoteStrip compacts live when the viewport shrinks.
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { RemoteStrip } from "render/remoteStrip";
import type { ProgressRow } from "app/guestGame";

function progressRow(player: number): ProgressRow {
  return { player, name: `P${String(player + 1)}`, score: 90, round: 4, maxRound: 33, lives: 2, downed: false };
}

describe("RemoteStrip.setCompact (ticket 100)", () => {
  const strips: RemoteStrip[] = [];
  afterEach(() => {
    for (const s of strips.splice(0)) s.close();
    document.body.replaceChildren();
  });

  it("switches an already-rendered strip between full and compact rows", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const strip = new RemoteStrip({ host, locale: "en-US" });
    strips.push(strip);
    strip.update([progressRow(1)]);
    expect(strip.root.textContent).toContain("R4/33");
    strip.setCompact(true);
    expect(strip.root.textContent).toContain("90");
    expect(strip.root.textContent).not.toContain("R4/33");
    strip.setCompact(false);
    expect(strip.root.textContent).toContain("R4/33");
    expect(strip.root.querySelector("canvas")).toBeNull();
  });
});
