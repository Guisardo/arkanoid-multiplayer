# Arkanoid Multiplayer

[![CodeFactor](https://www.codefactor.io/repository/github/guisardo/arkanoid-multiplayer/badge)](https://www.codefactor.io/repository/github/guisardo/arkanoid-multiplayer)

A multiplayer Arkanoid for PC/Mac/Android web browsers: split-screen and remote play
combinable in one session, up to 4 players, competitive (Race/Attack/Duel) and coop
(Shared field/Parallel assist) modes, Solo + Versus bots, full classic content
(33 rounds, Doh finale). Free infrastructure only (P2P WebRTC + Cloudflare Workers +
GitHub Pages).

## Development

```bash
npm install
npm run dev        # Vite dev server
npm run test       # Vitest
npm run typecheck  # strict TS
npm run lint       # ESLint incl. seam enforcement
npm run e2e        # Playwright (headless SwiftShader WebGL)
```

## Architecture

Headless fixed-timestep (60 Hz) deterministic sim core; renderers are pure snapshot
consumers. Seams enforced by ESLint import-boundary rules (see `eslint.config.js`):

- `sim/` — headless core (no DOM/Pixi/network)
- `net/` — host-authoritative pipeline (delay queue, serializer, prediction)
- `signaling/` — room-code WS client + copy-paste fallback
- `render/` — PixiJS v8, snapshots only
- `input/` — device adapters → Input frames
- `ui/` — screens, i18n string tables
- `content/` — level JSON, capsule scripts, scoring, skins/themes
- `audio/` — SFX + music engine
- `persistence/` — localStorage wrapper

## Attribution

Content DNA (capsule roster, episode structure, level-as-JSON) informed by
[ball-and-wall](https://github.com/substack/ball-and-wall) (MIT) — MIT notice carried
here as required by its license. All committed art/audio assets are CC0 (see
`src/content/ASSETS.md`).

MIT License applies to this repository's code. See [LICENSE](LICENSE).
