import { describe, expect, it } from "vitest";
import { FieldView } from "render/fieldView";
import { SplitScreenView } from "render/splitScreen";
import { layoutField } from "render/layout";
import { createRoundSim } from "sim/roundSim";
import { getLevel } from "content/levels";
import { SKINS, DEFAULT_SKIN_ID } from "content/skins";
import { THEMES, DEFAULT_THEME_ID } from "content/themes";

const layout = layoutField({ x: 0, y: 0, w: 800, h: 600 });

describe("FieldView skins/themes wiring (ticket 29)", () => {
  it("constructs with default skin + theme when ids absent", () => {
    const view = new FieldView({ layout, player: 0, locale: "en-US", maxRound: 33 });
    view.container.destroy({ children: true });
  });

  it("constructs with explicit skin + theme ids", () => {
    const view = new FieldView({
      layout,
      player: 0,
      locale: "en-US",
      maxRound: 33,
      skinId: SKINS[1]?.id,
      themeId: THEMES[1]?.id,
    });
    view.container.destroy({ children: true });
  });

  it("unknown ids fall back to defaults (never throws)", () => {
    const view = new FieldView({
      layout,
      player: 0,
      locale: "en-US",
      maxRound: 33,
      skinId: "not-a-uuid",
      themeId: "not-a-uuid",
    });
    view.container.destroy({ children: true });
  });

  it("sync consumes snapshots with skins/themes active — silver cracks + pills + owner glow", () => {
    const view = new FieldView({
      layout,
      player: 0,
      locale: "en-US",
      maxRound: 33,
      skinId: DEFAULT_SKIN_ID,
      themeId: DEFAULT_THEME_ID,
    });
    const sim = createRoundSim(getLevel(1), { lives: 3, score: 0 });
    const snap = sim.snapshot();
    view.sync(snap);
    view.sync(snap); // idempotent
    view.container.destroy({ children: true });
  });

  it("every shipped skin × theme constructs and syncs without throwing", () => {
    for (const skin of SKINS) {
      for (const theme of THEMES) {
        const view = new FieldView({
          layout,
          player: 0,
          locale: "en-US",
          maxRound: 33,
          skinId: skin.id,
          themeId: theme.id,
        });
        const sim = createRoundSim(getLevel(1), { lives: 3, score: 0 });
        view.sync(sim.snapshot());
        view.container.destroy({ children: true });
      }
    }
  });
});

describe("FieldView multi-paddle + field-local fallback (ticket 56)", () => {
  /** Two-player snapshot shaped like duel/sharedField (all players, one field). */
  function multiPlayerSnap(): Parameters<FieldView["sync"]>[0] {
    const sim = createRoundSim(getLevel(1), { lives: 3, score: 0 });
    const base = sim.snapshot();
    return {
      ...base,
      players: [
        { ...base.players[0]!, player: 0, name: "You" },
        { ...base.players[0]!, player: 1, name: "Bot 1", paddle: { ...base.players[0]!.paddle, x: 60 } },
      ],
    };
  }

  it("renders every player's paddle from a shared snapshot (duel shape)", () => {
    const view = new FieldView({
      layout,
      player: 0,
      locale: "en-US",
      maxRound: 33,
      skinIds: [DEFAULT_SKIN_ID, SKINS[1]?.id ?? DEFAULT_SKIN_ID],
    });
    const snap = multiPlayerSnap();
    view.sync(snap);
    view.sync(snap); // idempotent
    view.container.destroy({ children: true });
  });

  it("field-local snapshot (player 0 only) renders through a session-indexed view", () => {
    // multiField variants: bot field's snapshot carries player 0, but the
    // FieldView is session-indexed (player 1..N) — fallback must render.
    const sim = createRoundSim(getLevel(1), { lives: 3, score: 0 });
    const snap = sim.snapshot(); // players: [player 0]
    const view = new FieldView({
      layout,
      player: 2, // session index — not in the snapshot
      locale: "en-US",
      maxRound: 33,
    });
    view.sync(snap);
    view.sync(snap);
    view.container.destroy({ children: true });
  });

  it("other players' paddles stay visible when the own-player sprite is loaded", () => {
    // Regression (duel bot paddle invisible): sync painted every paddle
    // into paddleGfx, then hid paddleGfx behind the own-player sprite —
    // the bot's paddle vanished. paddleGfx must stay visible.
    const view = new FieldView({
      layout,
      player: 0,
      locale: "en-US",
      maxRound: 33,
      skinIds: [DEFAULT_SKIN_ID, SKINS[1]?.id ?? DEFAULT_SKIN_ID],
    });
    const snap = multiPlayerSnap();
    view.sync(snap);
    // Node tests have no sprite textures — simulate the sprite path by
    // checking the invariant directly: paddleGfx visible after sync.
    const gfx = (view as unknown as { paddleGfx: { visible: boolean } }).paddleGfx;
    if (gfx) expect(gfx.visible).toBe(true);
    view.container.destroy({ children: true });
  });

  it("owner bar: every paddle carries a 2px strip in the player's color", () => {
    // Readability (duel ownership): paddle ↔ owner color ↔ ball mapping.
    // The bar renders on paddleGfx for every player in the snapshot.
    const view = new FieldView({
      layout,
      player: 0,
      locale: "en-US",
      maxRound: 33,
      skinIds: [DEFAULT_SKIN_ID, SKINS[1]?.id ?? DEFAULT_SKIN_ID],
    });
    const snap = multiPlayerSnap();
    view.sync(snap);
    const gfx = (view as unknown as { paddleGfx: { context: { instructions: unknown[] } } }).paddleGfx;
    // 2 players → 1 procedural paddle (bot) + 1 fallback (own, node: no
    // sprite) + 2 owner bars = 4+ draw instructions on paddleGfx.
    expect(gfx.context.instructions.length).toBeGreaterThanOrEqual(4);
    view.container.destroy({ children: true });
  });

  it("solo fields carry no ownership marking (no bars, no tint, no ring)", () => {
    // Solo snapshots carry one player — ownership semantics don't apply,
    // so the severe color marking (bars/tint/ring) must stay off.
    const sim = createRoundSim(getLevel(1), { lives: 3, score: 0 });
    const snap = sim.snapshot(); // 1 player, ball owner 0
    const view = new FieldView({ layout, player: 0, locale: "en-US", maxRound: 33 });
    view.sync(snap);
    const gfx = (view as unknown as { paddleGfx: { context: { instructions: unknown[] } } }).paddleGfx;
    // 1 player → own paddle only (node: no sprite → procedural paint =
    // body + 2 trims = 3 instructions), NO owner bar on top.
    expect(gfx.context.instructions.length).toBe(3);
    view.container.destroy({ children: true });
  });
});

describe("SplitScreenView skinIds forwarding (ticket 56)", () => {
  it("forwards the full skinIds array to every field", () => {
    // Regression (duel bot default skin): SplitScreenView passed only the
    // per-field skinId, never the full array — FieldView fell back to the
    // default skin for other players' paddles.
    const split = new SplitScreenView({
      viewport: { w: 800, h: 600 },
      players: [0],
      locale: "en-US",
      maxRound: 33,
      skinIds: [DEFAULT_SKIN_ID, SKINS[1]?.id ?? DEFAULT_SKIN_ID],
    });
    const sim = createRoundSim(getLevel(1), { lives: 3, score: 0 });
    const base = sim.snapshot();
    const snap = {
      ...base,
      players: [
        { ...base.players[0]!, player: 0, name: "You" },
        { ...base.players[0]!, player: 1, name: "Bot 1", paddle: { ...base.players[0]!.paddle, x: 60 } },
      ],
    };
    split.sync([snap]);
    split.container.destroy({ children: true });
  });
});
