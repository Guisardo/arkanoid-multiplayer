// Runtime-generated BitmapFont atlas (spec §3, §14): single atlas covering
// Basic Latin + Latin-1 Supplement characters needed by both locales
// (á é í ó ú ñ ü ¿ ¡ included). Generated in-code — no shipped PNG.
import { BitmapFont, TextStyle } from "pixi.js";

export const GAME_FONT_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" +
  " .,:;!?()[]{}<>/\\|@#$%^&*+-_=~\"'`´" +
  "áéíóúñü¿¡ÁÉÍÓÚÑÜ" +
  "°§";

let installed = false;

export function installGameFont(): void {
  if (installed) return;
  if (typeof document === "undefined") return; // headless (node tests) — no canvas
  installed = true;
  BitmapFont.install({
    name: "game",
    style: new TextStyle({
      fontFamily: "monospace",
      fontSize: 16,
      fill: 0xffffff,
    }),
    chars: GAME_FONT_CHARS,
    resolution: 2,
    padding: 2,
  });
}

export const GAME_FONT_NAME = "game";
