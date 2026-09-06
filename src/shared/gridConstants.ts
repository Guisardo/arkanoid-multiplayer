// Grid dims duplicated here so content/ (a leaf) doesn't import sim/.
export const BRICK_COLS = 13;
export const BRICK_ROWS = 18;
export const BRICK_W = 16;
export const BRICK_H = 8;
export const BRICK_TOP_OFFSET = 20;
export const CAPSULE_W = 12;
export const CAPSULE_H = 6;
export const FIELD_W = 208;
export const FIELD_H = 256;
// Paddle kinematics duplicated here so net/ (prediction parity with the
// sim's movement math) doesn't import sim/ — same values as sim/constants.
export const PADDLE_W = 32;
export const PADDLE_H = 6;
export const PADDLE_VMAX = 150;
