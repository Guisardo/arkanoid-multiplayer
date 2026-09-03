import { describe, it } from "vitest";
import { FieldView } from "render/fieldView";
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
