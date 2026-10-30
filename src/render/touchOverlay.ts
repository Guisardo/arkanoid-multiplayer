// Touch overlay rendering (ticket 42, spec §11/§12): virtual stick +
// context cluster floating over the player's own field region, bottom
// corners. Semi-transparent, faint-visible always, brighten on active
// touch. Buttons ≥48 px. Pause icon top corner, out of the drag zone.
// Consumes adapter state only — never sim internals.
import { Container, Graphics } from "pixi.js";
import {
  BUTTON_MIN_PX,
  STICK_BASE_RADIUS,
  clusterButtons,
  type TouchAdapter,
  type TouchButtonId,
  type TouchClusterMode,
  type TouchLayout,
} from "input/touch";

/** Spec §11 feedback: faint at rest, brighter while touched. */
export const TOUCH_IDLE_ALPHA = 0.25;
export const TOUCH_ACTIVE_ALPHA = 0.6;
const IDLE_ALPHA = TOUCH_IDLE_ALPHA;
const ACTIVE_ALPHA = TOUCH_ACTIVE_ALPHA;
/** Clear space between a control and the region edge / its neighbour. */
const EDGE_PX = 12;
const GAP_PX = 10;
const STICK_COLOR = 0xd0d0d8;
const KNOB_COLOR = 0xffffff;
const BUTTON_COLOR = 0x8890a8;
const BUTTON_ACTIVE_COLOR = 0xbad0ff;
const PAUSE_COLOR = 0xd0d0d8;

/**
 * Overlay-local layout for a region: stick bottom-left, cluster bottom-right,
 * pause top-right. Every control stays fully inside the region; a cluster too
 * tall for the region (landscape phones, 2-local halves) wraps into a second
 * column to the left instead of running into the pause icon.
 */
export function overlayLayout(
  region: { x: number; y: number; w: number; h: number },
  mode: TouchClusterMode,
): TouchLayout {
  const buttonRadius = Math.max(BUTTON_MIN_PX / 2, 24);
  const margin = buttonRadius + EDGE_PX;
  const buttons: TouchLayout["buttons"] = {};
  const ids = clusterButtons(mode);
  const step = buttonRadius * 2 + GAP_PX;
  // Rows that fit between the bottom edge and the slot just below the pause icon.
  const bottomY = region.h - margin;
  const topY = margin + step;
  const rows = Math.max(1, Math.floor((bottomY - topY) / step) + 1);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id) continue;
    buttons[id] = {
      x: region.w - margin - Math.floor(i / rows) * step,
      y: bottomY - (i % rows) * step,
    };
  }
  // Pause icon: top-right corner of the region, out of the drag zone.
  buttons.pause = { x: region.w - margin, y: margin };
  const stickInset = STICK_BASE_RADIUS + EDGE_PX;
  return {
    stick: { x: stickInset, y: region.h - stickInset },
    buttons,
    buttonRadius,
  };
}

export class TouchOverlay {
  readonly container = new Container();
  private readonly gfx = new Graphics();
  private readonly adapter: TouchAdapter;
  private readonly region: { x: number; y: number; w: number; h: number };
  private mode: TouchClusterMode;

  constructor(
    adapter: TouchAdapter,
    region: { x: number; y: number; w: number; h: number },
    mode: TouchClusterMode,
  ) {
    this.adapter = adapter;
    this.region = region;
    this.mode = mode;
    this.container.addChild(this.gfx);
    this.container.position.set(region.x, region.y);
    this.container.eventMode = "none"; // app routes pointer events to the adapter
    // Arm the adapter with the layout we draw: its constructor layout is a
    // placeholder, so without this the drawn buttons are not tappable.
    this.adapter.setMode(mode);
    this.adapter.setLayout(overlayLayout(region, mode));
    this.redraw();
  }

  /** Mode transition (solo → attack/assist cluster). */
  setMode(mode: TouchClusterMode): void {
    this.mode = mode;
    this.adapter.setMode(mode);
    // The new cluster has different buttons: re-arm their hit areas.
    this.adapter.setLayout(overlayLayout(this.region, mode));
    this.redraw();
  }

  /** Region moved/resized (orientation change, relayout). */
  setRegion(region: { x: number; y: number; w: number; h: number }): void {
    this.region.x = region.x;
    this.region.y = region.y;
    this.region.w = region.w;
    this.region.h = region.h;
    this.container.position.set(region.x, region.y);
    this.adapter.setLayout(overlayLayout(region, this.mode));
    this.redraw();
  }

  /** Redraw from adapter state (call once per rendered frame). */
  redraw(): void {
    const g = this.gfx;
    g.clear();
    const layout = overlayLayout(this.region, this.mode);

    // Stick base + knob (knob offset by live axis).
    g.circle(layout.stick.x, layout.stick.y, STICK_BASE_RADIUS)
      .fill({ color: STICK_COLOR, alpha: IDLE_ALPHA })
      .stroke({ width: 2, color: STICK_COLOR, alpha: IDLE_ALPHA + 0.15 });
    const axis = this.adapter.stickAxis();
    const knobX = layout.stick.x + axis.x * STICK_BASE_RADIUS * 0.7;
    const knobY = layout.stick.y + axis.y * STICK_BASE_RADIUS * 0.7;
    g.circle(knobX, knobY, STICK_BASE_RADIUS * 0.4)
      .fill({ color: KNOB_COLOR, alpha: ACTIVE_ALPHA });

    // Context cluster buttons.
    const held = new Set<TouchButtonId>(this.adapter.heldButtons());
    for (const id of clusterButtons(this.mode)) {
      const c = layout.buttons[id];
      if (!c) continue;
      const active = held.has(id);
      g.circle(c.x, c.y, layout.buttonRadius)
        .fill({ color: active ? BUTTON_ACTIVE_COLOR : BUTTON_COLOR, alpha: active ? ACTIVE_ALPHA : IDLE_ALPHA })
        .stroke({ width: 2, color: BUTTON_COLOR, alpha: IDLE_ALPHA + 0.15 });
      this.drawGlyph(g, id, c.x, c.y, active);
    }

    // Pause icon: two bars, top corner.
    const p = layout.buttons.pause;
    if (p) {
      g.circle(p.x, p.y, layout.buttonRadius)
        .fill({ color: PAUSE_COLOR, alpha: IDLE_ALPHA })
        .stroke({ width: 2, color: PAUSE_COLOR, alpha: IDLE_ALPHA + 0.15 });
      g.rect(p.x - 5, p.y - 8, 4, 16).fill({ color: 0x101018, alpha: ACTIVE_ALPHA });
      g.rect(p.x + 1, p.y - 8, 4, 16).fill({ color: 0x101018, alpha: ACTIVE_ALPHA });
    }
  }

  private drawGlyph(g: Graphics, id: TouchButtonId, cx: number, cy: number, active: boolean): void {
    const color = 0x101018;
    const alpha = active ? ACTIVE_ALPHA : IDLE_ALPHA + 0.2;
    switch (id) {
      case "launch":
        // Up triangle.
        g.moveTo(cx, cy - 8).lineTo(cx - 7, cy + 6).lineTo(cx + 7, cy + 6)
          .fill({ color, alpha });
        break;
      case "fire1":
      case "fire2":
      case "fire3":
      case "fire4": {
        // Roman numeral bars: I, II, III, IV.
        const n = Number(id.slice(4));
        const barW = 3;
        const gap = 3;
        const totalW = n * barW + (n - 1) * gap;
        for (let i = 0; i < n; i++) {
          g.rect(cx - totalW / 2 + i * (barW + gap), cy - 8, barW, 16)
            .fill({ color, alpha });
        }
        break;
      }
      case "cycleForward":
        // Right chevron.
        g.moveTo(cx - 5, cy - 8).lineTo(cx + 6, cy).lineTo(cx - 5, cy + 8)
          .fill({ color, alpha });
        break;
      case "cycleBack":
        g.moveTo(cx + 5, cy - 8).lineTo(cx - 6, cy).lineTo(cx + 5, cy + 8)
          .fill({ color, alpha });
        break;
      case "pause":
        break; // drawn with the icon
    }
  }
}
