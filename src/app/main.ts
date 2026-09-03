import { startSoloSession } from "app/soloSession";

const host = document.getElementById("app");
if (!host) throw new Error("missing #app host");

void startSoloSession(host).then((session) => {
  globalThis.__arkanoid = session;
});
