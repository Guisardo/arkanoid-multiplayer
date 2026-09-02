# Research: reusable Arkanoid base survey

Type: research
Status: resolved

## Question

Is there an existing open-source Arkanoid implementation we should build on instead of starting from scratch?

Survey the internet for browser-runnable (JavaScript/TypeScript) Arkanoid clones with permissive licenses (MIT/Apache). For each viable candidate record: repo, license, tech stack, completeness (game loop, ball/paddle physics, brick collision, level format, power-up set, rendering), and multiplayer-readiness (is game state cleanly separated from rendering, or hard-coupled?).

Deliver: candidate shortlist, a reuse-vs-build verdict, and — if reuse wins — what the base gives us (level data, power-up roster, physics) and what must be replaced for multiplayer. This gates Research: browser stack options and Content set: levels & power-ups.

## Answer

Verdict: build from scratch; no surveyed repo is a viable base. 14+ candidates examined across GitHub (arkanoid JS/TS, breakout TS, arkanoid phaser). Shortlist: budnix/ball-and-wall (MIT — only content-complete repo: 2 level episodes, 14-capsule roster, level editor; but 2015 jQuery-era code, zero sim/render separation), TomC333/pixi-breakout-game (MIT — modern TS+Pixi but one hardcoded level, no capsules), weibenfalk/typescript-arkanoid (unlicensed, reference only — cleanest minimal sim/render split). Every other candidate fails on license (GPL bocaletto-luca; unlicensed our-mini-games), scale (tutorial demos), or stack (Unity).

Decisive fact: multiplayer needs a headless, deterministic, fixed-timestep simulation from day one — no candidate has one, and retrofitting one costs more than a clean build of this small domain.

What we take anyway: capsule roster + level-episode structure from ball-and-wall (MIT) as content checklist; level-as-JSON format idea (ourcade starter, MIT); sim/render seam pattern (data-object entities + isolated view). What must be built regardless: headless sim, host-authoritative netcode, multi-play-field orchestration (2-4 fields), split-screen composition, all input modes, sound, lobby.

Implications: browser-stack ticket now unconstrained by any base; content-set ticket unblocked with concrete input; sim module must be netcode-ready even for split-screen; keep MIT attribution if ball-and-wall content copied.

Full findings: [../research/01-reusable-arkanoid-base-survey.md](../research/01-reusable-arkanoid-base-survey.md)
