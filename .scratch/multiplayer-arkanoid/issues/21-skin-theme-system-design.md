# Skin & theme system design

Type: grilling
Status: resolved
Blocked by: (none)

## Question

How do customizable skins/themes work, replacing the prototype's bare color identification of paddles and balls? What covers what, where is it selected, how do remote players see it, and how does it coexist with Duel ball-ownership signaling? Which free asset libraries supply it (research)?

## Answer

Resolved 2026-09-02 during spec-assembly session (HITL, 4 questions + skin-id ruling).

**Scope — player skins + field themes:**
- **Player skins**: per-player paddle skin + ball skin (shape/texture/trim variants, not just color).
- **Field themes**: host-chosen in lobby config — brick set + field background (+ UI chrome tint). Applies to every rendered field in parallel modes, the single field in shared-field/Duel. Remote fields never rendered, so theme is visual-only, no gameplay meaning.

**Selection — Settings default + lobby override:** per-device default skin in Settings (Controls/Audio/Display → new Appearance section, persisted localStorage); overridable per-player in lobby, same slot as name editing. Bots get auto-assigned distinct skins (never collide with the human's choice).

**Identity — skin id = UUID (or content hash), never a small enum:** collision-free across future skin additions and any external packs. Registry of built-in skins, each with a stable UUID minted at authoring. Wire protocol: full UUID rides the lobby join (control channel, JSON — cheap, once); host assigns a compact per-session skin index (byte) at join; snapshots carry the index. Index is session-scoped; UUID is the cross-session identity.

**Sync — via session state:** everyone sees everyone's actual skin. Field theme id rides lobby config broadcast (same UUID→index treatment).

**Duel ownership signal — orthogonal layer:** skin = shape/texture/trim; ball ownership stays the validated colored-outline glow (owner color + white outline) drawn over whatever skin the ball wears. Skins must never be the sole ownership signal — readability gate for every shipped skin.

**Audio (companion decision, richer set):** per-event SFX variants (brick hit pitched by row, escalating chains), round-intro jingles, level music, boss theme for Doh. Sourcing recipe from [Research: free asset libraries for skins, themes & audio](20-free-asset-libraries-skins-themes-audio.md).

**Constraint carried to spec:** skin/theme system must not break any prototype-validated readability (Duel ownership outline, shared-field paddle color-coding — skins replace color as identity, outline glow stays).
