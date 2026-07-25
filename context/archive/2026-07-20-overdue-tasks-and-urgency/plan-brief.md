# Overdue Tasks and Urgency — Plan Brief

> Full plan: `context/changes/overdue-tasks-and-urgency/plan.md`

## What & Why

Overdue tasks already remain on Today, but they look identical to tasks due now. This change adds an explicit, accessible urgency cue so users can answer “what did I miss?” at a glance while preserving the calm, deterministic watering workflow.

## Starting Point

The hydrated Today island already filters all plants with `next_due_on <=` the browser-local date, keeps them ordered by due date and name, and clears any row through the optimistic Watered action. The missing delta is overdue classification and presentation; no data or server mutation work is required.

## Desired End State

Today remains one stable ledger. Every overdue row shows a warning icon, visible `Overdue` text, and its exact due date; rows one or two days overdue use standard amber, while rows three or more days overdue receive one stronger amber emphasis. Due-today rows and all Watered behavior remain unchanged.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| List structure | One due-date-sorted ledger | Preserves calm scanning and existing stable order |
| Overdue wording | `Overdue` plus exact due date | Combines accessible semantics with deterministic schedule evidence |
| Severity model | One escalation threshold at day 3 | Adds prioritization without a ladder of arbitrary tiers |
| Strong state | Same amber family, stronger emphasis | Keeps overdue distinct from destructive red |
| Surface scope | Today only | Uses the authoritative browser-local date and avoids SSR timezone errors |
| Test tooling | Existing gates plus focused manual checks | The repo has no runner, and adding one would outweigh this UI-focused slice |

## Scope

**In scope:**

- Browser-local overdue-day classification.
- Standard amber treatment for days 1–2 overdue.
- One stronger amber treatment from day 3.
- Warning icon, visible `Overdue` label, and exact due date.
- Light/dark, color-independent, responsive, keyboard, screen-reader, reduced-motion, midnight, and Watered regression verification.

**Out of scope:**

- Separate list sections or numeric overdue-day copy.
- Urgency on All Plants or plant detail.
- Database, actions, Postpone, Undo, seasons, reminders, or future tasks.
- New test infrastructure and unrelated UI cleanup.

## Architecture / Approach

Add a pure calendar-day classifier to `src/lib/date.ts`, expose a semantic warning accent in `src/styles/global.css`, and apply both inside the existing `src/components/today-list.tsx` render pass. The existing browser-local date state remains the authority for filtering and urgency, so midnight rollover updates both together without new requests or per-row effects.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Overdue classification and urgency treatment | Complete accessible Today-row urgency with a day-3 escalation | Regressing mobile density or the load-bearing Watered coordinator |

**Prerequisites:** Core watering loop is implemented; Today can load and clear due/overdue rows.

**Estimated effort:** One focused implementation session plus manual accessibility and rollover verification.

## Open Risks & Assumptions

- The three-day escalation is a product convention, not a plant-science rule.
- The compact cue must fit beside user-generated names and an always-visible Watered action at 320px.
- Light and dark warning combinations require visual contrast checks because no automated accessibility harness exists.

## Success Criteria (Summary)

- Due-today, 1–2-day overdue, and 3+-day overdue rows are visibly and semantically distinct at the exact boundaries.
- Urgency never depends on color and remains usable in both themes, at 320px, at 200% zoom, by keyboard, and with a screen reader.
- Ordering, count, midnight rollover, optimistic Watered, concurrency, rollback, Retry, focus restoration, and reduced motion do not regress.
