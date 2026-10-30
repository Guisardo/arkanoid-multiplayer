// Match-start wiring for the deferred gameplay bundle (ticket 87, ADR 0004).
//
// The bundle is fetched when a match is created, not at page load. On a cold
// first match that is a real wait, so this shows a progress screen for it; on
// every later match the bundle is cached and the match starts with no screen.
//
// A failed load never blocks play: the sprite loader already degrades to
// procedural geometry, so the worst outcome here is a match without textures.
// The failure is logged, not swallowed, so a silently art-less release stays
// diagnosable.
import { ensureGameplayAssets, gameplayAssetsReady } from "render/spriteSheet";
import { LoadingScreen } from "ui/loadingScreen";
import type { Locale } from "ui/strings";

/** The slice of the sprite loader this wiring depends on (injectable for tests). */
export interface GameplayLoader {
  /** True once the gameplay bundle is cached, so there is nothing to wait for. */
  isLoaded(): boolean;
  /** Load the bundle, reporting 0..1 progress. */
  ensure(onProgress: (progress: number) => void): Promise<void>;
}

export const defaultGameplayLoader: GameplayLoader = {
  isLoaded: gameplayAssetsReady,
  ensure: ensureGameplayAssets,
};

export interface StartWithGameplayAssetsOptions<T> {
  host: HTMLElement;
  locale: Locale;
  /** Creates the match once the bundle has loaded (or failed to). */
  start: () => T | Promise<T>;
  loader?: GameplayLoader;
}

/**
 * Make sure the gameplay bundle is loaded, showing progress if that takes a
 * wait, then create the match. The loading screen is gone before `start` runs,
 * so a match creator that throws cannot leave an overlay stranded on screen.
 */
export async function startWithGameplayAssets<T>(
  opts: StartWithGameplayAssetsOptions<T>,
): Promise<T> {
  const loader = opts.loader ?? defaultGameplayLoader;
  if (!loader.isLoaded()) {
    const screen = new LoadingScreen({ host: opts.host, locale: opts.locale });
    try {
      await loader.ensure((progress) => {
        screen.setProgress(progress);
      });
    } catch (err) {
      console.error("[gameplayLoad] gameplay assets failed to load; starting without them", err);
    } finally {
      screen.close();
    }
  }
  return opts.start();
}
