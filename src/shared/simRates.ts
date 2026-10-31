// Sim rate constants shared across app/net/render (leaf module).
export const SIM_HZ = 60;
export const TICK_MS = 1000 / SIM_HZ;
/** Laser fire cooldown (spec #140): 350 ms, auto-repeat while held. */
export const LASER_COOLDOWN_MS = 350;
/** The Laser cooldown in whole sim ticks, rounded up (21). */
export const LASER_COOLDOWN_TICKS = Math.ceil((LASER_COOLDOWN_MS * SIM_HZ) / 1000);
