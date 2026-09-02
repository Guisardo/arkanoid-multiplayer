# Research: reusable Arkanoid base survey — findings

Ticket: `../issues/01-reusable-arkanoid-base-survey.md`
Date: 2026-08-30
Method: GitHub search API across 4 query angles (`arkanoid language:javascript`, `arkanoid language:typescript`, `breakout game language:typescript`, `arkanoid phaser`), then primary-source verification per candidate: repo metadata (stars/forks/last push/license via API), repo file tree, README, and spot-reads of core source files. All facts below come from the repos themselves, not blog write-ups.

Star/fork/last-push figures are GitHub API values as of 2026-08-30.

## Candidates examined

### 1. budnix/ball-and-wall
- **URL:** https://github.com/budnix/ball-and-wall
- **License:** MIT — `LICENSE` file present in repo tree (blob `99f1f9c`, 1093 bytes)
- **Tech stack:** Plain JavaScript + Canvas + jQuery-era toolchain (Bower, Grunt, Gumby CSS). No framework, no module system.
- **Completeness:** The most complete Arkanoid-like found. Game loop, ball/paddle physics, brick collision, two "episodes" (level sets), a rich capsule set (3_balls, big_ball, small_ball, grow_paddle, shrink_paddle, glue_paddle, gun, extra_life, score, earthquake, cpu-paddle, turbulent-ball, clouds, die — verified as asset directories in the repo tree), level editor shipped (`levels-editor.html`), sounds. Caveat from README: the "pegasus" episode's graphics are paid graphicriver assets — only the "space" episode's art is free to reuse.
- **Multiplayer-readiness:** Poor. Monolithic JS files, DOM-jQuery input handling, CSS-driven responsive layout. No simulation module separate from rendering; state and rendering interleave in the same scripts.
- **Maintenance:** Last push 2015-03-16. 49 stars, 41 forks. Dead but was popular.

### 2. weibenfalk/typescript-arkanoid
- **URL:** https://github.com/weibenfalk/typescript-arkanoid
- **License:** **None.** No LICENSE file in the tree (verified full recursive tree). GitHub API reports license: null.
- **Tech stack:** TypeScript + plain Canvas + Webpack. Companion code for a YouTube tutorial.
- **Completeness:** Minimal. 5 source files (`index.ts`, `setup.ts`, `Collison.ts`, `sprites/{Ball,Brick,Paddle}.ts`, `view/CanvasView.ts`). Game loop, basic ball/paddle/brick AABB collision. No level format (single hardcoded layout), no capsules, no sound.
- **Multiplayer-readiness:** Interestingly the cleanest separation found: sprites are dumb data holders, `CanvasView.ts` is the only render touchpoint, and the ball lives in a plain `Ball` object that mutates `SpeedX/SpeedY`. Tiny surface area (~10KB of source) — easy to lift the collision helpers from. But there is nothing beyond basics.
- **Maintenance:** Last push 2022-04-02. 58 stars, 57 forks (tutorial forks). Inactive.

### 3. ourcade/phaser3-breakout-matterjs-starter
- **URL:** https://github.com/ourcade/phaser3-breakout-matterjs-starter
- **License:** MIT — `LICENSE` file present in repo tree (blob `50b01a7`)
- **Tech stack:** TypeScript + Phaser 3 + Matter.js physics, Vite-adjacent build (parcel-era scripts), ESLint, GitHub Actions CI.
- **Completeness:** Starter template, not a game. 3 scenes (Preloader/Game/GameOver), one paddle class, one level (`public/levels/level1.json` loaded from a Tiled `.tmx`). Placeholder assets (129-byte PNGs). No capsules, no lives system beyond game-over, minimal sound (one 130-byte placeholder wav).
- **Multiplayer-readiness:** Poor for our purposes — physics live inside Phaser/Matter scene lifecycle; game state is the scene. Level-as-JSON is a good idea to keep.
- **Maintenance:** Last push 2023-01-07. 7 stars, 3 forks, 9 open issues. Maintained by Ourcade (game-dev tutorial org) but this template is dormant.

### 4. our-mini-games/mini-games (packages/arkanoid)
- **URL:** https://github.com/our-mini-games/mini-games
- **License:** **None.** No LICENSE file anywhere in the root or arkanoid package tree (verified). GitHub API license: null. All-rights-reserved by default.
- **Tech stack:** TypeScript + Vite + pnpm monorepo; the arkanoid package uses **Three.js + cannon.js** (3D rendering of a 2D game — confirmed by `src/lib/Arkanoid.ts` importing three/cannon).
- **Completeness:** Single play field, physics via cannon.js world with restitution-1 contact materials, wall/ball/bricks/paddle. No level format (procedural grid), no capsules, no sound. Bricks are a uniform grid of `crate.gif` boxes.
- **Multiplayer-readiness:** Actually notable: `Arkanoid.ts` keeps a cannon `world` with bodies (`ballBody`, `itemsBody`, `baffleBody`) and a separate `syncPhysicsToGraphics()` step that copies body state into Three meshes. That is a genuine sim/render seam — the closest any candidate comes. But it's 3D, physics-driven (non-deterministic floats via cannon), and unlicensed.
- **Maintenance:** Last push 2026-07-18 (active!). 44 stars, 7 forks. Active but small, and license blocks reuse.

### 5. TomC333/pixi-breakout-game
- **URL:** https://github.com/TomC333/pixi-breakout-game
- **License:** MIT — `LICENSE` file present (blob `224b26e`)
- **Tech stack:** TypeScript + PixiJS + Vite.
- **Completeness:** Moderate. Game loop, ball/paddle/brick collisions, lives, menus (win/lose/continue dialog), music + SFX (5 audio files in tree). Single hardcoded brick grid (`Layout.game.numberOfBrickRows`), no level data files, no capsules.
- **Multiplayer-readiness:** Poor. `game.ts` reads directly from `gameManager.stage` (Pixi Application), removes brick sprites inside collision checks, and the paddle position update runs via `setInterval` + `window.mousemove`. Rendering and simulation interleaved.
- **Maintenance:** Last push 2025-07-08. 9 stars, 0 forks.

### 6. Axelweaver/type-script-arcanoid-2023
- **URL:** https://github.com/Axelweaver/type-script-arcanoid-2023
- **License:** MIT — `LICENSE` file present (blob `b3d73e2`)
- **Tech stack:** TypeScript + plain Canvas (geometric shapes, no image sprites except background/lives) + Vite + ESLint.
- **Completeness:** Tutorial-scale. Game loop, collision file, sprites (Ball/Brick/Platform), lives drawn as hearts. One hardcoded brick layout, no capsules, no sound, no level format.
- **Multiplayer-readiness:** Same shape as weibenfalk — small, semi-separated, but nothing to reuse beyond basics.
- **Maintenance:** Last push 2023-08-24. 5 stars, 1 fork.

### 7. bocaletto-luca/Arkanoid
- **URL:** https://github.com/bocaletto-luca/Arkanoid
- **License:** GPL-3.0 — present, but **GPL is a hard blocker** for our permissive-license requirement.
- **Tech stack:** Plain JS + HTML5 (Bootstrap, some PHP bits per topics).
- **Completeness:** Good on paper — keyboard/mouse/touch/gamepad input, dynamic levels, power-ups, record tracking. But GPL.
- **Maintenance:** Last push 2025-07-04. 10 stars, 4 forks.

### 8. TalhaMasood23/Arkanoid_game
- **URL:** https://github.com/TalhaMasood23/Arkanoid_game
- **License:** Apache-2.0 (API-identified; LICENSE assumed present per GitHub detection).
- **Tech stack:** Plain JavaScript.
- **Completeness:** Repo size 49 KB, no description, no topics. Tutorial-scale single-file game.
- **Maintenance:** Last push 2025-03-20. 4 stars, 0 forks. No community.

### Others scanned and rejected quickly (from the same searches)
- **pshihn/brickception** (120★, BSD-2) — breakout across popup windows; clever novelty, not a base.
- **cyprieng/github-breakout** (850★, MIT) — SVG generator of a breakout game from a GitHub contribution graph; not a playable-game engine.
- **michelebucelli/monsterpong** (29★) — no license; pong/arkanoid hybrid.
- **exu3/arkanoid** (7★, MIT), **e10101/phaser-breakout**, **nunof07/phaser-breakout**, **maretana & Ic3b3rg phaser demos** — all demo/tutorial scale.
- **delimitry/arkanoid-js** (14★) — no license, single-canvas toy.
- **GotoFinal/ArkanoidTS**, **ld210/Arkanoid404**, **vanderkilu/breakout-game-ts**, **XavierLasierra/arkanoid-react** — ≤3★, dormant, tutorial scale.
- **tutsplus/build-arkanoid-with-unity** — Unity, not browser-native.

## Shortlist

Ranking by (license OK) × (completeness) × (multiplayer-readiness):

1. **budnix/ball-and-wall** (MIT) — the only candidate with real Arkanoid content: two level episodes, a 14-capsule roster, level editor, sound. Ancient stack (2015, jQuery/Bower), zero sim/render separation, but it is the best *content* donor: level data, capsule roster, physics tuning constants.
2. **TomC333/pixi-breakout-game** (MIT) — most modern code style (TS + Pixi + Vite), menus + audio + lives, but single hardcoded level, no capsules, sim/render interleaved.
3. **weibenfalk/typescript-arkanoid** (unlicensed — reference only) — cleanest minimal sim/render split (CanvasView isolated, sprite data objects); usable as a *design reference* for how thin the seam can be, but cannot be copied without a license.

No candidate is a viable base to build the product on.

## Verdict: build from scratch, mine candidates for content

**Build the game from scratch.** No surveyed repo satisfies even two of the three hard requirements (permissive license, full Arkanoid content, sim separate from render):

- The only content-complete repo (ball-and-wall) is a 2015 jQuery-era codebase with no simulation module — retrofitting host-authoritative netcode into it would cost more than a clean build, and its free-asset episode is only half its content.
- The only repo with a real sim/render seam (our-mini-games) is unlicensed and 3D.
- Everything else is tutorial scale: one hardcoded layout, no capsules, no level format.

The decisive architectural fact: our multiplayer design (up to 4 players, host-authoritative, multiple simultaneous play fields, split-screen + remote combinable) requires a headless, deterministic, fixed-timestep simulation as the core module from day one. None of the candidates has that, and bolting it onto any of them means re-architecting their inner loop anyway. An Arkanoid sim is a small, well-understood domain — a purpose-built sim is on the order of days, not weeks.

**What we still take from the survey:**
- **Level data + capsule roster (ball-and-wall, MIT):** its level episode format, its 14-capsule list (multi-ball, big/small ball, grow/shrink paddle, glue paddle, gun/laser, extra life, score bonus, earthquake, cpu-paddle, turbulent ball) is a ready-made content checklist for the Content set ticket. This aligns with the map's "full Arkanoid content" note.
- **Sim/render seam pattern (weibenfalk + our-mini-games as references):** plain data-object entities + isolated canvas view + explicit `syncPhysicsToGraphics`-style copy step confirm the shape our simulation module should take.
- **Level-as-JSON (ourcade starter, MIT):** external JSON level files beat hardcoded grids; adopt for our level format.

**What must be built regardless of reuse (i.e., the from-scratch core):** headless fixed-timestep simulation; host-authoritative netcode on top of it; multi-play-field orchestration (2-4 fields per session); split-screen view composition; touch/gamepad/mouse/keyboard input; sound; menus/lobby (room-code per map).

## Implications for the map

- **Research: browser stack options** — this ticket no longer constrains stack choice to any candidate's stack (no reuse candidate survives). Stack choice is fully open: plain Canvas vs Pixi vs Phaser should be decided on rendering/perf merits for 4 simultaneous play fields on low-end Android, not on base-code compatibility.
- **Content set: levels & power-ups** — now unblocked and has concrete input: lift the capsule roster and level-episode structure from ball-and-wall (MIT) as the starting content spec; decide which capsules make sense per multiplayer mode (e.g. cpu-paddle may drop; attack-style capsules gain value in competitive mode).
- **Netcode sync architecture** — verdict reinforces it: sim-first architecture is mandatory, and the sim module must be built netcode-ready (deterministic, headless, serializable state) even in single-device split-screen, because remote play shares the same module.
- **License hygiene** — if any ball-and-wall content is copied verbatim (level data, tuning constants), keep MIT attribution in a THIRD-PARTY-NOTICES file. GPL candidates (bocaletto-luca) must not be copied from at all.
