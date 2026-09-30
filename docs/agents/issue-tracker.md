# Issue tracker: GitHub Issues

Issues and specs for this repo live as GitHub Issues in the Guisardo/arkanoid-multiplayer repository.

## Conventions

- Wayfinder maps are issues labeled `wayfinder:map`
- Wayfinder tickets are issues labeled `wayfinder:ticket` with subtype labels:
  - `wayfinder:research` — research tickets (AFK)
  - `wayfinder:prototype` — prototype tickets (HITL)
  - `wayfinder:grilling` — grilling tickets (HITL)
  - `wayfinder:task` — task tickets (HITL or AFK)
- Triage state is recorded via GitHub issue state (open/closed) and labels
- Comments and conversation history are GitHub issue comments

## When a skill says "publish to the issue tracker"

Create a new GitHub issue with appropriate labels using `gh issue create`.

## When a skill says "fetch the relevant ticket"

Read the GitHub issue using `gh issue view <number> --repo Guisardo/arkanoid-multiplayer`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a GitHub issue with child tickets as linked issues.

- **Map**: GitHub issue labeled `wayfinder:map` — the Notes / Decisions-so-far / Fog body in the issue description.
- **Child ticket**: GitHub issue labeled `wayfinder:ticket` with a `wayfinder:<type>` subtype label. The question is in the issue description.
- **Blocking**: Use GitHub's native issue dependencies (blocked by / blocks). A ticket is unblocked when every blocking issue is closed.
- **Frontier**: Query for open issues labeled `wayfinder:ticket` that have no open blocking dependencies and are not assigned. First by issue number wins.
- **Claim**: Assign the issue to yourself (`gh issue edit <number> --assignee @me`) before any work.
- **Resolve**: Post the answer as a comment, close the issue (`gh issue close <number>`), and append a context pointer (gist + link) to the map's Decisions-so-far in the map issue description (edit the map issue).

## Map issue body format

```markdown
## Destination

<what reaching the end of this map looks like — the spec, decision, or change this effort is finding its way to. One or two lines; every session orients to it before choosing a ticket.>

## Notes

<domain; skills every session should consult; standing preferences for this effort>

## Decisions so far

<!-- the index — one line per closed ticket: enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [<closed ticket title>](link) — <one-line gist of the answer>

## Not yet specified

<!-- see "Fog of war": in-scope fog you can't ticket yet; graduates as the frontier advances -->

## Out of scope

<!-- see "Out of scope": work ruled beyond the destination; closed, never graduates -->
```

## Ticket issue body format

```markdown
## Question

<the decision or investigation this ticket resolves>
```