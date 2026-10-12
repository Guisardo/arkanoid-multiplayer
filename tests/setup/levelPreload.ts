// ADR 0007: round JSON is fetched on demand now. Session creators
// (soloEpisode, hostGame, versusBots) preload the range they will play
// before building a sim; this setup does the same for tests, so sim-level
// tests can keep constructing sessions directly without awaiting levels.
import { beforeAll } from "vitest";
import { availableRounds, preloadLevels } from "content/levels";

beforeAll(async () => {
  await preloadLevels(availableRounds());
});
