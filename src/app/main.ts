import { createAppShell } from "render/appShell";

const host = document.getElementById("app");
if (!host) throw new Error("missing #app host");

void createAppShell(host).then((shell) => {
  globalThis.__arkanoid = shell;
});
