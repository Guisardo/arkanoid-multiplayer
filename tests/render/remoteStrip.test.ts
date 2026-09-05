// RemoteStrip DOM tests (ticket 45 coverage): rows render per remote
// player — name + color, score, R{round}/{max}, lives vs downed flag —
// compact mode compresses to name + score; empty state shows the label.
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { RemoteStrip } from "render/remoteStrip";
import type { ProgressRow } from "app/guestGame";

function row(p: Partial<ProgressRow> & { player: number }): ProgressRow {
  return {
    name: `P${String(p.player + 1)}`,
    score: 0,
    round: 1,
    maxRound: 33,
    lives: 5,
    downed: false,
    ...p,
  };
}

describe("remote progress strip (ticket 45)", () => {
  const strips: RemoteStrip[] = [];

  afterEach(() => {
    for (const s of strips.splice(0)) s.close();
    document.body.replaceChildren();
  });

  it("empty state shows the strip label", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const strip = new RemoteStrip({ host, locale: "en-US" });
    strips.push(strip);
    strip.update([]);
    expect(strip.root.textContent).toContain("Remote players");
  });

  it("renders one row per remote player with numbers only", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const strip = new RemoteStrip({ host, locale: "en-US" });
    strips.push(strip);
    strip.update([
      row({ player: 0, name: "Alice", score: 1200, round: 12 }),
      row({ player: 2, name: "Cara", score: 300 }),
    ]);
    const rowsEl = strip.root.querySelectorAll(".rs-row");
    // Empty-state label is gone; two rows rendered.
    expect(rowsEl).toHaveLength(2);
    expect(strip.root.textContent).toContain("Alice");
    expect(strip.root.textContent).toContain("R12/33");
    expect(strip.root.textContent).toContain("×5");
  });

  it("downed players show the flag instead of lives", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const strip = new RemoteStrip({ host, locale: "en-US" });
    strips.push(strip);
    strip.update([row({ player: 1, name: "Bob", downed: true })]);
    expect(strip.root.textContent).toContain("▼");
    expect(strip.root.textContent).not.toContain("×5");
  });

  it("compact mode renders name + score only", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const strip = new RemoteStrip({ host, locale: "en-US", compact: true });
    strips.push(strip);
    strip.update([row({ player: 3, name: "Dee", score: 77, round: 9, lives: 2 })]);
    const text = strip.root.textContent ?? "";
    expect(text).toContain("Dee");
    expect(text).toContain("77");
    expect(text).not.toContain("R9/33");
    expect(text).not.toContain("×2");
  });

  it("close removes the strip from the DOM", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const strip = new RemoteStrip({ host, locale: "en-US" });
    strip.update([row({ player: 0 })]);
    strip.close();
    expect(host.querySelector(".rs-strip")).toBeNull();
  });
});
