# Assemble implementation-ready spec

Type: task
Status: resolved
Blocked by: 03, 04, 05, 06, 07, 08, 09, 10, 13, 15, 16, 17, 18, 19

## Question

Assemble every resolved decision into the implementation-ready spec at `.scratch/multiplayer-arkanoid/spec.md`: architecture and stack, both mode families with full rules, session/lobby flow, netcode, input mappings, content set, rendering/layout. Verify decision-complete — no open questions, nothing left to choose — then have the human review the final document. This ticket is the destination.

## Answer

Spec assembled 2026-09-02: [../spec.md](../spec.md) — 19 sections, all 19 prior tickets + ADRs 0001–0003 + prototype-validated values folded in. Decision-complete: every open fog item settled during assembly (audio content scope → richer set; QR share → in scope, client-side; watch panes → post-spec, prototype didn't flag Race as blind). Mid-assembly additions: Skin & theme system design (21) + Research: free asset libraries (20) — both resolved same session, folded into spec §13.

**Deferred values locked as spec defaults** (prototype-validated or ruled during assembly): logical field 208×256, cell 16×8, grid 13×18, paddle 32×6 @ y=242, Vmax 150 u/s, ball r 3, capsule 12×6 @ 45 u/s; attack/assist economy (chains 4/7/10, costs 30/25/20/40, durations 10/8/6 s, fill 2+10, rain 3/6/12, shrink 40%, speed +30%); Duel drop bonus 500; assist brick clear = 8 bricks @ 30; shared-field life pool = 3 × players; Solo Continue = fresh 3 lives, score −60%; gutters 8 px; bot parameter table (Easy/Normal/Hard).

**[authoring] markers** = data production only (level JSON, scoring table, capsule behaviors, atlas, asset set) — no design choices remain. §17 testing plan, §18 authoring checklist, §19 out-of-scope list included.

**Human review of the final document: pending** — spec handed to the human for review as the ticket requires; ticket resolves when review passes.

## Comments

**2026-09-02 — Review passed.** Section-by-section walkthrough of all 19 sections (6 chunks). One amendment: Playwright browser e2e tests added — §3 stack line + §17 e2e block (multi-context lobby tests, P2P via manual copy-paste fallback, SwiftShader functional-only, sim logic stays in Vitest). All other sections approved unchanged. Spec decision-complete and human-reviewed; destination reached.
