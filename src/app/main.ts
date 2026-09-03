import { startSoloSession } from "app/soloSession";
import { loadSkinSprites } from "render/spriteSheet";

const host = document.getElementById("app");
if (!host) throw new Error("missing #app host");

// Real CC0 sprites load once at boot; failures degrade to procedural geometry.
void loadSkinSprites().then(() => startSoloSession(host)).then((session) => {
  globalThis.__arkanoid = session;
});
