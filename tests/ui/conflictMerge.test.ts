// @vitest-environment jsdom
// Cross-tab save conflict prompt (ticket 103). The classification side — when a
// conflict exists at all — lives in tests/persistence/storage.test.ts
// (classifyWrite via Storage.onConflict); this file covers the screen that
// renders the choice.
import { describe, expect, it } from "vitest";
import { ConflictMergeScreen, type ConflictChoice } from "ui/conflictMerge";
import { defaultDocument, type SaveDocument } from "persistence/saveDocument";

const META = { now: 1, deviceId: "dev-test" };

function doc(score: number, round: number, name: string): SaveDocument {
  const d = defaultDocument(META);
  d.solo.highScore = score;
  d.solo.highestRound = round;
  d.settings.name = name;
  return d;
}

function host(): HTMLElement {
  document.body.innerHTML = "";
  return document.createElement("div");
}

function mount(
  el: HTMLElement,
  local: SaveDocument,
  remote: SaveDocument,
  onChoice: (c: ConflictChoice) => void = () => undefined,
): ConflictMergeScreen {
  return new ConflictMergeScreen({
    host: el,
    locale: "en-US",
    local,
    remote,
    onChoice,
  });
}

describe("ConflictMergeScreen", () => {
  it("mounts over the app host", () => {
    const el = host();
    mount(el, doc(10, 1, "A"), doc(99, 7, "B"));
    expect(el.querySelector("[data-conflict-merge]")).not.toBeNull();
  });

  it("offers exactly this tab and the other tab, in that order", () => {
    const el = host();
    mount(el, doc(10, 1, "A"), doc(99, 7, "B"));
    const sides = [...el.querySelectorAll("[data-conflict-choice]")].map((b) =>
      b.getAttribute("data-conflict-choice"),
    );
    expect(sides).toEqual(["local", "remote"]);
    expect(el.textContent).toContain("This tab");
    expect(el.textContent).toContain("Other tab");
  });

  it("summarises each side by the fields a player would miss about a save", () => {
    // score / round / name — the same three the boot-time Continue prompt uses.
    // Summarising by anything else (raw JSON, a timestamp) would tell them less
    // at the moment they are choosing.
    const el = host();
    mount(el, doc(1234, 6, "Ana"), doc(20, 2, "Beto"));
    const local = el.querySelector("[data-conflict-summary='local']")?.textContent ?? "";
    const remote = el.querySelector("[data-conflict-summary='remote']")?.textContent ?? "";
    expect(local).toContain("1234");
    expect(local).toContain("6");
    expect(local).toContain("Ana");
    expect(remote).toContain("20");
    expect(remote).toContain("2");
    expect(remote).toContain("Beto");
  });

  it("does not mix the two documents' fields into one summary", () => {
    // The failure this guards: a summary built from the wrong document, which
    // would show a player a blend of both saves and make the choice meaningless.
    const el = host();
    mount(el, doc(1, 1, "A"), doc(2, 2, "B"));
    const local = el.querySelector("[data-conflict-summary='local']")?.textContent ?? "";
    expect(local).not.toContain("B");
  });

  it("reports which side the player picked", () => {
    const el = host();
    const seen: ConflictChoice[] = [];
    mount(el, doc(10, 1, "A"), doc(99, 7, "B"), (c) => {
      seen.push(c);
    });
    el.querySelector<HTMLButtonElement>("[data-conflict-choice='local']")?.click();
    el.querySelector<HTMLButtonElement>("[data-conflict-choice='remote']")?.click();
    expect(seen).toEqual(["local", "remote"]);
  });

  it("closes out of the DOM", () => {
    const el = host();
    const screen = mount(el, doc(10, 1, "A"), doc(99, 7, "B"));
    screen.close();
    expect(el.querySelector("[data-conflict-merge]")).toBeNull();
  });

  it("covers the host — a conflict is modal, so the game stays unreachable", () => {
    const el = host();
    mount(el, doc(10, 1, "A"), doc(99, 7, "B"));
    const css = document.getElementById("arkanoid-conflict-merge-style")?.textContent ?? "";
    expect(css).toMatch(/\.cm-root\{[^}]*position:fixed/);
    expect(css).toMatch(/\.cm-root\{[^}]*inset:0/);
    // Above the lobby overlay's z-index:1000, so it wins any stack contest.
    expect(css).toMatch(/\.cm-root\{[^}]*z-index:1001/);
  });

  it("buttons meet the ≥48px touch-target floor", () => {
    const el = host();
    mount(el, doc(10, 1, "A"), doc(99, 7, "B"));
    const css = document.getElementById("arkanoid-conflict-merge-style")?.textContent ?? "";
    expect(css).toMatch(/\.cm-choice\{[^}]*min-height:48px/);
    expect(css).toMatch(/\.cm-choice\{[^}]*min-width:\d+px/);
    // 120px is deliberately wider than the floor: the label and summary stack
    // inside the button, and a 48px-wide box would clip the score line.
    expect(css).toMatch(/\.cm-choice\{[^}]*min-width:120px/);
  });

  it("injects its stylesheet once, however many screens are built", () => {
    document.head.querySelectorAll("#arkanoid-conflict-merge-style").forEach((s) => {
      s.remove();
    });
    const a = host();
    const b = host();
    mount(a, doc(10, 1, "A"), doc(99, 7, "B"));
    mount(b, doc(10, 1, "A"), doc(99, 7, "B"));
    expect(document.querySelectorAll("#arkanoid-conflict-merge-style")).toHaveLength(1);
  });

  it("localizes to the active locale", () => {
    const en = host();
    new ConflictMergeScreen({
      host: en,
      locale: "en-US",
      local: doc(10, 1, "A"),
      remote: doc(99, 7, "B"),
      onChoice: () => undefined,
    });
    const es = host();
    new ConflictMergeScreen({
      host: es,
      locale: "es-419",
      local: doc(10, 1, "A"),
      remote: doc(99, 7, "B"),
      onChoice: () => undefined,
    });
    expect(en.textContent).toContain("Save changed in another tab");
    expect(es.textContent).toContain("El guardado cambió en otra pestaña");
  });
});

describe("ConflictMergeScreen — full detail of both versions (ticket 103)", () => {
  function detail(el: HTMLElement, side: "local" | "remote"): string {
    return el.querySelector(`[data-conflict-detail='${side}']`)?.textContent ?? "";
  }

  it("shows when each version was saved", () => {
    const el = host();
    const local = doc(1, 1, "A");
    local.updatedAt = Date.UTC(2026, 9, 30, 12, 0, 0);
    const remote = doc(2, 2, "B");
    remote.updatedAt = Date.UTC(2026, 9, 30, 13, 30, 0);
    mount(el, local, remote);
    expect(detail(el, "local")).toContain(new Date(local.updatedAt).toLocaleString("en-US"));
    expect(detail(el, "remote")).toContain(new Date(remote.updatedAt).toLocaleString("en-US"));
  });

  it("shows the run in progress for the side that has one, and says so for the side that has none", () => {
    const el = host();
    const local = doc(1, 1, "A");
    local.soloEpisode = { round: 7, score: 4200, lives: 2, phase: "playing", timestamp: 5 };
    const remote = doc(1, 1, "A");
    mount(el, local, remote);
    expect(detail(el, "local")).toContain("Round 7");
    expect(detail(el, "local")).toContain("4200");
    expect(detail(el, "remote")).toContain("No run in progress");
  });

  it("does not offer a finished run as one in progress", () => {
    const el = host();
    const local = doc(1, 1, "A");
    local.soloEpisode = { round: 9, score: 10, lives: 0, phase: "gameOver", timestamp: 5 };
    mount(el, local, doc(1, 1, "A"));
    expect(detail(el, "local")).toContain("No run in progress");
  });

  it("names the settings that differ between the two versions", () => {
    const el = host();
    const local = doc(1, 1, "A");
    local.settings.audio = { music: 0.1, sfx: 0.8, mute: false };
    local.settings.language = "es-419";
    mount(el, local, doc(1, 1, "A"));
    for (const side of ["local", "remote"] as const) {
      expect(detail(el, side)).toContain("audio");
      expect(detail(el, side)).toContain("language");
      expect(detail(el, side)).not.toContain("theme");
    }
  });

  it("says the settings match when only progress differs", () => {
    const el = host();
    mount(el, doc(10, 1, "A"), doc(99, 7, "A"));
    expect(detail(el, "local")).toContain("Same settings");
  });

  it("renders the detail in the requested locale", () => {
    const el = host();
    new ConflictMergeScreen({
      host: el,
      locale: "es-419",
      local: doc(1, 1, "A"),
      remote: doc(1, 1, "A"),
      onChoice: () => undefined,
    });
    expect(detail(el, "local")).toContain("Sin partida en curso");
  });

  it("keeps the choice buttons working with the extra detail present", () => {
    const el = host();
    const picks: ConflictChoice[] = [];
    mount(el, doc(1, 1, "A"), doc(2, 2, "B"), (c) => picks.push(c));
    (el.querySelector("[data-conflict-choice='remote']") as HTMLButtonElement).click();
    expect(picks).toEqual(["remote"]);
  });
});
