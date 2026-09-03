// Per-locale string tables (spec §14). No hardcoded user-facing strings
// anywhere outside these tables. Names, room codes, digits never localized.

export type Locale = "en-US" | "es-419";

export const LOCALES: readonly Locale[] = ["en-US", "es-419"];
export const DEFAULT_LOCALE: Locale = "en-US";

export type StringKey = keyof typeof enUS;

const enUS = {
  "app.title": "Arkanoid Multiplayer",
  "hud.lives": "Lives",
  "hud.score": "Score",
  "hud.round": "R",
  "hud.roundOf": "R{round}/{max}",
  "menu.solo": "Solo",
  "menu.versusBots": "Versus bots",
  "menu.multiplayer": "Multiplayer",
  "menu.settings": "Settings",
  "menu.back": "Back",
  "menu.resume": "Resume",
  "menu.quit": "Quit",
  "settings.controls": "Controls",
  "settings.audio": "Audio",
  "settings.display": "Display",
  "settings.appearance": "Appearance",
  "settings.music": "Music",
  "settings.sfx": "SFX",
  "settings.mute": "Mute",
  "settings.dpr": "Render quality",
  "settings.dpr.auto": "Auto",
  "settings.reducedEffects": "Reduced effects",
  "settings.language": "Language",
  "settings.name": "Name",
  "settings.skin": "Skin",
  "settings.theme": "Theme",
} as const;

const es419: Record<StringKey, string> = {
  "app.title": "Arkanoid Multijugador",
  "hud.lives": "Vidas",
  "hud.score": "Puntos",
  "hud.round": "R",
  "hud.roundOf": "R{round}/{max}",
  "menu.solo": "Solo",
  "menu.versusBots": "Contra bots",
  "menu.multiplayer": "Multijugador",
  "menu.settings": "Ajustes",
  "menu.back": "Volver",
  "menu.resume": "Continuar",
  "menu.quit": "Salir",
  "settings.controls": "Controles",
  "settings.audio": "Audio",
  "settings.display": "Pantalla",
  "settings.appearance": "Apariencia",
  "settings.music": "Música",
  "settings.sfx": "Efectos",
  "settings.mute": "Silenciar",
  "settings.dpr": "Calidad de render",
  "settings.dpr.auto": "Auto",
  "settings.reducedEffects": "Efectos reducidos",
  "settings.language": "Idioma",
  "settings.name": "Nombre",
  "settings.skin": "Skin",
  "settings.theme": "Tema",
};

const TABLES: Record<Locale, Record<StringKey, string>> = {
  "en-US": enUS,
  "es-419": es419,
};

/** Interpolate {placeholders} in a string. */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    key in vars ? String(vars[key]) : m,
  );
}

/** Look up a key for a locale with en-US fallback (spec §14). */
export function t(locale: Locale, key: StringKey): string {
  const table = TABLES[locale];
  return table[key] || TABLES[DEFAULT_LOCALE][key];
}

/** All keys (for completeness tests). */
export function allKeys(): StringKey[] {
  return Object.keys(enUS) as StringKey[];
}

/** Auto-detect locale from a navigator.language list (spec §14). */
export function detectLocale(languages: readonly string[]): Locale {
  for (const lang of languages) {
    const lower = lang.toLowerCase();
    if (lower.startsWith("es")) return "es-419";
    if (lower.startsWith("en")) return "en-US";
  }
  return DEFAULT_LOCALE;
}
