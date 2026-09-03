// Bot skin auto-assignment (spec §7): distinct, never colliding with any
// human's choice, deterministic.
export function assignBotSkins(
  humanSkinIndexes: readonly number[],
  botCount: number,
  registrySize: number,
): number[] {
  const taken = new Set<number>([...humanSkinIndexes]);
  const out: number[] = [];
  for (let i = 0; i < registrySize && out.length < botCount; i++) {
    if (!taken.has(i)) {
      taken.add(i);
      out.push(i);
    }
  }
  if (out.length < botCount) {
    throw new Error("not enough skins for bots");
  }
  return out;
}
