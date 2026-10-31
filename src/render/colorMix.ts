// Color mixing for procedural sprites: derive highlight/shade tones from a
// single authored body color, so content descriptors carry one color and
// every painter shades it the same way. Pure math on 0xRRGGBB numbers —
// unit-testable headless.

const WHITE = 0xffffff;
const BLACK = 0x000000;

/** Linear mix of two 0xRRGGBB colors per channel; t = 0 → `from`, t = 1 → `to`. */
export function mixColor(from: number, to: number, t: number): number {
  if (t < 0 || t > 1) throw new RangeError(`mixColor: t must be in [0, 1] (t=${String(t)})`);
  const channel = (shift: number): number => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * t) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

/** Mix `color` toward white by `t`. */
export function lighten(color: number, t: number): number {
  return mixColor(color, WHITE, t);
}

/** Mix `color` toward black by `t`. */
export function darken(color: number, t: number): number {
  return mixColor(color, BLACK, t);
}
