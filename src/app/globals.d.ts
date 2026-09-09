import type { SoloSession } from "app/soloSession";
import type { VersusBotsAppSession } from "app/versusBotsSession";

declare global {
  var __arkanoid: SoloSession | undefined;
  var __arkanoidBots: VersusBotsAppSession | undefined;
}
