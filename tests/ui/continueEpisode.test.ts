// @vitest-environment jsdom
// Boot-time episode resume prompt (ticket 89): a crash or a closed tab is
// offered back before the landing screen. The persist/restore side lives in
// tests/app/soloEpisodeResume.test.ts.
import { describe, expect, it } from "vitest";
import { ContinueEpisodeScreen, type ContinueEpisodeChoice } from "ui/continueEpisode";
import { isContinuableEpisode, type EpisodeState } from "persistence/saveDocument";

function record(round: number, score: number, phase: EpisodeState["phase"] = "playing"): EpisodeState {
  return { round, score, lives: 3, phase, timestamp: 1 };
}

function host(): HTMLElement {
  document.body.innerHTML = "";
  return document.createElement("div");
}

describe("ContinueEpisodeScreen", () => {
  it("mounts over the app host", () => {
    const el = host();
    new ContinueEpisodeScreen({
      host: el,
      locale: "en-US",
      episode: record(2, 10),
      onChoice: () => undefined,
    });
    expect(el.querySelector("[data-continue-episode]")).not.toBeNull();
  });

  it("shows the round and the score it would resume at", () => {
    const el = host();
    new ContinueEpisodeScreen({
      host: el,
      locale: "en-US",
      episode: record(6, 1234),
      onChoice: () => undefined,
    });
    const summary = el.querySelector("[data-continue-summary]")?.textContent ?? "";
    expect(summary).toContain("6");
    expect(summary).toContain("1234");
  });

  it("states the Continue cost up front — no surprise penalty", () => {
    const el = host();
    new ContinueEpisodeScreen({
      host: el,
      locale: "en-US",
      episode: record(2, 10),
      onChoice: () => undefined,
    });
    expect(el.textContent).toContain("3 lives");
  });

  it("offers exactly Continue and Restart", () => {
    const el = host();
    new ContinueEpisodeScreen({
      host: el,
      locale: "en-US",
      episode: record(2, 10),
      onChoice: () => undefined,
    });
    const choices = [...el.querySelectorAll("[data-continue-choice]")].map((b) =>
      b.getAttribute("data-continue-choice"),
    );
    expect(choices).toEqual(["continue", "restart"]);
  });

  it("reports the choice the player made", () => {
    const el = host();
    const seen: ContinueEpisodeChoice[] = [];
    new ContinueEpisodeScreen({
      host: el,
      locale: "en-US",
      episode: record(2, 10),
      onChoice: (c) => {
        seen.push(c);
      },
    });
    el.querySelector<HTMLButtonElement>("[data-continue-choice='continue']")?.click();
    el.querySelector<HTMLButtonElement>("[data-continue-choice='restart']")?.click();
    expect(seen).toEqual(["continue", "restart"]);
  });

  it("buttons meet the ≥48px touch-target floor", () => {
    const el = host();
    new ContinueEpisodeScreen({
      host: el,
      locale: "en-US",
      episode: record(2, 10),
      onChoice: () => undefined,
    });
    const css = document.getElementById("arkanoid-continue-episode-style")?.textContent ?? "";
    expect(css).toMatch(/\.ce-btn\{[^}]*min-height:48px/);
    expect(css).toMatch(/\.ce-btn\{[^}]*min-width:48px/);
    expect(el.querySelectorAll("[data-continue-choice]")).toHaveLength(2);
  });

  it("closes out of the DOM", () => {
    const el = host();
    const screen = new ContinueEpisodeScreen({
      host: el,
      locale: "en-US",
      episode: record(2, 10),
      onChoice: () => undefined,
    });
    screen.close();
    expect(el.querySelector("[data-continue-episode]")).toBeNull();
  });

  it("localizes to the active locale", () => {
    const en = host();
    new ContinueEpisodeScreen({ host: en, locale: "en-US", episode: record(2, 10), onChoice: () => undefined });
    const es = host();
    new ContinueEpisodeScreen({ host: es, locale: "es-419", episode: record(2, 10), onChoice: () => undefined });
    expect(en.textContent).toContain("Episode in progress");
    expect(es.textContent).toContain("Episodio en curso");
  });

  it("only ever renders for a resumable record (the boot guard)", () => {
    // The prompt is a pure renderer; the decision lives in isContinuableEpisode,
    // which the boot path checks before constructing it.
    expect(isContinuableEpisode(record(3, 10))).toBe(true);
    expect(isContinuableEpisode(record(3, 10, "gameOver"))).toBe(false);
  });
});
