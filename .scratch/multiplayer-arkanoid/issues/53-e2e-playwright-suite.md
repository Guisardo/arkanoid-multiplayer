# 53 — E2E Playwright suite

**What to build:** The browser end-to-end suite per spec §17: landing/menu navigation, settings persistence, i18n switch (es-419/en-US), Solo start/pause/continue, versus-bots config screen, lobby room-code create/join (two browser contexts), ready gate + start countdown, P2P connect via manual copy-paste fallback (no deployed infra needed — fallback doubles as dev-mode connector), touch overlay presence in mobile-emulated viewport, zero console errors. Headless WebGL via SwiftShader = functional only — perf budgets stay manual on the reference device. Seam rule: e2e owns wiring/UI/connection; sim logic stays in Vitest, never re-tested in e2e.

**Blocked by:** 42 — Touch overlay + mobile layouts; 45 — Remote play; 51 — Versus bots mode; 52 — i18n completion.

**Status:** ready-for-agent

- [ ] All spec'd e2e scenarios run green headless (SwiftShader WebGL)
- [ ] Two-context lobby create/join + ready gate + countdown covered
- [ ] Copy-paste P2P connect covered without deployed infra
- [ ] Mobile-emulated viewport shows touch overlay; desktop doesn't
- [ ] Zero console errors asserted across the suite
- [ ] No sim-logic assertions in e2e — those live in Vitest only


