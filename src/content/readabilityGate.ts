// Readability gate (spec §13, hard constraint): skins never the sole signal
// for Duel ball ownership — the owner-colored outline glow (owner color +
// white outline) must render over whatever skin the ball wears, and must
// stay visible over every shipped field theme background. Pure math —
// unit-testable headless. Enforced for every shipped skin/theme at test time.
import { PLAYER_COLORS } from "shared/playerColors";
import type { BallSkin, FieldTheme, PaddleSkin } from "./skinTypes";

/** Extract 8-bit channels from a 0xRRGGBB color. */
function channels(color: number): { r: number; g: number; b: number } {
  return {
    r: (color >> 16) & 0xff,
    g: (color >> 8) & 0xff,
    b: color & 0xff,
  };
}

/** WCAG-style relative luminance (0..1). */
function luminance(color: number): number {
  const { r, g, b } = channels(color);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1..21). */
export function contrastRatio(a: number, b: number): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Minimum contrast the owner glow must reach over a theme background. */
export const GLOW_MIN_CONTRAST = 3.0;

/**
 * Gate check: does the owner-colored glow read over this theme background?
 * The glow layer = owner color ring + white outline; the white outline is
 * the worst case (brightest) inner edge, so gate on owner color vs background
 * — if the owner color passes, the composite glow passes.
 */
export function glowPassesTheme(owner: number, theme: FieldTheme): boolean {
  const bg = theme.background.color;
  return contrastRatio(owner, bg) >= GLOW_MIN_CONTRAST;
}

/**
 * Gate check: is a ball skin tintable for owner colors? White-base sprites
 * only — baseColor must be near-white (luminance ≥ 0.7) so the render-time
 * tint dominates and the owner glow stays the ownership signal.
 */
export function ballSkinTintable(skin: BallSkin): boolean {
  return luminance(skin.baseColor) >= 0.7;
}

/**
 * Gate check: paddle skin keeps a visible trim over the theme background —
 * skin replaces bare color as identity, so trim (the shape/texture variant
 * signal) must contrast against the field behind it.
 */
export function paddleTrimVisible(skin: PaddleSkin, theme: FieldTheme): boolean {
  return contrastRatio(skin.trimColor, theme.background.color) >= GLOW_MIN_CONTRAST;
}

/** Full gate for one skin across one theme. */
export function skinPassesGate(
  skin: { paddle: PaddleSkin; ball: BallSkin },
  theme: FieldTheme,
): boolean {
  return (
    ballSkinTintable(skin.ball) &&
    paddleTrimVisible(skin.paddle, theme) &&
    PLAYER_COLORS.every((c) => glowPassesTheme(c, theme))
  );
}
